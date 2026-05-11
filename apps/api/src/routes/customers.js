import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { search = "" } = req.query;
  const where = {
    tenantId: req.context.tenantId,
    ...(search
      ? {
          OR: [
            { name: { contains: String(search) } },
            { mobile: { contains: String(search) } },
            { customerCode: { contains: String(search) } },
          ],
        }
      : {}),
  };
  const items = await prisma.customer.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json({ ok: true, count: items.length, items });
});

router.post("/", async (req, res) => {
  const { name, mobile, area = "", packageName = "", dueAmount = 0, dueDate = "", connectionType = "both" } =
    req.body || {};
  if (!name || !mobile) return res.status(400).json({ ok: false, message: "name and mobile are required" });

  const count = await prisma.customer.count({ where: { tenantId: req.context.tenantId } });
  const item = await prisma.customer.create({
    data: {
      id: `cust-${Date.now()}`,
      tenantId: req.context.tenantId,
      customerCode: `CUS-${count + 1}`,
      name,
      mobile,
      area,
      packageName,
      dueAmount: Number(dueAmount || 0),
      dueDate,
      expiryDate: dueDate,
      status: "active",
      connectionType,
    },
  });
  res.status(201).json({ ok: true, item });
});

export default router;
