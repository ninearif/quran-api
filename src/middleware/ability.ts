import type { Context, Next } from "hono";
import { verifyToken, type JwtPayload } from "../utils/jwt";
import {
  defineAbilitiesFor,
  type Action,
  type Subject,
  type Role,
} from "../permissions";

type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  JWT_SECRET: string;
};

type Variables = {
  contributor: JwtPayload;
};

export function requireAbility(action: Action, subject: Subject) {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next,
  ) => {
    let role: Role = "guest";
    let payload: JwtPayload | null = null;

    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      payload = await verifyToken(token, c.env.JWT_SECRET);
    }

    if (payload) {
      role = payload.role;
      c.set("contributor", payload);
    }

    const ability = defineAbilitiesFor(role);

    if (!ability.can(action, subject)) {
      if (!payload) {
        return c.json({ success: false, message: "Unauthorized" }, 401);
      }
      return c.json(
        { success: false, message: "Forbidden: insufficient permissions" },
        403,
      );
    }

    return next();
  };
}
