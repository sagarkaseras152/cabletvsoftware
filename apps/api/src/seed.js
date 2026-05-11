import bcrypt from "bcryptjs";
import { prisma } from "./db.js";

async function upsertTenant(data) {
  return prisma.tenant.upsert({
    where: { id: data.id },
    update: data,
    create: data,
  });
}

async function upsertUser(data) {
  return prisma.user.upsert({
    where: { email: data.email },
    update: data,
    create: data,
  });
}

export async function seedDatabase() {
  await upsertTenant({
    id: "tenant-demooperator",
    code: "DEMOOP1",
    businessName: "Apex Cable Network",
    ownerName: "Sagar Kasera",
    plan: "Standard",
    subscriptionStatus: "active",
    city: "Bhopal",
    mobile: "9999999999",
    activeCustomers: 1,
    staffCount: 2,
    smsCredits: 1200,
    monthlyCollection: 86500,
  });

  await upsertTenant({
    id: "tenant-skyline",
    code: "SKYLINE",
    businessName: "Skyline Cable & Broadband",
    ownerName: "Ravi Sharma",
    plan: "Premium",
    subscriptionStatus: "active",
    city: "Indore",
    mobile: "9876543210",
    activeCustomers: 2,
    staffCount: 18,
    smsCredits: 9200,
    monthlyCollection: 684500,
  });

  await upsertUser({
    id: "user-platform-1",
    tenantId: null,
    name: "Platform Owner",
    email: "owner@cableops.in",
    mobile: "9000000000",
    passwordHash: await bcrypt.hash("admin123", 10),
    role: "platform_owner",
    isActive: true,
  });

  await upsertUser({
    id: "user-operator-demo",
    tenantId: "tenant-demooperator",
    name: "Apex Network Admin",
    email: "demo.operator@cableops.in",
    mobile: "9000000001",
    passwordHash: await bcrypt.hash("demo12345", 10),
    role: "operator_admin",
    isActive: true,
  });

  await prisma.package.upsert({
    where: { id: "pkg-demo-fiber" },
    update: {
      tenantId: "tenant-demooperator",
      name: "Fiber 40 Mbps",
      type: "internet",
      price: 599,
      validityDays: 30,
      customers: 1,
    },
    create: {
      id: "pkg-demo-fiber",
      tenantId: "tenant-demooperator",
      name: "Fiber 40 Mbps",
      type: "internet",
      price: 599,
      validityDays: 30,
      customers: 1,
    },
  });

  await prisma.customer.upsert({
    where: { id: "cust-3001" },
    update: {
      tenantId: "tenant-demooperator",
      customerCode: "DOP-3001",
      name: "Rahul Soni",
      mobile: "9833333333",
      area: "Arera Colony",
      status: "active",
      packageId: "pkg-demo-fiber",
      packageName: "Fiber 40 Mbps",
      dueAmount: 599,
      dueDate: "2026-05-18",
      expiryDate: "2026-05-18",
      connectionType: "internet",
    },
    create: {
      id: "cust-3001",
      tenantId: "tenant-demooperator",
      customerCode: "DOP-3001",
      name: "Rahul Soni",
      mobile: "9833333333",
      area: "Arera Colony",
      status: "active",
      packageId: "pkg-demo-fiber",
      packageName: "Fiber 40 Mbps",
      dueAmount: 599,
      dueDate: "2026-05-18",
      expiryDate: "2026-05-18",
      connectionType: "internet",
    },
  });

  await prisma.staffMember.upsert({
    where: { id: "staff-1" },
    update: {
      tenantId: "tenant-demooperator",
      name: "Rakesh Collector",
      mobile: "9898989898",
      role: "collector",
      status: "active",
    },
    create: {
      id: "staff-1",
      tenantId: "tenant-demooperator",
      name: "Rakesh Collector",
      mobile: "9898989898",
      role: "collector",
      status: "active",
    },
  });

  await prisma.expense.upsert({
    where: { id: "exp-1" },
    update: {
      tenantId: "tenant-demooperator",
      title: "Fiber maintenance",
      category: "Maintenance",
      amount: 2500,
      expenseDate: "2026-05-10",
    },
    create: {
      id: "exp-1",
      tenantId: "tenant-demooperator",
      title: "Fiber maintenance",
      category: "Maintenance",
      amount: 2500,
      expenseDate: "2026-05-10",
    },
  });

  await prisma.tenantSetting.upsert({
    where: { tenantId: "tenant-demooperator" },
    update: {
      companyName: "Apex Cable Network",
      billingDay: 5,
      lateFee: 25,
      supportMobile: "9999999999",
      address: "Bhopal",
    },
    create: {
      tenantId: "tenant-demooperator",
      companyName: "Apex Cable Network",
      billingDay: 5,
      lateFee: 25,
      supportMobile: "9999999999",
      address: "Bhopal",
    },
  });
}
