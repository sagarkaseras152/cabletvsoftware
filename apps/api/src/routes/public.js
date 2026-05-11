import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

router.post("/payment-lookup", async (req, res) => {
  const { operatorCode = "", customerRef = "" } = req.body || {};
  const normalizedOperatorCode = String(operatorCode).trim().toUpperCase();
  const normalizedCustomerRef = String(customerRef).trim();

  if (!normalizedOperatorCode || !normalizedCustomerRef) {
    return res.status(400).json({ ok: false, message: "operatorCode and customerRef are required" });
  }

  const tenant = await prisma.tenant.findFirst({
    where: { code: normalizedOperatorCode },
    include: { settings: true },
  });
  if (!tenant) return res.status(404).json({ ok: false, message: "Operator not found" });

  const customer = await prisma.customer.findFirst({
    where: {
      tenantId: tenant.id,
      OR: [
        { mobile: normalizedCustomerRef },
        { customerCode: normalizedCustomerRef },
      ],
    },
  });
  if (!customer) return res.status(404).json({ ok: false, message: "Customer not found for this operator" });

  res.json({
    ok: true,
    operator: {
      code: tenant.code,
      businessName: tenant.businessName,
      paymentDisplayName: tenant.settings?.paymentDisplayName || tenant.settings?.companyName || tenant.businessName,
      upiId: tenant.settings?.upiId || "",
      qrImageUrl: tenant.settings?.qrImageUrl || "",
      qrInstructions: tenant.settings?.qrInstructions || "",
      supportMobile: tenant.settings?.supportMobile || tenant.mobile || "",
    },
    customer: {
      id: customer.id,
      customerCode: customer.customerCode,
      name: customer.name,
      mobile: customer.mobile,
      packageName: customer.packageName,
      dueAmount: customer.dueAmount,
      dueDate: customer.dueDate,
    },
  });
});

router.post("/payment-request", async (req, res) => {
  const { operatorCode = "", customerRef = "", amount = 0, utrNumber = "", note = "" } = req.body || {};
  const normalizedOperatorCode = String(operatorCode).trim().toUpperCase();
  const normalizedCustomerRef = String(customerRef).trim();
  const normalizedUtr = String(utrNumber || "").trim();
  const amountNumber = Number(amount || 0);

  if (!normalizedOperatorCode || !normalizedCustomerRef || !amountNumber) {
    return res.status(400).json({ ok: false, message: "operatorCode, customerRef and amount are required" });
  }

  const tenant = await prisma.tenant.findFirst({ where: { code: normalizedOperatorCode } });
  if (!tenant) return res.status(404).json({ ok: false, message: "Operator not found" });

  const customer = await prisma.customer.findFirst({
    where: {
      tenantId: tenant.id,
      OR: [
        { mobile: normalizedCustomerRef },
        { customerCode: normalizedCustomerRef },
      ],
    },
  });
  if (!customer) return res.status(404).json({ ok: false, message: "Customer not found for this operator" });

  if (normalizedUtr) {
    const existingRequest = await prisma.paymentRequest.findFirst({
      where: {
        tenantId: tenant.id,
        utrNumber: normalizedUtr,
        status: { in: ["pending", "approved"] },
      },
    });
    if (existingRequest) {
      return res.status(400).json({ ok: false, message: "This UTR is already submitted" });
    }
  }

  const requestItem = await prisma.paymentRequest.create({
    data: {
      id: `preq-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId: tenant.id,
      customerId: customer.id,
      customerName: customer.name,
      customerMobile: customer.mobile,
      amount: amountNumber,
      utrNumber: normalizedUtr || null,
      note: String(note || "").trim() || null,
      paidAt: new Date().toISOString(),
      status: "pending",
      paymentMode: "upi_qr",
    },
  });

  res.status(201).json({
    ok: true,
    message: "Payment request submitted. Operator approval pending.",
    item: requestItem,
  });
});

export default router;
