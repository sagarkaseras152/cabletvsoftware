import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const item = await prisma.tenantSetting.findUnique({ where: { tenantId: req.context.tenantId } });
  res.json({ ok: true, item });
});

router.post("/", async (req, res) => {
  const existing = await prisma.tenantSetting.findUnique({ where: { tenantId: req.context.tenantId } });
  const item = existing
    ? await prisma.tenantSetting.update({ where: { tenantId: req.context.tenantId }, data: req.body || {} })
    : await prisma.tenantSetting.create({ data: { tenantId: req.context.tenantId, ...(req.body || {}) } });
  res.json({ ok: true, item });
});

export default router;
