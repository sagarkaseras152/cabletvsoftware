import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.staffMember.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, items });
});

router.post("/", async (req, res) => {
  const { name, mobile, role = "operator" } = req.body || {};
  if (!name || !mobile) return res.status(400).json({ ok: false, message: "name and mobile are required" });

  const item = await prisma.staffMember.create({
    data: {
      id: `staff-${Date.now()}`,
      tenantId: req.context.tenantId,
      name,
      mobile,
      role,
      status: "active",
    },
  });
  res.status(201).json({ ok: true, item });
});

export default router;
