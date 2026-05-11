import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

async function resolvePackageForTenant(tenantId, packageRef = "") {
  if (!packageRef) return null;
  const normalized = String(packageRef).trim();
  if (!normalized) return null;
  return prisma.package.findFirst({
    where: {
      tenantId,
      OR: [
        { id: normalized },
        { name: { equals: normalized } },
      ],
    },
  });
}

async function adjustPackageCounts(previousPackageId, nextPackageId) {
  if (previousPackageId && previousPackageId !== nextPackageId) {
    await prisma.package.update({
      where: { id: previousPackageId },
      data: { customers: { decrement: 1 } },
    }).catch(() => {});
  }

  if (nextPackageId && previousPackageId !== nextPackageId) {
    await prisma.package.update({
      where: { id: nextPackageId },
      data: { customers: { increment: 1 } },
    }).catch(() => {});
  }
}

async function generateCustomerCode(tenantId) {
  const count = await prisma.customer.count({ where: { tenantId } });
  const suffix = String(Date.now()).slice(-4);
  return `CUS-${count + 1}-${suffix}`;
}

async function buildImportPreview(tenantId, rows = []) {
  const existingCustomers = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true, customerCode: true, mobile: true, packageId: true, packageName: true },
  });
  const existingByMobile = new Map(existingCustomers.map((item) => [String(item.mobile || "").trim(), item]));
  const existingByCode = new Map(existingCustomers.map((item) => [String(item.customerCode || "").trim(), item]));
  const duplicateMobilesInFile = new Set();
  const duplicateCodesInFile = new Set();
  const seenMobiles = new Set();
  const seenCodes = new Set();

  for (const row of rows) {
    const mobile = String(row.mobile || "").trim();
    const customerCode = String(row.customerCode || "").trim();
    if (mobile) {
      if (seenMobiles.has(mobile)) duplicateMobilesInFile.add(mobile);
      seenMobiles.add(mobile);
    }
    if (customerCode) {
      if (seenCodes.has(customerCode)) duplicateCodesInFile.add(customerCode);
      seenCodes.add(customerCode);
    }
  }

  const previewItems = [];
  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const name = String(row.name || "").trim();
    const mobile = String(row.mobile || "").trim();
    const customerCode = String(row.customerCode || "").trim();
    const packageRef = String(row.packageName || row.package || row.packageId || "").trim();
    const issues = [];

    if (!name) issues.push("Missing customer name");
    if (!mobile) issues.push("Missing mobile");
    if (mobile && duplicateMobilesInFile.has(mobile)) issues.push("Duplicate mobile inside file");
    if (customerCode && duplicateCodesInFile.has(customerCode)) issues.push("Duplicate customer code inside file");

    const matchedPackage = await resolvePackageForTenant(tenantId, packageRef);
    if (packageRef && !matchedPackage) issues.push(`Package not found: ${packageRef}`);

    const existing = existingByMobile.get(mobile) || (customerCode ? existingByCode.get(customerCode) : null);
    let action = "create";

    if (existing) {
      action = "update";
      updateCount += 1;
    } else {
      createCount += 1;
    }

    if (issues.length) {
      action = "skip";
      skipCount += 1;
      if (existing) updateCount -= 1;
      else createCount -= 1;
    }

    previewItems.push({
      rowNumber: index + 1,
      name,
      mobile,
      customerCode,
      packageRef,
      action,
      issues,
      existingId: existing?.id || null,
      resolvedPackageId: matchedPackage?.id || null,
      resolvedPackageName: matchedPackage?.name || "",
    });
  }

  return {
    summary: {
      totalRows: rows.length,
      createCount,
      updateCount,
      skipCount,
    },
    items: previewItems,
  };
}

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

router.get("/:id", async (req, res) => {
  const item = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!item) return res.status(404).json({ ok: false, message: "Customer not found" });
  res.json({ ok: true, item });
});

