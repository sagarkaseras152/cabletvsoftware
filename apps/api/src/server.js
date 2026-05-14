import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { optionalAuth } from "./middleware/auth.js";
import { tenantContext } from "./middleware/tenantContext.js";
import routes from "./routes/index.js";
import { seedDatabase } from "./seed.js";
import { ensureAuthState } from "./services/authService.js";
import { startMonitoringPoller } from "./services/monitoringPoller.js";

const app = express();

if (config.isRender && config.databaseUrl.startsWith("file:")) {
  throw new Error(
    "Render par SQLite file database allowed nahi hai. Supabase/Postgres ka DATABASE_URL set karo.",
  );
}

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(optionalAuth);
app.use(tenantContext);

app.use("/api", routes);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: config.appName,
    docs: "/api",
  });
});

ensureAuthState().then(() => {
  prisma.$connect()
    .then(seedDatabase)
    .then(() => {
      startMonitoringPoller();
      app.listen(config.port, () => {
        console.log(`${config.appName} listening on port ${config.port}`);
      });
    });
});
