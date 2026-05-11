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

  const item = await prisma.recharge.create({
    data: {
      id: `rch-${Date.now()}`,
      tenantId: req.context.tenantId,
      customerId: customer.id,
      customerName: customer.name,
      mode,
      status: mode === "internal" ? "activated_internal" : "activation_pending",
      amount: Number(amount || customer.dueAmount || 0),
      oldExpiryDate: customer.expiryDate,
      newExpiryDate: customer.expiryDate,
    },
  });
  res.status(201).json({ ok: true, message: "Recharge created", item });
});

export default router;
