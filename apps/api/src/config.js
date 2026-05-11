export const config = {
  appName: "CableOps SaaS API",
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  jwtSecret: process.env.JWT_SECRET || "change-this-in-render",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  databaseUrl: process.env.DATABASE_URL || "",
  isRender: String(process.env.RENDER || "").toLowerCase() === "true" || Boolean(process.env.RENDER_GIT_COMMIT),
};
