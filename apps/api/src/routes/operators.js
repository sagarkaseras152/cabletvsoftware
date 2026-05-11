import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../db.js";
import { registerOperatorAdmin } from "../services/authService.js";

const router = Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.tenant.findMany({
    orderBy: { businessName: "asc" },
  });
  const filtered =
    req.user.role === "platform_owner"
      ? items
      : items.filter((item) => item.id === req.user.tenantId);

  res.json({
    ok: true,
    items: filtered,
  });
});

router.get("/:id", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });

  if (!tenant) {
    return res.status(404).json({ ok: false, message: "Operator not found" });
  }

  return res.json({
    ok: true,
    item: tenant,
    metrics: {
      monthCollection: tenant.monthlyCollection,
      activeCustomers: tenant.activeCustomers,
      pendingCollections: 0,
    },
  });
});

router.post("/", async (req, res) => {
  if (req.user.role !== "platform_owner") {
    return res.status(403).json({
      ok: false,
      message: "Only platform owner can create operators",
    });
  }

  const {
    businessName,
    ownerName,
    city,
    mobile,
    email,
    password,
    plan = "Trial",
  } = req.body || {};

  if (!businessName || !ownerName || !mobile || !email || !password) {
    return res.status(400).json({
      ok: false,
      message: "businessName, ownerName, mobile, email, and password are required",
    });
  }

  const allTenants = await prisma.tenant.findMany();
  const existingTenant = allTenants.find(
    (item) => item.businessName.toLowerCase() === String(businessName).toLowerCase(),
  );
  if (existingTenant) {
    return res.status(400).json({
      ok: false,
      message: "Operator already exists",
    });
  }

  const codeBase = String(businessName).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "OPR";
  const tenant = await prisma.tenant.create({
    data: {
    id: `tenant-${Date.now()}`,
    code: `${codeBase}${allTenants.length + 1}`,
    businessName,
    ownerName,
    plan,
    subscriptionStatus: "trial",
    city: city || "Unknown",
    activeCustomers: 0,
    staffCount: 1,
    smsCredits: 0,
    monthlyCollection: 0,
    mobile,
    },
  });

  const userResult = await registerOperatorAdmin({
    email,
    password,
    tenantId: tenant.id,
    name: `${businessName} Admin`,
  });

  if (!userResult.ok) {
    return res.status(400).json(userResult);
  }

  return res.status(201).json({
    ok: true,
    message: "Operator account created successfully",
    operator: tenant,
    login: {
      url: "http://localhost:4173",
      email,
      password,
    },
  });
});

export default router;
