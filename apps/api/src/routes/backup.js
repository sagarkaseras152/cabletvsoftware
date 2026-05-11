import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePlatformOwner } from "../middleware/access.js";

const router = Router();
router.use(requireAuth);
router.use(requirePlatformOwner);

const modelOrder = [
  ["tenants", prisma.tenant],
  ["users", prisma.user],
  ["packages", prisma.package],
  ["customers", prisma.customer],
  ["payments", prisma.payment],
  ["paymentRequests", prisma.paymentRequest],
  ["recharges", prisma.recharge],
  ["staffMembers", prisma.staffMember],
  ["expenses", prisma.expense],
  ["tenantSettings", prisma.tenantSetting],
  ["olts", prisma.olt],
  ["onts", prisma.ont],
  ["acsTasks", prisma.acsTask],
  ["acsEvents", prisma.acsEvent],
];

router.get("/export", async (_req, res) => {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    version: 1,
  };

  for (const [key, model] of modelOrder) {
    snapshot[key] = await model.findMany();
  }

  res.json({ ok: true, snapshot });
});

router.post("/import", async (req, res) => {
  const { snapshot } = req.body || {};
  if (!snapshot || typeof snapshot !== "object") {
    return res.status(400).json({ ok: false, message: "snapshot is required" });
  }

  const summary = {};

  for (const [key, model] of modelOrder) {
    const items = Array.isArray(snapshot[key]) ? snapshot[key] : [];
    let count = 0;

    for (const item of items) {
      if (!item?.id && key !== "tenantSettings") continue;

      if (key === "tenantSettings") {
        await model.upsert({
          where: { tenantId: item.tenantId },
          update: { ...item },
          create: { ...item },
        });
      } else {
        await model.upsert({
          where: { id: item.id },
          update: { ...item },
          create: { ...item },
        });
      }

      count += 1;
    }

    summary[key] = count;
  }

  res.json({
    ok: true,
    message: "Backup restored successfully",
    summary,
  });
});

export default router;
