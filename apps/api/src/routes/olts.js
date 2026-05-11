import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.olt.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, count: items.length, items });
});

router.post("/", async (req, res) => {
  const {
    name,
    vendor = "syrotech",
    model = "",
    ipAddress,
    username = "",
    password = "",
    firmware = "",
    location = "",
    ponPorts = 0,
  } = req.body || {};

  if (!name || !ipAddress) {
    return res.status(400).json({ ok: false, message: "name and ipAddress are required" });
  }

  const item = await prisma.olt.create({
    data: {
      id: `olt-${Date.now()}`,
      tenantId: req.context.tenantId,
      name,
      vendor,
      model,
      ipAddress,
      username,
      password,
      firmware,
      location,
      ponPorts: Number(ponPorts || 0),
      status: "active",
    },
  });

  res.status(201).json({ ok: true, item });
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.olt.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "OLT not found" });

  const item = await prisma.olt.update({
    where: { id: existing.id },
    data: {
      ...(req.body || {}),
      ...(req.body?.ponPorts !== undefined ? { ponPorts: Number(req.body.ponPorts || 0) } : {}),
    },
  });

  res.json({ ok: true, item });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.olt.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "OLT not found" });

  await prisma.ont.updateMany({
    where: { oltId: existing.id, tenantId: req.context.tenantId },
    data: { oltId: null },
  });

  await prisma.olt.delete({ where: { id: existing.id } });
  res.json({ ok: true, message: "OLT deleted" });
});

export default router;
