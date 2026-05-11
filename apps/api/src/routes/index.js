import { Router } from "express";
import acsRouter from "./acs.js";
import authRouter from "./auth.js";
import backupRouter from "./backup.js";
import blueprintRouter from "./blueprint.js";
import customersRouter from "./customers.js";
import expensesRouter from "./expenses.js";
import healthRouter from "./health.js";
import oltsRouter from "./olts.js";
import operatorsRouter from "./operators.js";
import ontsRouter from "./onts.js";
import packagesRouter from "./packages.js";
import paymentsRouter from "./payments.js";
import publicRouter from "./public.js";
import rechargesRouter from "./recharges.js";
import reportsRouter from "./reports.js";
import settingsRouter from "./settings.js";
import staffRouter from "./staff.js";

const router = Router();

router.use("/auth", authRouter);
router.use("/backup", backupRouter);
router.use("/health", healthRouter);
router.use("/acs", acsRouter);
router.use("/blueprint", blueprintRouter);
router.use("/operators", operatorsRouter);
router.use("/customers", customersRouter);
router.use("/packages", packagesRouter);
router.use("/payments", paymentsRouter);
router.use("/public", publicRouter);
router.use("/recharges", rechargesRouter);
router.use("/reports", reportsRouter);
router.use("/staff", staffRouter);
router.use("/expenses", expensesRouter);
router.use("/settings", settingsRouter);
router.use("/olts", oltsRouter);
router.use("/onts", ontsRouter);

router.get("/", (_req, res) => {
  res.json({
    message: "CableOps SaaS API ready",
    docs: {
      health: "/api/health",
      overview: "/api/blueprint/overview",
      modules: "/api/blueprint/modules",
      auth: "/api/auth/login",
      backup: "/api/backup/export",
      operators: "/api/operators",
      customers: "/api/customers",
      packages: "/api/packages",
      payments: "/api/payments",
      publicPayments: "/api/public/payment-lookup",
      recharges: "/api/recharges",
      reports: "/api/reports",
      staff: "/api/staff",
      expenses: "/api/expenses",
      settings: "/api/settings",
      olts: "/api/olts",
      onts: "/api/onts",
      acsInform: "/api/acs/inform",
      acsTasks: "/api/acs/tasks",
    },
  });
});

export default router;
