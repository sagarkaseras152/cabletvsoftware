export const overview = {
  platform: {
    activeOperators: 128,
    monthlyRecurringRevenue: 286500,
    totalEndCustomers: 102340,
    pendingCollections: 1842300,
  },
  operator: {
    activeCustomers: 4821,
    dueToday: 143,
    monthCollection: 684500,
    openComplaints: 19,
  },
};

export const tenants = [
  {
    id: "tenant-skyline",
    code: "SKYLINE",
    businessName: "Skyline Cable & Broadband",
    ownerName: "Ravi Sharma",
    plan: "Premium",
    subscriptionStatus: "active",
    city: "Indore",
    activeCustomers: 4821,
    staffCount: 18,
    smsCredits: 9200,
    monthlyCollection: 684500,
  },
  {
    id: "tenant-demooperator",
    code: "DEMOOP1",
    businessName: "Apex Cable Network",
    ownerName: "Sagar Kasera",
    plan: "Standard",
    subscriptionStatus: "active",
    city: "Bhopal",
    activeCustomers: 256,
    staffCount: 4,
    smsCredits: 1200,
    monthlyCollection: 86500,
  },
  {
    id: "tenant-fastnet",
    code: "FASTNET",
    businessName: "Fastnet Digital Network",
    ownerName: "Imran Khan",
    plan: "Standard",
    subscriptionStatus: "trial",
    city: "Bhopal",
    activeCustomers: 1734,
    staffCount: 7,
    smsCredits: 2500,
    monthlyCollection: 246300,
  },
];

export const packages = [
  {
    id: "pkg-cable-gold",
    tenantId: "tenant-skyline",
    name: "Gold Cable",
    type: "cable",
    price: 350,
    validityDays: 30,
    customers: 1200,
  },
  {
    id: "pkg-fiber-50",
    tenantId: "tenant-skyline",
    name: "Fiber 50 Mbps",
    type: "internet",
    price: 699,
    validityDays: 30,
    customers: 980,
  },
  {
    id: "pkg-demo-fiber",
    tenantId: "tenant-demooperator",
    name: "Fiber 40 Mbps",
    type: "internet",
    price: 599,
    validityDays: 30,
    customers: 140,
  },
  {
    id: "pkg-combo-max",
    tenantId: "tenant-fastnet",
    name: "Combo Max",
    type: "combo",
    price: 999,
    validityDays: 30,
    customers: 420,
  },
];

export const customers = [
  {
    id: "cust-1001",
    tenantId: "tenant-skyline",
    customerCode: "SKY-1001",
    name: "Sunil Verma",
    mobile: "9876543210",
    area: "Palasia",
    status: "active",
    packageId: "pkg-fiber-50",
    packageName: "Fiber 50 Mbps",
    dueAmount: 699,
    dueDate: "2026-05-16",
    expiryDate: "2026-05-16",
  },
  {
    id: "cust-1002",
    tenantId: "tenant-skyline",
    customerCode: "SKY-1002",
    name: "Asha Patidar",
    mobile: "9811111111",
    area: "Vijay Nagar",
    status: "suspended",
    packageId: "pkg-cable-gold",
    packageName: "Gold Cable",
    dueAmount: 1050,
    dueDate: "2026-05-05",
    expiryDate: "2026-05-05",
  },
  {
    id: "cust-2001",
    tenantId: "tenant-fastnet",
    customerCode: "FST-2001",
    name: "Nazim Ali",
    mobile: "9822222222",
    area: "Kohefiza",
    status: "active",
    packageId: "pkg-combo-max",
    packageName: "Combo Max",
    dueAmount: 999,
    dueDate: "2026-05-20",
    expiryDate: "2026-05-20",
  },
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
  },
];

export const payments = [
  {
    id: "pay-1",
    tenantId: "tenant-skyline",
    receiptNumber: "RCPT-20260511-001",
    customerId: "cust-1001",
    customerName: "Sunil Verma",
    amountPaid: 699,
    paymentMode: "upi",
    paymentDate: "2026-05-11T09:15:00.000Z",
    status: "success",
  },
  {
    id: "pay-2",
    tenantId: "tenant-skyline",
    receiptNumber: "RCPT-20260510-017",
    customerId: "cust-1002",
    customerName: "Asha Patidar",
    amountPaid: 350,
    paymentMode: "cash",
    paymentDate: "2026-05-10T13:30:00.000Z",
    status: "partial",
  },
];

