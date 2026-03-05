import type { Context, Next } from "hono";
import { verifyToken, type JwtPayload } from "../utils/jwt";

type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  JWT_SECRET: string;
};

type Variables = {
  contributor: JwtPayload;
};

export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, message: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ success: false, message: "Invalid or expired token" }, 401);
  }

  c.set("contributor", payload);
  return next();
}

export async function requireAdmin(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, message: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ success: false, message: "Invalid or expired token" }, 401);
  }

  if (payload.role !== "admin") {
    return c.json(
      { success: false, message: "Forbidden: admin access required" },
      403,
    );
  }

  c.set("contributor", payload);
  return next();
}

export async function requireActiveOnWrite(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    return next();
  }

  const payload = c.get("contributor");
  const row = await c.env.DB.prepare(
    "SELECT is_active FROM contributors WHERE id = ? LIMIT 1",
  )
    .bind(payload.sub)
    .first<{ is_active: number }>();

  if (row?.is_active !== 1) {
    return c.json({ success: false, message: "Account deactivated" }, 403);
  }

  return next();
}
