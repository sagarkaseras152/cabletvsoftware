import { prisma } from "../db.js";
import { createReceiptNumber } from "../lib/receipt.js";

export async function applyCustomerPayment({
  tenantId,
  customerId,
  amountPaid,
  paymentMode = "cash",
  paymentDate = new Date().toISOString(),
}) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  const paidAmount = Number(amountPaid || customer.dueAmount || 0);
  if (!paidAmount || paidAmount <= 0) {
    throw new Error("Valid payment amount is required");
  }

  const item = await prisma.payment.create({
    data: {
      id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      customerId: customer.id,
      receiptNumber: createReceiptNumber(),
      customerName: customer.name,
      amountPaid: paidAmount,
      paymentMode,
      paymentDate,
      status: "success",
    },
  });

  const remainingDue = Math.max(0, Number(customer.dueAmount || 0) - paidAmount);
  const nextDueDate = customer.dueDate || new Date().toISOString().slice(0, 10);

  const updatedCustomer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      dueAmount: remainingDue,
      status: remainingDue > 0 ? customer.status : "active",
      dueDate: nextDueDate,
    },
  });

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { monthlyCollection: { increment: item.amountPaid } },
  });

  return {
    item,
    customer: updatedCustomer,
  };
}
