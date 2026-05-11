import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.ont.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, count: items.length, items });
});

router.post("/", async (req, res) => {
  const {
    serialNumber,
    vendor = "syrotech",
    model = "",
    oltId = null,
    customerId = null,
    macAddress = "",
    ponPort = "",
    onuIndex = "",
    tr069Enabled = false,
    acsProfile = "tr181",
    connectionRequestUrl = "",
    connectionRequestUser = "",
    connectionRequestPass = "",
    wifiSsidPath = "",
    wifiPasswordPath = "",
    wifiSsid = "",
    wifiPassword = "",
    wanMode = "pppoe",
    pppoeUsername = "",
    pppoePassword = "",
  } = req.body || {};

  if (!serialNumber) {
    return res.status(400).json({ ok: false, message: "serialNumber is required" });
  }

  const item = await prisma.ont.create({
    data: {
      id: `ont-${Date.now()}`,
      tenantId: req.context.tenantId,
      serialNumber,
      vendor,
      model,
      oltId,
      customerId,
      macAddress,
      ponPort,
      onuIndex,
      tr069Enabled: Boolean(tr069Enabled),
      acsProfile,
      connectionRequestUrl,
      connectionRequestUser,
      connectionRequestPass,
      wifiSsidPath,
      wifiPasswordPath,
      wifiSsid,
      wifiPassword,
      wanMode,
      pppoeUsername,
      pppoePassword,
      status: "offline",
    },
  });

  res.status(201).json({ ok: true, item });
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.ont.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "ONT not found" });

  const data = { ...(req.body || {}) };
  if (data.tr069Enabled !== undefined) data.tr069Enabled = Boolean(data.tr069Enabled);

  const item = await prisma.ont.update({
    where: { id: existing.id },
    data,
  });

  res.json({ ok: true, item });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.ont.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "ONT not found" });

  await prisma.acsTask.deleteMany({ where: { ontId: existing.id, tenantId: req.context.tenantId } });
  await prisma.ont.delete({ where: { id: existing.id } });
  res.json({ ok: true, message: "ONT deleted" });
});

export default router;