export const recharges = [
  {
    id: "rch-1",
    tenantId: "tenant-skyline",
    customerId: "cust-1001",
    customerName: "Sunil Verma",
    mode: "internal",
    status: "activated_internal",
    amount: 699,
    oldExpiryDate: "2026-05-16",
    newExpiryDate: "2026-06-15",
  },
  {
    id: "rch-2",
    tenantId: "tenant-fastnet",
    customerId: "cust-2001",
    customerName: "Nazim Ali",
    mode: "assisted",
    status: "activation_pending",
    amount: 999,
    oldExpiryDate: "2026-05-20",
    newExpiryDate: "2026-06-19",
  },
];

export const reports = [
  {
    id: "rep-1",
    tenantId: "tenant-skyline",
    name: "Daily Collection",
    generatedAt: "2026-05-11T09:20:00.000Z",
    format: "pdf",
  },
  {
    id: "rep-2",
    tenantId: "tenant-skyline",
    name: "Defaulter List",
    generatedAt: "2026-05-10T18:05:00.000Z",
    format: "xlsx",
  },
];

export const staffMembers = [
  {
    id: "staff-1",
    tenantId: "tenant-demooperator",
    name: "Rakesh Collector",
    mobile: "9898989898",
    role: "collector",
    status: "active",
  },
  {
    id: "staff-2",
    tenantId: "tenant-demooperator",
    name: "Aman Technician",
    mobile: "9888877777",
    role: "technician",
    status: "active",
  },
];

export const expenses = [
  {
    id: "exp-1",
    tenantId: "tenant-demooperator",
    title: "Fiber maintenance",
    category: "Maintenance",
    amount: 2500,
    expenseDate: "2026-05-10",
  },
  {
    id: "exp-2",
    tenantId: "tenant-demooperator",
    title: "Field staff petrol",
    category: "Travel",
    amount: 800,
    expenseDate: "2026-05-11",
  },
];

export const tenantSettings = [
  {
    tenantId: "tenant-demooperator",
    companyName: "Apex Cable Network",
    billingDay: 5,
    lateFee: 25,
    supportMobile: "9999999999",
    address: "Bhopal",
  },
];

export const modules = [
  {
    key: "auth",
    title: "Authentication & Access",
    includes: ["Login", "2FA", "roles", "tenant scoping", "audit trail"],
  },
  {
    key: "operators",
    title: "Operator Management",
    includes: ["onboarding", "plans", "subscription billing", "usage limits"],
  },
  {
    key: "customers",
    title: "Customer Lifecycle",
    includes: ["KYC", "packages", "status control", "documents", "history"],
  },
  {
    key: "billing",
    title: "Billing & Recharge",
    includes: ["dues", "receipts", "renewals", "partial payments", "reconciliation"],
  },
];

export const featureChecklist = {
  mustHave: [
    "tenant-aware auth",
    "operator subscriptions",
    "customer CRUD",
    "package CRUD",
    "collect payment",
    "receipt generation",
    "due reminders",
    "staff roles",
  ],
  nextPhase: [
    "complaints",
    "expenses",
    "notifications",
    "report exports",
    "external billing sync",
  ],
};

export const authProfiles = [
  {
    id: "user-platform-1",
    email: "quickmedigo@gmail.com",
    password: "Sagar@9090$",
    role: "platform_owner",
    tenantId: null,
    name: "Platform Owner",
  },
  {
    id: "user-operator-1",
    email: "admin@skyline.in",
    password: "operator123",
    role: "operator_admin",
    tenantId: "tenant-skyline",
    name: "Skyline Admin",
  },
  {
    id: "user-operator-demo",
    email: "demo.operator@cableops.in",
    password: "demo12345",
    role: "operator_admin",
    tenantId: "tenant-demooperator",
    name: "Apex Network Admin",
  },
];
