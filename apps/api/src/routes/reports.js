import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const payments = await prisma.payment.findMany({ where: { tenantId: req.context.tenantId } });
  const expenses = await prisma.expense.findMany({ where: { tenantId: req.context.tenantId } });

  const items = [
    {
      id: "report-collection",
      name: "Collection Summary",
      format: "live",
      generatedAt: new Date().toISOString(),
      totalCollection: payments.reduce((sum, item) => sum + item.amountPaid, 0),
      totalExpense: expenses.reduce((sum, item) => sum + item.amount, 0),
    },
  ];

  res.json({ ok: true, items });
});

export default router;
