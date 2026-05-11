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
    where: { id: data.id },
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
    email: "quickmedigo@gmail.com",
    mobile: "9000000000",
    passwordHash: await bcrypt.hash("Sagar@9090$", 10),
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
      acsUsername: "acs-apex",
      acsPassword: "acs-pass-123",
      defaultAcsProfile: "tr181",
      defaultWifiSsidPath: "Device.WiFi.SSID.1.SSID",
      defaultWifiPasswordPath: "Device.WiFi.AccessPoint.1.Security.KeyPassphrase",
      defaultInformInterval: 300,
      autoApproveOnts: true,
      tr069TemplateName: "Default Home Fiber",
    },
    create: {
      tenantId: "tenant-demooperator",
      companyName: "Apex Cable Network",
      billingDay: 5,
      lateFee: 25,
      supportMobile: "9999999999",
      address: "Bhopal",
      acsUsername: "acs-apex",
      acsPassword: "acs-pass-123",
      defaultAcsProfile: "tr181",
      defaultWifiSsidPath: "Device.WiFi.SSID.1.SSID",
      defaultWifiPasswordPath: "Device.WiFi.AccessPoint.1.Security.KeyPassphrase",
      defaultInformInterval: 300,
      autoApproveOnts: true,
      tr069TemplateName: "Default Home Fiber",
    },
  });

  await prisma.olt.upsert({
    where: { id: "olt-1" },
    update: {
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
    create: {
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
  });

  await prisma.ont.upsert({
    where: { id: "ont-1" },
    update: {
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
    create: {
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
  });

  await prisma.acsTask.upsert({
    where: { id: "acs-task-1" },
    update: {
      tenantId: "tenant-demooperator",
      ontId: "ont-1",
      taskType: "wifi_update",
      status: "completed",
      requestedBy: "user-operator-demo",
      payload: JSON.stringify({ wifiSsid: "ApexHome", wifiPassword: "Apex@12345" }),
      resultMessage: "Provisioning history seeded",
      executedAt: new Date(),
    },
    create: {
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
  });
}
