import bcrypt from "bcryptjs";
import { prisma } from "./db.js";

async function createTenantIfMissing(data) {
  const existing = await prisma.tenant.findUnique({ where: { id: data.id } });
  if (existing) return existing;
  return prisma.tenant.create({ data });
}

async function createUserIfMissing(data) {
  const existingById = await prisma.user.findUnique({ where: { id: data.id } });
  if (existingById) return existingById;
  const existingByEmail = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingByEmail) return existingByEmail;
  return prisma.user.create({ data });
}

async function createIfMissing(model, where, data) {
  const existing = await model.findFirst({ where });
  if (existing) return existing;
  return model.create({ data });
}

export async function seedDatabase() {
  const existingTenants = await prisma.tenant.count();
  const existingUsers = await prisma.user.count();

  if (existingTenants > 0 || existingUsers > 0) {
    return;
  }

  await createTenantIfMissing({
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

  await createTenantIfMissing({
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

  await createUserIfMissing({
    id: "user-platform-1",
    tenantId: null,
    name: "Platform Owner",
    email: "quickmedigo@gmail.com",
    mobile: "9000000000",
    passwordHash: await bcrypt.hash("Sagar@9090$", 10),
    role: "platform_owner",
    isActive: true,
  });

  await createUserIfMissing({
    id: "user-operator-demo",
    tenantId: "tenant-demooperator",
    name: "Apex Network Admin",
    email: "demo.operator@cableops.in",
    mobile: "9000000001",
    passwordHash: await bcrypt.hash("demo12345", 10),
    role: "operator_admin",
    isActive: true,
  });

  await createIfMissing(
    prisma.package,
    { id: "pkg-demo-fiber" },
    {
      id: "pkg-demo-fiber",
      tenantId: "tenant-demooperator",
      name: "Fiber 40 Mbps",
      type: "internet",
      price: 599,
      validityDays: 30,
      customers: 1,
    },
  );

  await createIfMissing(
    prisma.customer,
    { id: "cust-3001" },
    {
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
  );

  await createIfMissing(
    prisma.staffMember,
    { id: "staff-1" },
    {
      id: "staff-1",
      tenantId: "tenant-demooperator",
      name: "Rakesh Collector",
      mobile: "9898989898",
      role: "collector",
      status: "active",
    },
  );

  await createIfMissing(
    prisma.expense,
    { id: "exp-1" },
    {
      id: "exp-1",
      tenantId: "tenant-demooperator",
      title: "Fiber maintenance",
      category: "Maintenance",
      amount: 2500,
      expenseDate: "2026-05-10",
    },
  );

  await createIfMissing(
    prisma.tenantSetting,
    { tenantId: "tenant-demooperator" },
    {
      tenantId: "tenant-demooperator",
      companyName: "Apex Cable Network",
      billingDay: 5,
      lateFee: 25,
      supportMobile: "9999999999",
      address: "Bhopal",
      paymentDisplayName: "Apex Cable Network",
      upiId: "apexcable@upi",
      qrImageUrl: "",
      qrInstructions: "QR scan karke payment karein aur niche UTR submit karein.",
      acsUsername: "acs-apex",
      acsPassword: "acs-pass-123",
      defaultAcsProfile: "tr181",
      defaultWifiSsidPath: "Device.WiFi.SSID.1.SSID",
      defaultWifiPasswordPath: "Device.WiFi.AccessPoint.1.Security.KeyPassphrase",
      defaultInformInterval: 300,
      autoApproveOnts: true,
      tr069TemplateName: "Default Home Fiber",
    },
  );

  await createIfMissing(
    prisma.olt,
    { id: "olt-1" },
    {
      id: "olt-1",
      tenantId: "tenant-demooperator",
      name: "Core OLT 01",
      vendor: "syrotech",
      model: "SY-GPON-4OLT",
      ipAddress: "10.10.10.2",
      username: "admin",
      password: "admin",
      firmware: "v1.0.3",
      location: "Main POP",
      ponPorts: 4,
      status: "active",
    },
  );

  await createIfMissing(
    prisma.ont,
    { id: "ont-1" },
    {
      id: "ont-1",
      tenantId: "tenant-demooperator",
      oltId: "olt-1",
      customerId: "cust-3001",
      serialNumber: "SYRO12345678",
      macAddress: "A0:B1:C2:D3:E4:F5",
      vendor: "syrotech",
      model: "XPON ONT",
      ponPort: "PON1",
      onuIndex: "1",
      lineProfile: "40M_PROFILE",
      serviceProfile: "HOME_WIFI",
      tr069Enabled: true,
      acsDeviceId: "SYRO12345678",
      acsProfile: "tr181",
      connectionRequestUrl: "http://10.10.10.25:7547",
      connectionRequestUser: "acs-user",
      connectionRequestPass: "acs-pass",
      wifiSsidPath: "Device.WiFi.SSID.1.SSID",
      wifiPasswordPath: "Device.WiFi.AccessPoint.1.Security.KeyPassphrase",
      wifiSsid: "ApexHome",
      wifiPassword: "Apex@12345",
      wanMode: "pppoe",
      pppoeUsername: "rahul.soni",
      pppoePassword: "pass1234",
      status: "online",
      discoveryStatus: "approved",
      informCount: 1,
      lastInformAt: new Date(),
      lastProvisionedAt: new Date(),
    },
  );

  await createIfMissing(
    prisma.acsTask,
    { id: "acs-task-1" },
    {
      id: "acs-task-1",
      tenantId: "tenant-demooperator",
      ontId: "ont-1",
      taskType: "wifi_update",
      status: "completed",
      requestedBy: "user-operator-demo",
      payload: JSON.stringify({ wifiSsid: "ApexHome", wifiPassword: "Apex@12345" }),
      resultMessage: "Provisioning history seeded",
      executedAt: new Date(),
    },
  );
}
