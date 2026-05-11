import { verifyAccessToken } from "../services/authService.js";

export function optionalAuth(req, _res, next) {
  const authHeader = req.header("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  try {
    const token = authHeader.slice(7);
    req.authToken = token;
    req.user = verifyAccessToken(token);
  } catch (_error) {
    req.user = null;
  }

  return next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      ok: false,
      message: "Authentication required",
    });
  }

  return next();
}
