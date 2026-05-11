export const topNav = [
  "Dashboard",
  "Operators",
  "Customers",
  "Billing",
  "Reports",
  "Support",
];

export const adminSections = [
  {
    title: "Super Admin Pages",
    pages: [
      "Platform Dashboard",
      "Operator Management",
      "Plan & Subscription Billing",
      "Revenue & Commission",
      "Global Templates",
      "Support Tickets",
      "Monitoring & Audit Logs",
    ],
  },
  {
    title: "Operator Pages",
    pages: [
      "Operator Dashboard",
      "Customer Management",
      "Packages",
      "Payments & Receipts",
      "Recharge & Reconciliation",
      "Staff & Roles",
      "Complaints",
      "Expenses",
      "Settings",
    ],
  },
];

export const workflow = [
  "Login with tenant-scoped account",
  "Open dashboard with dues, alerts, and collections",
  "Search or add customer",
  "Collect payment and renew validity",
  "Send receipt via SMS/WhatsApp",
  "Review reports and staff activity",
  "Logout or auto-expire session",
];

export const architectureCards = [
  {
    title: "Multi-Tenant Core",
    detail: "Every operator gets isolated data with role-based permissions and subscription limits.",
  },
  {
    title: "Recharge Engine",
    detail: "Supports internal activation, external billing sync, and manual reconciliation mode.",
  },
  {
    title: "Revenue Layer",
    detail: "Your earnings come from operator plans, add-ons, credits, and optional commissions.",
  },
  {
    title: "Realtime Ops",
    detail: "Live due alerts, activity feed, notification queues, and fast collector workflows.",
  },
];
