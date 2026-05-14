import { randomBytes } from "crypto";
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { recordMonitoringTelemetry } from "../services/monitoringEngine.js";

const router = Router();

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function makeToken() {
  return randomBytes(24).toString("hex");
}
router.post("/agent/register", async (req, res) => {
  const payload = req.body || {};
  const agent = await prisma.edgeAgent.findUnique({
    where: { token: String(payload.token || "") },
  });
  if (!agent) return res.status(404).json({ ok: false, message: "Invalid agent token" });

  const item = await prisma.edgeAgent.update({
    where: { id: agent.id },
    data: {
      status: "online",
      lastSeenAt: new Date(),
      lastIpAddress: req.ip || null,
      lastMessage: payload.message || "registered",
    },
  });

  res.json({
    ok: true,
    item: {
      id: item.id,
      name: item.name,
      tenantId: item.tenantId,
      pollIntervalMs: 10000,
    },
  });
});

router.post("/agent/pull", async (req, res) => {
  const payload = req.body || {};
  const agent = await prisma.edgeAgent.findUnique({
    where: { token: String(payload.token || "") },
  });
  if (!agent) return res.status(404).json({ ok: false, message: "Invalid agent token" });

  await prisma.edgeAgent.update({
    where: { id: agent.id },
    data: {
      status: "online",
      lastSeenAt: new Date(),
      lastIpAddress: req.ip || null,
      lastMessage: payload.message || "heartbeat",
    },
  });

  const tasks = await prisma.edgeTask.findMany({
    where: {
      tenantId: agent.tenantId,
      agentId: agent.id,
      status: "queued",
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  res.json({ ok: true, items: tasks });
});

router.post("/agent/tasks/:id/result", async (req, res) => {
  const payload = req.body || {};
  const task = await prisma.edgeTask.findFirst({
    where: { id: req.params.id },
    include: { agent: true },
  });
  if (!task) return res.status(404).json({ ok: false, message: "Task not found" });
  if (task.agent.token !== String(payload.token || "")) {
    return res.status(403).json({ ok: false, message: "Invalid agent token for task" });
  }

  const item = await prisma.edgeTask.update({
    where: { id: task.id },
    data: {
      status: payload.status || "completed",
      resultJson: payload.resultJson ? JSON.stringify(payload.resultJson).slice(0, 4000) : null,
      errorMessage: payload.errorMessage ? String(payload.errorMessage).slice(0, 500) : null,
      completedAt: new Date(),
    },
  });

  if (task.taskType === "snmp_poll" && payload.status === "completed") {
    const taskPayload = task.payloadJson ? JSON.parse(task.payloadJson) : {};
    const deviceId = taskPayload.deviceId;
    if (deviceId) {
      const device = await prisma.monitoredDevice.findFirst({
        where: {
          id: deviceId,
          tenantId: task.tenantId,
        },
      });
      if (device) {
        await recordMonitoringTelemetry(device, {
          eventType: "edge_snmp_poll",
          status: "online",
          ...(payload.resultJson || {}),
          message: payload.errorMessage || payload.resultJson?.message || "Edge SNMP poll complete",
          lastPollAt: new Date(),
          lastPollStatusCode: 200,
          pollFailures: 0,
        });
      }
    }
  }

  if (task.taskType === "snmp_poll" && payload.status === "failed") {
    const taskPayload = task.payloadJson ? JSON.parse(task.payloadJson) : {};
    const deviceId = taskPayload.deviceId;
    if (deviceId) {
      const device = await prisma.monitoredDevice.findFirst({
        where: {
          id: deviceId,
          tenantId: task.tenantId,
        },
      });
      if (device) {
        await recordMonitoringTelemetry(device, {
          eventType: "edge_snmp_poll",
          status: "offline",
          message: payload.errorMessage || "Edge SNMP poll failed",
          latencyMs: taskPayload.pollTimeoutMs || 5000,
          packetLossPercent: 100,
          lastPollAt: new Date(),
          lastPollStatusCode: 503,
          pollFailures: Number(device.pollFailures || 0) + 1,
        });
      }
    }
  }

  await prisma.edgeAgent.update({
    where: { id: task.agentId },
    data: {
      status: "online",
      lastSeenAt: new Date(),
      lastMessage: payload.errorMessage || "task result received",
    },
  });

  res.json({ ok: true, item });
});

router.use(requireAuth);

router.get("/overview", async (req, res) => {
  const tenantId = req.context.tenantId;
  const [agents, tasks] = await Promise.all([
    prisma.edgeAgent.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.edgeTask.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  res.json({
    ok: true,
    items: {
      agents,
      tasks,
      summary: {
        totalAgents: agents.length,
        onlineAgents: agents.filter((item) => item.status === "online").length,
        queuedTasks: tasks.filter((item) => item.status === "queued").length,
      },
    },
  });
});

router.post("/agents", async (req, res) => {
  const payload = req.body || {};
  if (!payload.name) {
    return res.status(400).json({ ok: false, message: "name is required" });
  }

  const item = await prisma.edgeAgent.create({
    data: {
      id: makeId("agent"),
      tenantId: req.context.tenantId,
      name: String(payload.name).trim(),
      vpnMode: payload.vpnMode || "existing_vpn",
      note: payload.note || null,
      token: makeToken(),
    },
  });

  res.status(201).json({ ok: true, item });
});

router.post("/agents/:id/ping", async (req, res) => {
  const payload = req.body || {};
  const agent = await prisma.edgeAgent.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!agent) return res.status(404).json({ ok: false, message: "Agent not found" });
  if (!payload.targetHost) return res.status(400).json({ ok: false, message: "targetHost is required" });

  const task = await prisma.edgeTask.create({
    data: {
      id: makeId("atask"),
      tenantId: req.context.tenantId,
      agentId: agent.id,
      taskType: "ping",
      targetHost: String(payload.targetHost).trim(),
      payloadJson: JSON.stringify({
        count: Number(payload.count || 2),
        timeoutMs: Number(payload.timeoutMs || 5000),
      }),
    },
  });

  res.status(201).json({ ok: true, item: task });
});

router.post("/agents/:id/regenerate-token", async (req, res) => {
  const agent = await prisma.edgeAgent.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!agent) return res.status(404).json({ ok: false, message: "Agent not found" });

  const item = await prisma.edgeAgent.update({
    where: { id: agent.id },
    data: { token: makeToken() },
  });

  res.json({ ok: true, item });
});

router.delete("/agents/:id", async (req, res) => {
  const agent = await prisma.edgeAgent.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!agent) return res.status(404).json({ ok: false, message: "Agent not found" });

  await prisma.edgeTask.deleteMany({ where: { tenantId: req.context.tenantId, agentId: agent.id } });
  await prisma.edgeAgent.delete({ where: { id: agent.id } });
  res.json({ ok: true, message: "Agent deleted" });
});

export default router;
