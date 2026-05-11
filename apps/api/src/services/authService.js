import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";

const revokedTokens = new Set();

export async function ensureAuthState() {
  return true;
}

export async function validateCredentials(email, password) {
  const user = await prisma.user.findUnique({
    where: { email: String(email).toLowerCase() },
  });

  if (!user) return null;
  const isValid = await bcrypt.compare(password, user.passwordHash);
  return isValid ? user : null;
}

export function issueAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

export function verifyAccessToken(token) {
  if (revokedTokens.has(token)) throw new Error("Token revoked");
  return jwt.verify(token, config.jwtSecret);
}

export function revokeToken(token) {
  revokedTokens.add(token);
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: "User not found" };

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) return { ok: false, message: "Current password is incorrect" };

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });

  return { ok: true };
}

export function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  };
}

export async function getTenantForUser(user) {
  return user.tenantId ? prisma.tenant.findUnique({ where: { id: user.tenantId } }) : null;
}

export async function registerOperatorAdmin({ email, password, tenantId, name }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, message: "Email already exists" };

  const user = await prisma.user.create({
    data: {
      id: `user-${Date.now()}`,
      tenantId,
      name,
      email,
      mobile: "",
      passwordHash: await bcrypt.hash(password, 10),
      role: "operator_admin",
      isActive: true,
    },
  });

  return { ok: true, user: sanitizeUser(user) };
}
