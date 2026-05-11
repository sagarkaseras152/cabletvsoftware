import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();
const customerPortalDefaultPassword = "123456";

async function buildCustomerPortalPayload(customerId) {
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode: customerId },
        { id: customerId },
      ],
    },
  });
  if (!customer) return null;

  const [tenant, payments, paymentRequests] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: customer.tenantId },
      include: { settings: true },
    }),
    prisma.payment.findMany({
      where: { tenantId: customer.tenantId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.paymentRequest.findMany({
      where: { tenantId: customer.tenantId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  if (!tenant) return null;

  return {
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
      portalId: customer.customerCode,
      customerCode: customer.customerCode,
      name: customer.name,
      mobile: customer.mobile,
      area: customer.area,
      packageName: customer.packageName,
      connectionType: customer.connectionType,
      dueAmount: customer.dueAmount,
      dueDate: customer.dueDate,
      expiryDate: customer.expiryDate,
      status: customer.status,
    },
    payments,
    paymentRequests,
  };
}

router.get("/customer-portal/:customerId", async (req, res) => {
  const payload = await buildCustomerPortalPayload(req.params.customerId);
  if (!payload) return res.status(404).json({ ok: false, message: "Customer portal not found" });

  res.json({ ok: true, ...payload });
});

router.post("/customer-login", async (req, res) => {
  const { customerId = "", password = "" } = req.body || {};
  const portalId = String(customerId || "").trim();
  if (!portalId) {
    return res.status(400).json({ ok: false, message: "customerId is required" });
  }
  if (String(password || "") !== customerPortalDefaultPassword) {
    return res.status(401).json({ ok: false, message: "Invalid portal password" });
  }

  const payload = await buildCustomerPortalPayload(portalId);
  if (!payload) return res.status(404).json({ ok: false, message: "Customer portal not found" });

  res.json({ ok: true, ...payload });
});

router.post("/payment-request", async (req, res) => {
  const { customerId = "", amount = 0, utrNumber = "", note = "" } = req.body || {};
  const normalizedCustomerId = String(customerId).trim();
  const normalizedUtr = String(utrNumber || "").trim();
  const amountNumber = Number(amount || 0);

  if (!normalizedCustomerId || !amountNumber) {
    return res.status(400).json({ ok: false, message: "customerId and amount are required" });
  }

  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode: normalizedCustomerId },
        { id: normalizedCustomerId },
      ],
    },
  });
  if (!customer) return res.status(404).json({ ok: false, message: "Customer portal not found" });

  if (normalizedUtr) {
    const existingRequest = await prisma.paymentRequest.findFirst({
      where: {
        tenantId: customer.tenantId,
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
      tenantId: customer.tenantId,
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
