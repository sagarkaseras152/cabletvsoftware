import { Router } from "express";
import { prisma } from "../db.js";
import { createReceiptNumber } from "../lib/receipt.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.payment.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, totalAmount: items.reduce((sum, item) => sum + item.amountPaid, 0), items });
});

router.post("/collect", async (req, res) => {
  const { customerId, amountPaid, paymentMode = "cash" } = req.body || {};
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ ok: false, message: "Customer not found" });

  const item = await prisma.payment.create({
    data: {
      id: `pay-${Date.now()}`,
      tenantId: req.context.tenantId,
      customerId: customer.id,
      receiptNumber: createReceiptNumber(),
      customerName: customer.name,
      amountPaid: Number(amountPaid || customer.dueAmount || 0),
      paymentMode,
      paymentDate: new Date().toISOString(),
      status: "success",
    },
  });

  await prisma.tenant.update({
    where: { id: req.context.tenantId },
    data: { monthlyCollection: { increment: item.amountPaid } },
  });

  res.status(201).json({ ok: true, message: "Payment collected", item });
});

export default router;
