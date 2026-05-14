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

const interfaceOidColumns = {
  name: "1.3.6.1.2.1.31.1.1.1.1",
  descr: "1.3.6.1.2.1.2.2.1.2",
  type: "1.3.6.1.2.1.2.2.1.3",
  mtu: "1.3.6.1.2.1.2.2.1.4",
  speed: "1.3.6.1.2.1.2.2.1.5",
  adminStatus: "1.3.6.1.2.1.2.2.1.7",
  operStatus: "1.3.6.1.2.1.2.2.1.8",
  alias: "1.3.6.1.2.1.31.1.1.1.18",
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

function decodeSnmpRaw(raw) {
  if (raw === undefined || raw === null) return null;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (typeof raw === "object" && typeof raw.toString === "function") return raw.toString();
  return raw;
}

function stringifySnmpValue(raw) {
  const value = decodeSnmpRaw(raw);
  if (value === null || value === undefined) return "";
  return String(value);
}

function classifyInterfaceName(name = "", descr = "") {
  const source = `${name} ${descr}`.toLowerCase();
  if (source.includes("pon")) return "pon";
  if (source.includes("onu") || source.includes("ont")) return "onu";
  if (source.includes("uplink") || source.includes("sfp") || source.includes("ge") || source.includes("gigabit")) return "uplink";
  if (source.includes("ether")) return "ethernet";
  return "interface";
}

function walkOidColumn(session, baseOid) {
  return new Promise((resolve, reject) => {
    const values = new Map();
    session.subtree(
      baseOid,
      (varbinds) => {
        for (const varbind of varbinds) {
          if (!varbind || snmp.isVarbindError(varbind)) continue;
          const oid = String(varbind.oid || "");
          const index = oid.slice(baseOid.length + 1);
          values.set(index, decodeSnmpRaw(varbind.value));
        }
      },
      (error) => {
        if (error) reject(error);
        else resolve(values);
      },
    );
  });
}

async function collectInterfaceInventory(session) {
  const columns = await Promise.all(
    Object.entries(interfaceOidColumns).map(async ([key, oid]) => [key, await walkOidColumn(session, oid)]),
  );

  const columnMap = Object.fromEntries(columns);
  const indexes = new Set();
  Object.values(columnMap).forEach((map) => {
    for (const key of map.keys()) indexes.add(key);
  });

  const items = Array.from(indexes)
    .map((index) => {
      const name = String(columnMap.name.get(index) || columnMap.descr.get(index) || `if-${index}`);
      const descr = String(columnMap.descr.get(index) || "");
      const alias = String(columnMap.alias.get(index) || "");
      const adminStatus = Number(columnMap.adminStatus.get(index) || 0);
      const operStatus = Number(columnMap.operStatus.get(index) || 0);
      const mtu = Number(columnMap.mtu.get(index) || 0) || null;
      const speed = Number(columnMap.speed.get(index) || 0) || null;
      return {
        id: index,
        name,
        descr,
        alias,
        type: classifyInterfaceName(name, descr),
        rawType: columnMap.type.get(index) ?? null,
        mtu,
        speed,
        running: operStatus === 1,
        disabled: adminStatus === 2,
      };
    })
    .filter((item) => item.name || item.descr)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));

  return items;
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

      collectInterfaceInventory(session)
        .then((interfaces) => {
          resultJson.interfaceDownCount = interfaces.filter((item) => !item.running && !item.disabled).length;
          resultJson.interfacesJson = JSON.stringify({
            source: "edge_snmp_if_mib",
            itemCount: interfaces.length,
            items: interfaces,
          });
        })
        .catch((inventoryError) => {
          resultJson.interfacesJson = JSON.stringify({
            source: "edge_snmp_if_mib",
            itemCount: 0,
            fetchMessage: `Interface walk failed: ${inventoryError.message}`,
            items: [],
          });
        })
        .finally(() => {
          session.close();
          resolve({
            status: "completed",
            resultJson,
          });
        });
    });
  });
}

async function runSnmpWalkTask(task) {
  const payload = task.payloadJson ? JSON.parse(task.payloadJson) : {};
  if (!payload.host) {
    return {
      status: "failed",
      errorMessage: "host missing for snmp walk",
    };
  }
  if (!payload.snmpCommunity) {
    return {
      status: "failed",
      errorMessage: "SNMP community missing",
    };
  }

  const baseOid = String(payload.baseOid || "1.3.6.1.2.1").trim();
  const maxEntries = Math.max(20, Math.min(Number(payload.maxEntries || 240), 600));
  const session = snmp.createSession(payload.host, payload.snmpCommunity, {
    port: Number(payload.port || 161),
    retries: 1,
    timeout: Number(payload.pollTimeoutMs || 5000),
    version: resolveSnmpVersion(payload.snmpVersion),
  });

  return new Promise((resolve) => {
    const items = [];
    session.subtree(
      baseOid,
      (varbinds) => {
        for (const varbind of varbinds) {
          if (!varbind || snmp.isVarbindError(varbind)) continue;
          if (items.length >= maxEntries) break;
          items.push({
            oid: String(varbind.oid || ""),
            type: String(varbind.type ?? ""),
            value: stringifySnmpValue(varbind.value).slice(0, 240),
          });
        }
      },
      (error) => {
        session.close();
        if (error) {
          resolve({
            status: "failed",
            errorMessage: `SNMP walk error: ${error.message}`,
          });
          return;
        }

        resolve({
          status: "completed",
          resultJson: {
            message: `SNMP walk success: ${items.length} entries from ${baseOid}`,
            baseOid,
            itemCount: items.length,
            items,
          },
        });
      },
      { maxRepetitions: 12 },
    );
  });
}

async function handleTask(task) {
  if (task.taskType === "ping") {
    return runPingTask(task);
  }
  if (task.taskType === "snmp_poll") {
    return runSnmpPollTask(task);
  }
  if (task.taskType === "snmp_walk") {
    return runSnmpWalkTask(task);
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
