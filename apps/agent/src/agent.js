import { execFile } from "child_process";
import snmp from "net-snmp";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const CLOUD_API_BASE = process.env.CABLEOPS_CLOUD_API_BASE || "https://cableops-api.onrender.com/api";
const AGENT_TOKEN = process.env.CABLEOPS_AGENT_TOKEN || "";
const AGENT_NAME = process.env.CABLEOPS_AGENT_NAME || "CableOps Edge Agent";
const POLL_INTERVAL_MS = Number(process.env.CABLEOPS_AGENT_INTERVAL_MS || 10000);

if (!AGENT_TOKEN) {
  console.error("Missing CABLEOPS_AGENT_TOKEN");
  process.exit(1);
}

async function post(path, body) {
  const response = await fetch(`${CLOUD_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    throw new Error(parsed?.message || text || `Request failed ${response.status}`);
  }
  return parsed;
}

async function runPingTask(task) {
  const targetHost = task.targetHost;
  if (!targetHost) {
    return {
      status: "failed",
      errorMessage: "targetHost missing",
    };
  }

  const payload = task.payloadJson ? JSON.parse(task.payloadJson) : {};
  const count = Number(payload.count || 2);
  const timeoutMs = Number(payload.timeoutMs || 5000);

  const command = process.platform === "win32"
    ? ["ping", ["-n", String(count), "-w", String(timeoutMs), targetHost]]
    : ["ping", ["-c", String(count), "-W", String(Math.ceil(timeoutMs / 1000)), targetHost]];

  try {
    const { stdout, stderr } = await execFileAsync(command[0], command[1], { windowsHide: true });
    return {
      status: "completed",
      resultJson: {
        targetHost,
        stdout,
        stderr,
      },
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage: error.stderr || error.message || "Ping failed",
      resultJson: {
        targetHost,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      },
    };
  }
}

const builtinOidProfiles = {
  generic_system: {
    uptimeSeconds: "1.3.6.1.2.1.1.3.0",
  },
};

function resolveSnmpVersion(version) {
  return String(version || "2c").toLowerCase() === "1" ? snmp.Version1 : snmp.Version2c;
}

function normalizeSnmpValue(field, varbind) {
  if (!varbind || snmp.isVarbindError(varbind)) return null;
  const raw = varbind.value;
  if (field === "uptimeSeconds") {
    return Math.round(Number(raw) / 100);
  }
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (typeof raw === "object" && typeof raw.toString === "function") return raw.toString();
  return raw;
}

async function runSnmpPollTask(task) {
  const payload = task.payloadJson ? JSON.parse(task.payloadJson) : {};
  if (!payload.host) {
    return {
      status: "failed",
      errorMessage: "host missing for snmp poll",
    };
  }
  if (!payload.snmpCommunity) {
    return {
      status: "failed",
      errorMessage: "SNMP community missing",
    };
  }

  let oidMap = payload.metricProfile && builtinOidProfiles[payload.metricProfile]
    ? { ...builtinOidProfiles[payload.metricProfile] }
    : {};

  if (payload.customOidMapJson) {
    try {
      const custom = JSON.parse(payload.customOidMapJson);
      if (custom && typeof custom === "object") {
        oidMap = { ...oidMap, ...custom };
      }
    } catch {
    }
  }

  const fields = Object.keys(oidMap);
  if (!fields.length) {
    return {
      status: "failed",
      errorMessage: "SNMP OID map missing",
    };
  }

  const session = snmp.createSession(payload.host, payload.snmpCommunity, {
    port: Number(payload.port || 161),
    retries: 1,
    timeout: Number(payload.pollTimeoutMs || 5000),
    version: resolveSnmpVersion(payload.snmpVersion),
  });

  return new Promise((resolve) => {
    session.get(fields.map((field) => oidMap[field]), (error, varbinds) => {
      if (error) {
        session.close();
        resolve({
          status: "failed",
          errorMessage: `SNMP error: ${error.message}`,
        });
        return;
      }

      const resultJson = {
        message: `Edge SNMP success: ${fields.length} OIDs collected`,
      };
      fields.forEach((field, index) => {
        resultJson[field] = normalizeSnmpValue(field, varbinds[index]);
      });
      session.close();
      resolve({
        status: "completed",
        resultJson,
      });
    });
  });
}

async function handleTask(task) {
  if (task.taskType === "ping") {
    return runPingTask(task);
  }
  if (task.taskType === "snmp_poll") {
    return runSnmpPollTask(task);
  }
  return {
    status: "failed",
    errorMessage: `Unsupported task type: ${task.taskType}`,
  };
}

async function register() {
  return post("/edge/agent/register", {
    token: AGENT_TOKEN,
    message: `${AGENT_NAME} online`,
  });
}

async function pullAndRun() {
  const response = await post("/edge/agent/pull", {
    token: AGENT_TOKEN,
    message: `${AGENT_NAME} heartbeat`,
  });

  const items = Array.isArray(response.items) ? response.items : [];
  for (const task of items) {
    const result = await handleTask(task);
    await post(`/edge/agent/tasks/${task.id}/result`, {
      token: AGENT_TOKEN,
      ...result,
    });
  }
}

async function main() {
  await register();
  console.log(`${AGENT_NAME} connected to ${CLOUD_API_BASE}`);

  while (true) {
    try {
      await pullAndRun();
    } catch (error) {
      console.error("Agent loop error:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
