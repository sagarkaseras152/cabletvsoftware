import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.expense.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, total: items.reduce((sum, item) => sum + item.amount, 0), items });
});

router.post("/", async (req, res) => {
  const { title, category, amount, expenseDate } = req.body || {};
  if (!title || !category || !amount || !expenseDate) {
    return res.status(400).json({ ok: false, message: "title, category, amount, expenseDate are required" });
  }
  const item = await prisma.expense.create({
    data: {
      id: `exp-${Date.now()}`,
      tenantId: req.context.tenantId,
      title,
      category,
      amount: Number(amount),
      expenseDate,
    },
  });
  res.status(201).json({ ok: true, item });
});

export default router;
