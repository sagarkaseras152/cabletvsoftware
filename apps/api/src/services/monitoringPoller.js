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

function decodeSnmpRaw(raw) {
  if (raw === undefined || raw === null) return null;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (typeof raw === "object" && typeof raw.toString === "function") return raw.toString();
  return raw;
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
  const columnMap = {};
  const errors = [];
  for (const [key, oid] of Object.entries(interfaceOidColumns)) {
    try {
      columnMap[key] = await walkOidColumn(session, oid);
    } catch (error) {
      columnMap[key] = new Map();
      errors.push(`${key}: ${error.message}`);
    }
  }

  const indexes = new Set();
  Object.values(columnMap).forEach((map) => {
    for (const key of map.keys()) indexes.add(key);
  });

  return Array.from(indexes)
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

  return {
    items,
    fetchMessage: errors.length ? `Partial interface walk: ${errors.join(" | ")}` : "",
  };
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
      version: resolveSnmpVersion(device.snmpVersion),
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
      collectInterfaceInventory(session)
        .then((inventory) => {
          const interfaces = inventory.items || [];
          metrics.interfaceDownCount = interfaces.filter((item) => !item.running && !item.disabled).length;
          metrics.interfacesJson = JSON.stringify({
            source: "server_snmp_if_mib",
            itemCount: interfaces.length,
            fetchMessage: inventory.fetchMessage || "",
            items: interfaces,
          });
        })
        .catch((inventoryError) => {
          metrics.interfacesJson = JSON.stringify({
            source: "server_snmp_if_mib",
            itemCount: 0,
            fetchMessage: `Interface walk failed: ${inventoryError.message}`,
            items: [],
          });
        })
        .finally(() => {
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

function requestJson(client, options, body = null) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = client.request(
      {
        ...options,
        rejectUnauthorized: false,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });
        response.on("end", () => {
          let parsed = null;
          try {
            parsed = body ? JSON.parse(body) : null;
          } catch {
            parsed = null;
          }
          resolve({
            ok: (response.statusCode || 500) < 400,
            statusCode: response.statusCode || 500,
            latencyMs: Date.now() - startedAt,
            data: parsed,
            rawBody: body,
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`HTTP timeout after ${options.timeout}ms`));
    });
    req.on("error", (error) => {
      resolve({
        ok: false,
        statusCode: 503,
        latencyMs: Date.now() - startedAt,
        error,
      });
    });
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMikrotikUptimeSeconds(value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) return Number(value);
  const text = String(value).trim();
  const match = text.match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (!match) return null;
  const weeks = Number(match[1] || 0);
  const days = Number(match[2] || 0);
  const hours = Number(match[3] || 0);
  const mins = Number(match[4] || 0);
  const secs = Number(match[5] || 0);
  return ((((weeks * 7) + days) * 24 + hours) * 60 + mins) * 60 + secs;
}

async function probeMikrotikRest(device) {
  if (!device.authUsername || !device.authPassword) {
    return {
      ok: false,
      latencyMs: null,
      statusCode: 401,
      message: "MikroTik username/password missing",
    };
  }

  const client = String(device.protocol).toLowerCase() === "mikrotik_rest_http" ? http : https;
  const port = Number(device.port || (client === https ? 443 : 80));
  const timeout = Number(device.pollTimeoutMs || 5000);
  const authHeader = `Basic ${Buffer.from(`${device.authUsername}:${device.authPassword}`).toString("base64")}`;
  const basePath = (device.pollPath || "/rest").replace(/\/+$/, "");
  const common = {
    hostname: device.host,
    port,
    method: "GET",
    timeout,
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  };

  const [resourceRes, interfacesRes, healthRes] = await Promise.all([
    requestJson(client, { ...common, path: `${basePath}/system/resource` }),
    requestJson(client, { ...common, path: `${basePath}/interface` }),
    requestJson(client, { ...common, path: `${basePath}/system/health` }),
  ]);

  if (!resourceRes.ok) {
    return {
      ok: false,
      latencyMs: resourceRes.latencyMs,
      statusCode: resourceRes.statusCode,
      message: resourceRes.error?.message
        || `MikroTik REST failed with ${resourceRes.statusCode}. Check www-ssl/rest service, credentials, ACL, or path ${basePath}`,
    };
  }

  const resource = resourceRes.data || {};
  let interfaces = Array.isArray(interfacesRes.data) ? interfacesRes.data : [];
  let interfaceFetchMessage = interfacesRes.ok
    ? `interface fetch ok (${interfaces.length} rows)`
    : interfacesRes.error?.message || `interface GET failed with ${interfacesRes.statusCode}`;

  if (!interfaces.length) {
    const interfacePrintRes = await requestJson(
      client,
      {
        ...common,
        path: `${basePath}/interface/print`,
        method: "POST",
        headers: {
          ...common.headers,
          "Content-Type": "application/json",
        },
      },
      { ".proplist": [".id", "name", "type", "running", "disabled", "mtu", "actual-mtu", "mac-address", "comment"] },
    );

    if (interfacePrintRes.ok && Array.isArray(interfacePrintRes.data)) {
      interfaces = interfacePrintRes.data;
      interfaceFetchMessage = `interface print ok (${interfaces.length} rows)`;
    } else if (!interfacesRes.ok) {
      interfaceFetchMessage = `${interfaceFetchMessage}; print fallback failed with ${interfacePrintRes.statusCode || 503}`;
    }
  }

  const healthList = Array.isArray(healthRes.data) ? healthRes.data : [];
  const health = Object.fromEntries(
    healthList
      .map((item) => [String(item.name || "").toLowerCase(), item.value]),
  );
  const downInterfaces = interfaces.filter((item) => !item.running && !item.disabled).length;
  const compactInterfaces = interfaces.slice(0, 64).map((item) => ({
    id: item[".id"] || item.id || item.name,
    name: item.name,
    type: item.type,
    running: item.running === true || item.running === "true",
    disabled: item.disabled === true || item.disabled === "true",
    mtu: item["actual-mtu"] || item.mtu || null,
    macAddress: item["mac-address"] || null,
    comment: item.comment || null,
  }));

  const totalMemory = toNumberOrNull(resource["total-memory"]);
  const freeMemory = toNumberOrNull(resource["free-memory"]);
  const usedMemoryPercent = totalMemory && freeMemory !== null
    ? Math.max(0, Math.min(100, Math.round(((totalMemory - freeMemory) / totalMemory) * 100)))
    : null;

  return {
    ok: true,
    latencyMs: resourceRes.latencyMs,
    statusCode: resourceRes.statusCode,
    message: `MikroTik REST success from ${basePath}; ${interfaceFetchMessage}`,
    metrics: {
      cpuPercent: toNumberOrNull(resource["cpu-load"]),
      memoryPercent: usedMemoryPercent,
      uptimeSeconds: parseMikrotikUptimeSeconds(resource.uptime),
      temperatureC: toNumberOrNull(health.temperature ?? health["board-temperature"] ?? health["cpu-temperature"]),
      voltage: toNumberOrNull(health.voltage ?? health["input-voltage"]),
      interfaceDownCount: downInterfaces,
      activeAlarmCount: 0,
      interfacesJson: JSON.stringify({
        items: compactInterfaces,
        fetchMessage: interfaceFetchMessage,
      }),
    },
  };
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
  if (protocol === "mikrotik_rest" || protocol === "mikrotik_rest_http") return probeMikrotikRest(device);
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
