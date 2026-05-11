import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.package.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, count: items.length, items });
});

router.get("/:id", async (req, res) => {
  const item = await prisma.package.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!item) return res.status(404).json({ ok: false, message: "Package not found" });
  res.json({ ok: true, item });
});

router.post("/", async (req, res) => {
  const { name, type = "internet", price, validityDays = 30 } = req.body || {};
  if (!name || !price) return res.status(400).json({ ok: false, message: "name and price are required" });

  const item = await prisma.package.create({
    data: {
      id: `pkg-${Date.now()}`,
      tenantId: req.context.tenantId,
      name,
      type,
      price: Number(price),
      validityDays: Number(validityDays),
      customers: 0,
    },
  });
  res.status(201).json({ ok: true, item });
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.package.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Package not found" });

  const item = await prisma.package.update({
    where: { id: existing.id },
    data: {
      ...(req.body || {}),
      ...(req.body?.price ? { price: Number(req.body.price) } : {}),
      ...(req.body?.validityDays ? { validityDays: Number(req.body.validityDays) } : {}),
    },
  });

  if (item.name !== existing.name) {
    await prisma.customer.updateMany({
      where: { tenantId: req.context.tenantId, packageId: item.id },
      data: { packageName: item.name },
    });
  }

  res.json({ ok: true, item });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.package.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Package not found" });

  const linkedCustomers = await prisma.customer.count({
    where: { tenantId: req.context.tenantId, packageId: existing.id },
  });
  if (linkedCustomers > 0) {
    return res.status(400).json({
      ok: false,
      message: "Package is assigned to customers. Reassign customers before deleting.",
    });
  }

  await prisma.package.delete({ where: { id: existing.id } });
  res.json({ ok: true, message: "Package deleted" });
});

export default router;
