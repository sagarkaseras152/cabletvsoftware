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
  const payload = { ...(req.body || {}) };
  if (payload.billingDay !== undefined) payload.billingDay = Number(payload.billingDay || 1);
  if (payload.lateFee !== undefined) payload.lateFee = Number(payload.lateFee || 0);
  if (payload.defaultInformInterval !== undefined) payload.defaultInformInterval = Number(payload.defaultInformInterval || 300);
  if (payload.autoApproveOnts !== undefined) {
    payload.autoApproveOnts = payload.autoApproveOnts === true || payload.autoApproveOnts === "true";
  }

  const existing = await prisma.tenantSetting.findUnique({ where: { tenantId: req.context.tenantId } });
  const item = existing
    ? await prisma.tenantSetting.update({ where: { tenantId: req.context.tenantId }, data: payload })
    : await prisma.tenantSetting.create({ data: { tenantId: req.context.tenantId, ...payload } });
  res.json({ ok: true, item });
});

export default router;
