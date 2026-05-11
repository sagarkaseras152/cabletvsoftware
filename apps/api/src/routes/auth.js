import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  changePassword,
  getTenantForUser,
  issueAccessToken,
  revokeToken,
  sanitizeUser,
  validateCredentials,
} from "../services/authService.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await validateCredentials(email, password);

  if (!user) {
    return res.status(401).json({
      ok: false,
      message: "Invalid credentials",
    });
  }

  const token = issueAccessToken(user);
  const tenant = await getTenantForUser(user);

  return res.json({
    ok: true,
    token,
    user: sanitizeUser(user),
    tenant,
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.sub,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      tenantId: req.user.tenantId,
    },
    context: req.context,
  });
});

router.post("/logout", requireAuth, (req, res) => {
  if (req.authToken) {
    revokeToken(req.authToken);
  }

  res.json({
    ok: true,
    message: "Logged out successfully",
  });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({
      ok: false,
      message: "New password must be at least 8 characters long",
    });
  }

  const result = await changePassword(req.user.sub, currentPassword, newPassword);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  return res.json({
    ok: true,
    message: "Password changed successfully",
  });
});

export default router;
