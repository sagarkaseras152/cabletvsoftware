import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.package.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, count: items.length, items });
});

router.post("/", async (req, res) => {
  const { name, type = "internet", price, validityDays = 30 } = req.body || {};
  if (!name || !price) return res.status(400).json({ ok: false, message: "name and price are required" });

  const item = await prisma.package.create({
    data: {
      id: `pkg-${Date.now()}`,
      tenantId: req.context.tenantId,
      name,
      type,
      price: Number(price),
      validityDays: Number(validityDays),
      customers: 0,
    },
  });
  res.status(201).json({ ok: true, item });
});

export default router;
