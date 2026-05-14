import http from "http";
import https from "https";
import net from "net";
import snmp from "net-snmp";
import { prisma } from "../db.js";
import { recordMonitoringTelemetry } from "./monitoringEngine.js";

let monitoringPollerTimer = null;
let monitoringPollerBusy = false;

const builtinOidProfiles = {
  generic_system: {
    uptimeSeconds: "1.3.6.1.2.1.1.3.0",
  },
};

function parseOidMap(device) {
  const profileKey = device.metricProfile || "generic_system";
  const base = builtinOidProfiles[profileKey]
    ? { ...builtinOidProfiles[profileKey] }
    : {};

  if (!device.customOidMapJson) return base;
  try {
    const custom = JSON.parse(device.customOidMapJson);
    return custom && typeof custom === "object" ? { ...base, ...custom } : base;
  } catch {
    return base;
  }
}

function normalizeSnmpValue(field, varbind) {
  if (!varbind) return null;
  if (snmp.isVarbindError(varbind)) return null;
  const raw = varbind.value;
  if (raw === undefined || raw === null) return null;

  if (field === "uptimeSeconds") {
    return Math.round(Number(raw) / 100);
  }

  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (typeof raw === "object" && typeof raw.toString === "function") return raw.toString();
  return raw;
}

function probeSnmp(device) {
  return new Promise((resolve) => {
    const oidMap = parseOidMap(device);
    const fields = Object.keys(oidMap);
    if (!device.snmpCommunity || !fields.length) {
      resolve({
        ok: false,
        latencyMs: null,
        statusCode: 400,
        message: !device.snmpCommunity
          ? "SNMP community missing"
          : `SNMP OID map missing for profile ${device.metricProfile || "generic_system"}`,
      });
      return;
    }

    const startedAt = Date.now();
    const session = snmp.createSession(device.host, device.snmpCommunity, {
      port: Number(device.port || 161),
      retries: 1,
      timeout: Number(device.pollTimeoutMs || 5000),
      version: snmp.Version2c,
    });

    session.get(fields.map((field) => oidMap[field]), (error, varbinds) => {
      if (error) {
        session.close();
        resolve({
          ok: false,
          latencyMs: Date.now() - startedAt,
          statusCode: 503,
          message: `SNMP error: ${error.message}`,
        });
        return;
      }

      const metrics = {};
      fields.forEach((field, index) => {
        metrics[field] = normalizeSnmpValue(field, varbinds[index]);
      });
      session.close();
      resolve({
        ok: true,
        latencyMs: Date.now() - startedAt,
        statusCode: 200,
        message: `SNMP success: ${fields.length} OIDs collected`,
        metrics,
      });
    });
  });
}

function probeTcp(device) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    const timeoutMs = Number(device.pollTimeoutMs || 5000);
    const port = Number(device.port || 80);

    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({
        ok: true,
        latencyMs: Date.now() - startedAt,
        statusCode: 200,
        message: `TCP connect success on ${device.host}:${port}`,
      });
    });
    socket.once("timeout", () => finish({
      ok: false,
      latencyMs: timeoutMs,
      statusCode: 408,
      message: `TCP timeout after ${timeoutMs}ms`,
    }));
    socket.once("error", (error) => finish({
      ok: false,
      latencyMs: Date.now() - startedAt,
      statusCode: 503,
      message: error.message,
    }));

    socket.connect(port, device.host);
  });
}

function probeHttpLike(device, client) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timeoutMs = Number(device.pollTimeoutMs || 5000);
    const requestPath = device.pollPath || "/";
    const options = {
      hostname: device.host,
      port: Number(device.port || (client === https ? 443 : 80)),
      path: requestPath,
      method: "GET",
      timeout: timeoutMs,
      headers: {},
      rejectUnauthorized: false,
    };

    if (device.authUsername && device.authPassword) {
      const token = Buffer.from(`${device.authUsername}:${device.authPassword}`).toString("base64");
      options.headers.Authorization = `Basic ${token}`;
    }

    const req = client.request(options, (response) => {
      response.resume();
      resolve({
        ok: true,
        latencyMs: Date.now() - startedAt,
        statusCode: response.statusCode || 200,
        message: `HTTP ${response.statusCode || 200} from ${requestPath}`,
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`));
    });
    req.on("error", (error) => {
      resolve({
        ok: false,
        latencyMs: Date.now() - startedAt,
        statusCode: 503,
        message: error.message,
      });
    });
    req.end();
  });
}

async function probeDevice(device) {
  if (!device.host) {
    return {
      ok: false,
      latencyMs: null,
      statusCode: 400,
      message: "No host configured for active polling",
    };
  }

  const protocol = String(device.protocol || "tcp").toLowerCase();
  if (protocol === "snmp") return probeSnmp(device);
  if (protocol === "http") return probeHttpLike(device, http);
  if (protocol === "https") return probeHttpLike(device, https);
  return probeTcp(device);
}

async function pollSingleDevice(device) {
  const probe = await probeDevice(device);
  const nextPollFailures = probe.ok ? 0 : Number(device.pollFailures || 0) + 1;
  return recordMonitoringTelemetry(device, {
    eventType: "active_poll",
    status: probe.ok ? "online" : "offline",
    latencyMs: probe.latencyMs,
    packetLossPercent: probe.ok ? 0 : 100,
    message: probe.message,
    ...(probe.metrics || {}),
    lastPollAt: new Date(),
    lastPollStatusCode: probe.statusCode,
    pollFailures: nextPollFailures,
  });
}

export async function pollMonitoredDevice(device) {
  return pollSingleDevice(device);
}

export async function runMonitoringPollCycle() {
  if (monitoringPollerBusy) return;
  monitoringPollerBusy = true;

  try {
    const devices = await prisma.monitoredDevice.findMany({
      where: {
        pollEnabled: true,
        monitorMode: "active_poll",
      },
      orderBy: { updatedAt: "asc" },
    });

    for (const device of devices) {
      try {
        await pollSingleDevice(device);
      } catch (error) {
        await prisma.monitoredDevice.update({
          where: { id: device.id },
          data: {
            status: "offline",
            lastPollAt: new Date(),
            pollFailures: Number(device.pollFailures || 0) + 1,
            lastEventType: "active_poll_error",
            lastEventMessage: String(error.message || "Unknown poll error").slice(0, 500),
          },
        });
      }
    }
  } finally {
    monitoringPollerBusy = false;
  }
}

export function startMonitoringPoller() {
  if (monitoringPollerTimer) return;
  runMonitoringPollCycle().catch(() => {});
  monitoringPollerTimer = setInterval(() => {
    runMonitoringPollCycle().catch(() => {});
  }, 60000);
}
