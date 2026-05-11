import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { search = "" } = req.query;
  const where = {
    tenantId: req.context.tenantId,
    ...(search
      ? {
          OR: [
            { name: { contains: String(search) } },
            { mobile: { contains: String(search) } },
            { customerCode: { contains: String(search) } },
          ],
        }
      : {}),
  };
  const items = await prisma.customer.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json({ ok: true, count: items.length, items });
});

router.get("/:id", async (req, res) => {
  const item = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!item) return res.status(404).json({ ok: false, message: "Customer not found" });
  res.json({ ok: true, item });
});

router.post("/", async (req, res) => {
  const {
    name,
    mobile,
    area = "",
    packageId = null,
    packageName = "",
    dueAmount = 0,
    dueDate = "",
    connectionType = "both",
  } = req.body || {};
  if (!name || !mobile) return res.status(400).json({ ok: false, message: "name and mobile are required" });

  const count = await prisma.customer.count({ where: { tenantId: req.context.tenantId } });
  let resolvedPackageName = packageName;
  if (packageId) {
    const selectedPackage = await prisma.package.findFirst({
      where: { id: packageId, tenantId: req.context.tenantId },
    });
    if (selectedPackage) {
      resolvedPackageName = selectedPackage.name;
      await prisma.package.update({
        where: { id: selectedPackage.id },
        data: { customers: { increment: 1 } },
      });
    }
  }
  const item = await prisma.customer.create({
    data: {
      id: `cust-${Date.now()}`,
      tenantId: req.context.tenantId,
      customerCode: `CUS-${count + 1}`,
      name,
      mobile,
      area,
      packageId,
      packageName: resolvedPackageName,
      dueAmount: Number(dueAmount || 0),
      dueDate,
      expiryDate: dueDate,
      status: "active",
      connectionType,
    },
  });
  res.status(201).json({ ok: true, item });
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Customer not found" });

  const updates = { ...(req.body || {}) };
  if (updates.packageId) {
    const selectedPackage = await prisma.package.findFirst({
      where: { id: updates.packageId, tenantId: req.context.tenantId },
    });
    if (!selectedPackage) return res.status(400).json({ ok: false, message: "Package not found" });

    if (existing.packageId && existing.packageId !== selectedPackage.id) {
      await prisma.package.update({
        where: { id: existing.packageId },
        data: { customers: { decrement: 1 } },
      }).catch(() => {});
    }

    if (existing.packageId !== selectedPackage.id) {
      await prisma.package.update({
        where: { id: selectedPackage.id },
        data: { customers: { increment: 1 } },
      });
    }

    updates.packageName = selectedPackage.name;
  }

  const item = await prisma.customer.update({
    where: { id: existing.id },
    data: updates,
  });
  res.json({ ok: true, item });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Customer not found" });

  if (existing.packageId) {
    await prisma.package.update({
      where: { id: existing.packageId },
      data: { customers: { decrement: 1 } },
    }).catch(() => {});
  }

  await prisma.customer.delete({ where: { id: existing.id } });
  res.json({ ok: true, message: "Customer deleted" });
});

export default router;
