export function requirePlatformOwner(req, res, next) {
  if (!req.user || req.user.role !== "platform_owner") {
    return res.status(403).json({
      ok: false,
      message: "Only platform owner can perform this action",
    });
  }

  return next();
}

export function requireTenantScopedUser(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return res.status(403).json({
      ok: false,
      message: "Tenant-scoped access required",
    });
  }

  return next();
}

export function ensureTenantAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: "Authentication required" });
  }

  if (req.user.role === "platform_owner") {
    return next();
  }

  if (req.user.tenantId !== req.params.id) {
    return res.status(403).json({
      ok: false,
      message: "You do not have access to this business account",
    });
  }

  return next();
}
