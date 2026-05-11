export function tenantContext(req, _res, next) {
  const tenantId = req.user?.tenantId ?? req.header("x-tenant-id") ?? null;
  const role = req.user?.role ?? req.header("x-role") ?? "guest";
  const userId = req.user?.sub ?? req.header("x-user-id") ?? null;

  req.context = {
    tenantId,
    role,
    userId,
  };

  next();
}
