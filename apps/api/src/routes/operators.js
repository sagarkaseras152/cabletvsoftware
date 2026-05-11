import { Router } from "express";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/auth.js";
import { requirePlatformOwner } from "../middleware/access.js";
import { prisma } from "../db.js";
import { resetUserPassword } from "../services/authService.js";

const router = Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.tenant.findMany({
    orderBy: { businessName: "asc" },
    include: {
      users: {
        where: { role: "operator_admin" },
        select: { id: true, name: true, email: true, isActive: true },
        take: 1,
      },
      settings: {
        select: { companyName: true, supportMobile: true },
      },
    },
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
  if (req.user.role !== "platform_owner" && req.user.tenantId !== req.params.id) {
    return res.status(403).json({
      ok: false,
      message: "You do not have access to this business account",
    });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });

  if (!tenant) {
    return res.status(404).json({ ok: false, message: "Operator not found" });
  }

  const [settings, adminUsers, customerCount, paymentSum, dueAggregate] = await Promise.all([
    prisma.tenantSetting.findUnique({ where: { tenantId: tenant.id } }),
    prisma.user.findMany({
      where: { tenantId: tenant.id, role: "operator_admin" },
      select: { id: true, name: true, email: true, isActive: true, createdAt: true },
    }),
    prisma.customer.count({ where: { tenantId: tenant.id } }),
    prisma.payment.findMany({ where: { tenantId: tenant.id }, select: { amountPaid: true } }),
    prisma.customer.findMany({ where: { tenantId: tenant.id }, select: { dueAmount: true } }),
  ]);

  return res.json({
    ok: true,
    item: tenant,
    settings,
    adminUsers,
    metrics: {
      monthCollection: tenant.monthlyCollection,
      activeCustomers: customerCount,
      totalCollection: paymentSum.reduce((sum, item) => sum + item.amountPaid, 0),
      pendingCollections: dueAggregate.reduce((sum, item) => sum + (item.dueAmount || 0), 0),
    },
  });
});

router.post("/", requirePlatformOwner, async (req, res) => {
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

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedBusinessName = String(businessName).trim();

  const [allTenants, existingEmailUser] = await Promise.all([
    prisma.tenant.findMany(),
    prisma.user.findUnique({ where: { email: normalizedEmail } }),
  ]);

  const existingTenant = allTenants.find(
    (item) => item.businessName.toLowerCase() === normalizedBusinessName.toLowerCase(),
  );
  if (existingTenant) {
    return res.status(400).json({
      ok: false,
      message: "Business account already exists",
    });
  }

  if (existingEmailUser) {
    return res.status(400).json({
      ok: false,
      message: "Login email already exists",
    });
  }

  const codeBase = normalizedBusinessName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "OPR";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: `tenant-${Date.now()}`,
          code: `${codeBase}${allTenants.length + 1}`,
          businessName: normalizedBusinessName,
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

      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}`,
          tenantId: tenant.id,
          name: `${normalizedBusinessName} Admin`,
          email: normalizedEmail,
          mobile: "",
          passwordHash: await bcrypt.hash(password, 10),
          role: "operator_admin",
          isActive: true,
        },
      });

      const settings = await tx.tenantSetting.create({
        data: {
          tenantId: tenant.id,
          companyName: normalizedBusinessName,
          billingDay: 1,
          lateFee: 0,
          supportMobile: mobile,
          address: city || "",
          paymentDisplayName: normalizedBusinessName,
          upiId: "",
          qrImageUrl: "",
          qrInstructions: "Payment karne ke baad UTR submit karein. Operator approval ke baad payment entry auto post hogi.",
          acsUsername: `${tenant.code.toLowerCase()}-acs`,
          acsPassword: `acs-${Date.now()}`,
          defaultAcsProfile: "tr181",
          defaultWifiSsidPath: "Device.WiFi.SSID.1.SSID",
          defaultWifiPasswordPath: "Device.WiFi.AccessPoint.1.Security.KeyPassphrase",
          defaultInformInterval: 300,
          autoApproveOnts: true,
          tr069TemplateName: "Default Home Fiber",
        },
      });

      return { tenant, user, settings };
    });

    return res.status(201).json({
      ok: true,
      message: "Operator account created successfully",
      operator: result.tenant,
      settings: result.settings,
      login: {
        url: "/",
        email: normalizedEmail,
        password,
      },
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error?.message || "Operator account create failed",
    });
  }
});

router.patch("/:id", requirePlatformOwner, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) return res.status(404).json({ ok: false, message: "Operator not found" });

  const {
    businessName,
    ownerName,
    city,
    mobile,
    plan,
    subscriptionStatus,
    smsCredits,
    companyName,
    supportMobile,
    address,
  } = req.body || {};

  const updatedTenant = await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      ...(businessName !== undefined ? { businessName } : {}),
      ...(ownerName !== undefined ? { ownerName } : {}),
      ...(city !== undefined ? { city } : {}),
      ...(mobile !== undefined ? { mobile } : {}),
      ...(plan !== undefined ? { plan } : {}),
      ...(subscriptionStatus !== undefined ? { subscriptionStatus } : {}),
      ...(smsCredits !== undefined ? { smsCredits: Number(smsCredits || 0) } : {}),
    },
  });

  const settings = await prisma.tenantSetting.upsert({
    where: { tenantId: tenant.id },
    update: {
      ...(companyName !== undefined ? { companyName } : {}),
      ...(supportMobile !== undefined ? { supportMobile } : {}),
      ...(address !== undefined ? { address } : {}),
    },
    create: {
      tenantId: tenant.id,
      companyName: companyName || updatedTenant.businessName,
      supportMobile: supportMobile || updatedTenant.mobile || "",
      address: address || updatedTenant.city || "",
    },
  });

  res.json({ ok: true, item: updatedTenant, settings });
});

router.post("/:id/reset-password", requirePlatformOwner, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) return res.status(404).json({ ok: false, message: "Operator not found" });

  const adminUser = await prisma.user.findFirst({
    where: { tenantId: tenant.id, role: "operator_admin" },
  });
  if (!adminUser) return res.status(404).json({ ok: false, message: "Operator admin not found" });

  const { newPassword } = req.body || {};
  const password = String(newPassword || `Op@${Date.now().toString().slice(-6)}`);
  const result = await resetUserPassword(adminUser.id, password);
  if (!result.ok) return res.status(400).json(result);

  res.json({
    ok: true,
    message: "Password reset successfully",
    login: {
      email: adminUser.email,
      password,
    },
  });
});

export default router;
