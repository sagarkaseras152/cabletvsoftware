import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.recharge.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, count: items.length, items });
});

router.post("/", async (req, res) => {
  const { customerId, mode = "assisted", amount = 0 } = req.body || {};
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ ok: false, message: "Customer not found" });

  let validityDays = 30;
  if (customer.packageId) {
    const pkg = await prisma.package.findUnique({ where: { id: customer.packageId } });
    if (pkg?.validityDays) validityDays = pkg.validityDays;
  }

  const today = new Date();
  const baseDate = customer.expiryDate ? new Date(customer.expiryDate) : today;
  const startDate = baseDate > today ? baseDate : today;
  const nextExpiry = new Date(startDate);
  nextExpiry.setDate(nextExpiry.getDate() + validityDays);
  const nextExpiryString = nextExpiry.toISOString().slice(0, 10);
  const rechargeAmount = Number(amount || customer.dueAmount || 0);

  const item = await prisma.recharge.create({
    data: {
      id: `rch-${Date.now()}`,
      tenantId: req.context.tenantId,
      customerId: customer.id,
      customerName: customer.name,
      mode,
      status: mode === "internal" ? "activated_internal" : "activation_pending",
      amount: rechargeAmount,
      oldExpiryDate: customer.expiryDate,
      newExpiryDate: nextExpiryString,
    },
  });

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      expiryDate: nextExpiryString,
      dueDate: nextExpiryString,
      dueAmount: 0,
      status: "active",
    },
  });

  res.status(201).json({ ok: true, message: "Recharge created", item, expiryDate: nextExpiryString });
});

export default router;
