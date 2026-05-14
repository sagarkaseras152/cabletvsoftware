import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  buildAnalysis,
  makeId,
  makeIngestKey,
  recordMonitoringTelemetry,
  safeInt,
} from "../services/monitoringEngine.js";
import { pollMonitoredDevice } from "../services/monitoringPoller.js";

const router = Router();

async function queueEdgeSnmpPoll(tenantId, existing) {
  return prisma.edgeTask.create({
    data: {
      id: makeId("atask"),
      tenantId,
      agentId: existing.edgeAgentId,
      taskType: "snmp_poll",
      targetHost: existing.host || null,
      targetPort: existing.port || 161,
      payloadJson: JSON.stringify({
        deviceId: existing.id,
        host: existing.host,
        port: existing.port || 161,
        snmpCommunity: existing.snmpCommunity,
        snmpVersion: existing.snmpVersion || "2c",
        metricProfile: existing.metricProfile || "generic_system",
        customOidMapJson: existing.customOidMapJson || null,
        pollTimeoutMs: existing.pollTimeoutMs || 5000,
      }),
    },
  });
}

async function mikrotikRestPatch(device, path, body) {
  const protocol = String(device.protocol || "").toLowerCase();
  const isHttp = protocol === "mikrotik_rest_http";
  const basePath = (device.pollPath || "/rest").replace(/\/+$/, "");
  const port = Number(device.port || (isHttp ? 80 : 443));
  const authHeader = `Basic ${Buffer.from(`${device.authUsername}:${device.authPassword}`).toString("base64")}`;
  const response = await fetch(`${isHttp ? "http" : "https"}://${device.host}:${port}${basePath}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

router.post("/ingest/:ingestKey", async (req, res) => {
  const device = await prisma.monitoredDevice.findUnique({
    where: { ingestKey: req.params.ingestKey },
  });

  if (!device) {
    return res.status(404).json({ ok: false, message: "Monitoring device not found" });
  }

  const response = await recordMonitoringTelemetry(device, req.body || {});
  res.json({ ok: true, ...response });
});

router.use(requireAuth);

router.get("/overview", async (req, res) => {
  const tenantId = req.context.tenantId;
  const [devices, alerts, snapshots] = await Promise.all([
    prisma.monitoredDevice.findMany({
      where: { tenantId },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.deviceAlert.findMany({
      where: { tenantId },
      include: {
        device: {
          select: {
            id: true,
            name: true,
            deviceType: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { lastDetectedAt: "desc" }],
      take: 80,
    }),
    prisma.deviceSnapshot.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 120,
    }),
  ]);

  const snapshotsByDevice = new Map();
  snapshots.forEach((item) => {
    if (!snapshotsByDevice.has(item.deviceId)) snapshotsByDevice.set(item.deviceId, []);
    const list = snapshotsByDevice.get(item.deviceId);
    if (list.length < 6) list.push(item);
  });

  const items = devices.map((device) => ({
    ...device,
    analysis: buildAnalysis(device, snapshotsByDevice.get(device.id) || []),
  }));

  const summary = {
    totalDevices: items.length,
    onlineDevices: items.filter((item) => item.status === "online").length,
    criticalDevices: items.filter((item) => item.analysis.healthStatus === "critical").length,
    warningDevices: items.filter((item) => item.analysis.healthStatus === "warning").length,
    openAlerts: alerts.filter((item) => item.status === "open").length,
    highRiskDevices: items.filter((item) => item.analysis.riskScore >= 70).length,
  };

  res.json({
    ok: true,
    items: {
      devices: items,
      alerts,
      recentSnapshots: snapshots,
      summary,
    },
  });
});

router.post("/devices", async (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.deviceType) {
    return res.status(400).json({ ok: false, message: "name and deviceType are required" });
  }

  const item = await prisma.monitoredDevice.create({
    data: {
      id: makeId("mdev"),
      tenantId: req.context.tenantId,
      name: String(payload.name).trim(),
      deviceType: String(payload.deviceType).trim(),
      vendor: payload.vendor || null,
      model: payload.model || null,
      host: payload.host || null,
      port: safeInt(payload.port),
      edgeAgentId: payload.edgeAgentId || null,
      protocol: payload.protocol || "snmp",
      snmpVersion: payload.snmpVersion || "2c",
      snmpCommunity: payload.snmpCommunity || null,
      metricProfile: payload.metricProfile || (payload.protocol === "snmp" ? "generic_system" : null),
      customOidMapJson: payload.customOidMapJson || null,
      monitorMode: payload.monitorMode || "push",
      ingestKey: makeIngestKey(),
      expectedIntervalSec: safeInt(payload.expectedIntervalSec) || 300,
      pollEnabled: Boolean(payload.pollEnabled),
      pollPath: payload.pollPath || null,
      pollTimeoutMs: safeInt(payload.pollTimeoutMs) || 5000,
      authUsername: payload.authUsername || null,
      authPassword: payload.authPassword || null,
      linkedOltId: payload.linkedOltId || null,
      linkedOntId: payload.linkedOntId || null,
      linkedCustomerId: payload.linkedCustomerId || null,
      note: payload.note || null,
    },
  });

  let autoMessage = "Monitoring device created";
  if (item.protocol === "snmp" && item.monitorMode === "edge_agent_snmp" && item.edgeAgentId) {
    await queueEdgeSnmpPoll(req.context.tenantId, item);
    autoMessage = "Monitoring device created. Auto SNMP discovery queued.";
  } else if (item.pollEnabled && item.monitorMode === "active_poll") {
    await pollMonitoredDevice(item);
    autoMessage = "Monitoring device created. Initial poll started.";
  }

  res.status(201).json({ ok: true, item, message: autoMessage });
});

router.patch("/devices/:id", async (req, res) => {
  const existing = await prisma.monitoredDevice.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Monitoring device not found" });

  const payload = req.body || {};
  const item = await prisma.monitoredDevice.update({
    where: { id: existing.id },
    data: {
      name: payload.name ?? existing.name,
      deviceType: payload.deviceType ?? existing.deviceType,
      vendor: payload.vendor ?? existing.vendor,
      model: payload.model ?? existing.model,
      host: payload.host ?? existing.host,
      port: payload.port !== undefined ? safeInt(payload.port) : existing.port,
      edgeAgentId: payload.edgeAgentId !== undefined ? payload.edgeAgentId || null : existing.edgeAgentId,
      protocol: payload.protocol ?? existing.protocol,
      snmpVersion: payload.snmpVersion ?? existing.snmpVersion,
      snmpCommunity: payload.snmpCommunity !== undefined ? payload.snmpCommunity || null : existing.snmpCommunity,
      metricProfile: payload.metricProfile !== undefined ? payload.metricProfile || null : existing.metricProfile,
      customOidMapJson: payload.customOidMapJson !== undefined ? payload.customOidMapJson || null : existing.customOidMapJson,
      monitorMode: payload.monitorMode ?? existing.monitorMode,
      expectedIntervalSec: payload.expectedIntervalSec !== undefined ? safeInt(payload.expectedIntervalSec) || existing.expectedIntervalSec : existing.expectedIntervalSec,
      pollEnabled: payload.pollEnabled !== undefined ? Boolean(payload.pollEnabled) : existing.pollEnabled,
      pollPath: payload.pollPath !== undefined ? payload.pollPath || null : existing.pollPath,
      pollTimeoutMs: payload.pollTimeoutMs !== undefined ? safeInt(payload.pollTimeoutMs) || existing.pollTimeoutMs : existing.pollTimeoutMs,
      authUsername: payload.authUsername !== undefined ? payload.authUsername || null : existing.authUsername,
      authPassword: payload.authPassword !== undefined ? payload.authPassword || null : existing.authPassword,
      linkedOltId: payload.linkedOltId !== undefined ? payload.linkedOltId || null : existing.linkedOltId,
      linkedOntId: payload.linkedOntId !== undefined ? payload.linkedOntId || null : existing.linkedOntId,
      linkedCustomerId: payload.linkedCustomerId !== undefined ? payload.linkedCustomerId || null : existing.linkedCustomerId,
      note: payload.note !== undefined ? payload.note || null : existing.note,
    },
  });

  res.json({ ok: true, item });
});

router.post("/devices/:id/regenerate-key", async (req, res) => {
  const existing = await prisma.monitoredDevice.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Monitoring device not found" });

  const item = await prisma.monitoredDevice.update({
    where: { id: existing.id },
    data: { ingestKey: makeIngestKey() },
  });

  res.json({ ok: true, item });
});

router.post("/devices/:id/poll", async (req, res) => {
  const existing = await prisma.monitoredDevice.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Monitoring device not found" });

  if (existing.monitorMode === "edge_agent_snmp") {
    if (!existing.edgeAgentId) {
      return res.status(400).json({ ok: false, message: "Edge agent not linked for this device" });
    }
    const task = await queueEdgeSnmpPoll(req.context.tenantId, existing);

    return res.json({ ok: true, queued: true, item: task, message: "Edge SNMP poll queued" });
  }

  const response = await pollMonitoredDevice(existing);
  res.json({ ok: true, ...response, message: "Manual poll complete" });
});

router.post("/devices/:id/snmp-walk", async (req, res) => {
  const existing = await prisma.monitoredDevice.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Monitoring device not found" });
  if (String(existing.protocol || "").toLowerCase() !== "snmp") {
    return res.status(400).json({ ok: false, message: "SNMP walk sirf SNMP devices ke liye available hai" });
  }
  if (!existing.edgeAgentId) {
    return res.status(400).json({ ok: false, message: "SNMP walk ke liye edge agent linked hona chahiye" });
  }

  const payload = req.body || {};
  const task = await prisma.edgeTask.create({
    data: {
      id: makeId("atask"),
      tenantId: req.context.tenantId,
      agentId: existing.edgeAgentId,
      taskType: "snmp_walk",
      targetHost: existing.host || null,
      targetPort: existing.port || 161,
      payloadJson: JSON.stringify({
        deviceId: existing.id,
        host: existing.host,
        port: existing.port || 161,
        snmpCommunity: existing.snmpCommunity,
        snmpVersion: existing.snmpVersion || "2c",
        pollTimeoutMs: existing.pollTimeoutMs || 5000,
        baseOid: payload.baseOid || "1.3.6.1.2.1",
        maxEntries: safeInt(payload.maxEntries) || 240,
      }),
    },
  });

  res.status(201).json({ ok: true, item: task, message: "SNMP raw walk queued" });
});

router.post("/devices/:id/ports/:portId/:command", async (req, res) => {
  const existing = await prisma.monitoredDevice.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Monitoring device not found" });

  const protocol = String(existing.protocol || "").toLowerCase();
  if (protocol !== "mikrotik_rest" && protocol !== "mikrotik_rest_http") {
    return res.status(400).json({ ok: false, message: "Port actions currently supported only for MikroTik REST devices" });
  }
  if (!existing.authUsername || !existing.authPassword) {
    return res.status(400).json({ ok: false, message: "Device auth missing for port action" });
  }

  const disabled = req.params.command === "disable";
  if (!["enable", "disable"].includes(req.params.command)) {
    return res.status(400).json({ ok: false, message: "Unsupported port command" });
  }

  const action = await mikrotikRestPatch(existing, `/interface/${encodeURIComponent(req.params.portId)}`, {
    disabled: disabled ? "true" : "false",
  });

  if (!action.ok) {
    return res.status(action.status || 500).json({
      ok: false,
      message: action.payload?.message || action.payload?.detail || "Port action failed",
      detail: action.payload,
    });
  }

  const refreshed = await pollMonitoredDevice(existing);
  res.json({
    ok: true,
    message: `Port ${req.params.command} successful`,
    ...refreshed,
  });
});

router.delete("/devices/:id", async (req, res) => {
  const existing = await prisma.monitoredDevice.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Monitoring device not found" });

  await prisma.$transaction([
    prisma.deviceAlert.deleteMany({ where: { deviceId: existing.id, tenantId: req.context.tenantId } }),
    prisma.deviceSnapshot.deleteMany({ where: { deviceId: existing.id, tenantId: req.context.tenantId } }),
    prisma.monitoredDevice.delete({ where: { id: existing.id } }),
  ]);

  res.json({ ok: true, message: "Monitoring device deleted" });
});

export default router;