router.post("/", async (req, res) => {
  const {
    name,
    mobile,
    area = "",
    packageId = null,
    packageName = "",
    dueAmount = 0,
    dueDate = "",
    connectionType = "both",
  } = req.body || {};
  if (!name || !mobile) return res.status(400).json({ ok: false, message: "name and mobile are required" });

  let resolvedPackageName = packageName;
  if (packageId) {
    const selectedPackage = await prisma.package.findFirst({
      where: { id: packageId, tenantId: req.context.tenantId },
    });
    if (selectedPackage) {
      resolvedPackageName = selectedPackage.name;
      await prisma.package.update({
        where: { id: selectedPackage.id },
        data: { customers: { increment: 1 } },
      });
    }
  }
  const item = await prisma.customer.create({
    data: {
      id: `cust-${Date.now()}`,
      tenantId: req.context.tenantId,
      customerCode: await generateCustomerCode(req.context.tenantId),
      name,
      mobile,
      area,
      packageId,
      packageName: resolvedPackageName,
      dueAmount: Number(dueAmount || 0),
      dueDate,
      expiryDate: dueDate,
      status: "active",
      connectionType,
    },
  });
  res.status(201).json({ ok: true, item });
});

router.post("/import-preview", async (req, res) => {
  const { rows = [] } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ ok: false, message: "rows are required" });
  }
  const preview = await buildImportPreview(req.context.tenantId, rows);

  res.json({
    ok: true,
    ...preview,
  });
});

router.post("/import", async (req, res) => {
  const { rows = [], mode = "skip_duplicates" } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ ok: false, message: "rows are required" });
  }

  const preview = await buildImportPreview(req.context.tenantId, rows);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (let index = 0; index < preview.items.length; index += 1) {
    const meta = preview.items[index];
    const row = rows[index] || {};

    if (meta.issues.length) {
      skipped += 1;
      errors.push({ rowNumber: meta.rowNumber, issues: meta.issues });
      continue;
    }

    const existing = meta.existingId
      ? await prisma.customer.findFirst({ where: { id: meta.existingId, tenantId: req.context.tenantId } })
      : null;

    if (existing && mode === "skip_duplicates") {
      skipped += 1;
      continue;
    }

    const packageId = meta.resolvedPackageId || null;
    const packageName = meta.resolvedPackageName || "";
    const payload = {
      name: String(row.name || "").trim(),
      mobile: String(row.mobile || "").trim(),
      area: String(row.area || "").trim(),
      packageId,
      packageName,
      dueAmount: Number(row.dueAmount || row.due || 0),
      dueDate: String(row.dueDate || "").trim(),
      expiryDate: String(row.expiryDate || row.dueDate || "").trim(),
      connectionType: String(row.connectionType || "both").trim() || "both",
    };

    if (!existing) {
      await prisma.customer.create({
        data: {
          id: `cust-${Date.now()}-${index}`,
          tenantId: req.context.tenantId,
          customerCode: String(row.customerCode || "").trim() || await generateCustomerCode(req.context.tenantId),
          ...payload,
          status: "active",
        },
      });
      await adjustPackageCounts(null, packageId);
      created += 1;
      continue;
    }

    await adjustPackageCounts(existing.packageId, packageId);
    await prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...payload,
        ...(String(row.customerCode || "").trim() ? { customerCode: String(row.customerCode || "").trim() } : {}),
      },
    });
    updated += 1;
  }

  res.json({
    ok: true,
    message: "Customer import completed",
    summary: {
      totalRows: rows.length,
      created,
      updated,
      skipped,
      errors,
    },
  });
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Customer not found" });

  const updates = { ...(req.body || {}) };
  if (updates.packageId) {
    const selectedPackage = await prisma.package.findFirst({
      where: { id: updates.packageId, tenantId: req.context.tenantId },
    });
    if (!selectedPackage) return res.status(400).json({ ok: false, message: "Package not found" });

    if (existing.packageId && existing.packageId !== selectedPackage.id) {
      await prisma.package.update({
        where: { id: existing.packageId },
        data: { customers: { decrement: 1 } },
      }).catch(() => {});
    }

    if (existing.packageId !== selectedPackage.id) {
      await prisma.package.update({
        where: { id: selectedPackage.id },
        data: { customers: { increment: 1 } },
      });
    }

    updates.packageName = selectedPackage.name;
  }

  const item = await prisma.customer.update({
    where: { id: existing.id },
    data: updates,
  });
  res.json({ ok: true, item });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Customer not found" });

  if (existing.packageId) {
    await prisma.package.update({
      where: { id: existing.packageId },
      data: { customers: { decrement: 1 } },
    }).catch(() => {});
  }

  await prisma.customer.delete({ where: { id: existing.id } });
  res.json({ ok: true, message: "Customer deleted" });
});

export default router;
