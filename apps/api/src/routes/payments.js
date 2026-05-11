import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { applyCustomerPayment } from "../services/paymentService.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.payment.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, totalAmount: items.reduce((sum, item) => sum + item.amountPaid, 0), items });
});

router.get("/requests", async (req, res) => {
  const items = await prisma.paymentRequest.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, items });
});

router.post("/collect", async (req, res) => {
  const { customerId, amountPaid, paymentMode = "cash" } = req.body || {};
  try {
    const result = await applyCustomerPayment({
      tenantId: req.context.tenantId,
      customerId,
      amountPaid,
      paymentMode,
      paymentDate: new Date().toISOString(),
    });

    res.status(201).json({
      ok: true,
      message: "Payment collected",
      item: result.item,
      customer: result.customer,
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error?.message || "Payment failed" });
  }
});

router.post("/requests/:id/approve", async (req, res) => {
  const requestItem = await prisma.paymentRequest.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!requestItem) return res.status(404).json({ ok: false, message: "Payment request not found" });
  if (requestItem.status !== "pending") {
    return res.status(400).json({ ok: false, message: "This payment request is already reviewed" });
  }

  try {
    const result = await applyCustomerPayment({
      tenantId: req.context.tenantId,
      customerId: requestItem.customerId,
      amountPaid: requestItem.amount,
      paymentMode: requestItem.paymentMode || "upi_qr",
      paymentDate: requestItem.paidAt || new Date().toISOString(),
    });

    const updatedRequest = await prisma.paymentRequest.update({
      where: { id: requestItem.id },
      data: {
        status: "approved",
        reviewedBy: req.context.userId,
        reviewedAt: new Date(),
        linkedPaymentId: result.item.id,
      },
    });

    return res.json({
      ok: true,
      message: "Payment approved and posted successfully",
      item: updatedRequest,
      payment: result.item,
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error?.message || "Approval failed" });
  }
});

router.post("/requests/:id/reject", async (req, res) => {
  const requestItem = await prisma.paymentRequest.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!requestItem) return res.status(404).json({ ok: false, message: "Payment request not found" });
  if (requestItem.status !== "pending") {
    return res.status(400).json({ ok: false, message: "This payment request is already reviewed" });
  }

  const updated = await prisma.paymentRequest.update({
    where: { id: requestItem.id },
    data: {
      status: "rejected",
      reviewedBy: req.context.userId,
      reviewedAt: new Date(),
    },
  });

  res.json({ ok: true, message: "Payment request rejected", item: updated });
});

export default router;
