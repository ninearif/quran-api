import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { contributors } from "../db/schema";
import { verifyPassword } from "../utils/crypto";
import { signToken } from "../utils/jwt";
import { requireAuth } from "../middleware/auth";
import type { JwtPayload } from "../utils/jwt";
import {
  LoginBodySchema,
  LoginResponseSchema,
  SetupBodySchema,
  ErrorSchema,
  MessageSchema,
} from "../openapi/schemas";

type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  JWT_SECRET: string;
};

type Variables = {
  contributor: JwtPayload;
};

const auth = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// ─── POST /auth/login ─────────────────────────────────────────────────────────

auth.openapi(
  createRoute({
    method: "post",
    path: "/login",
    tags: ["Auth"],
    summary: "Login with email and password",
    request: {
      body: {
        content: { "application/json": { schema: LoginBodySchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: LoginResponseSchema } },
        description: "Login successful",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Password login not available",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Invalid credentials",
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);

    const [contributor] = await db
      .select()
      .from(contributors)
      .where(eq(contributors.email, body.email.toLowerCase()))
      .limit(1);

    if (!contributor || !contributor.isActive) {
      return c.json(
        { success: false as const, message: "Invalid credentials" },
        401,
      );
    }

    if (!contributor.passwordHash) {
      return c.json(
        {
          success: false as const,
          message: "Password login not available for this account",
        },
        400,
      );
    }

    const valid = await verifyPassword(body.password, contributor.passwordHash);
    if (!valid) {
      return c.json(
        { success: false as const, message: "Invalid credentials" },
        401,
      );
    }

    await db
      .update(contributors)
      .set({ lastLoginAt: new Date() })
      .where(eq(contributors.id, contributor.id));

    const token = await signToken(
      {
        sub: contributor.id,
        email: contributor.email,
        role: contributor.role as "contributor" | "admin",
      },
      c.env.JWT_SECRET,
    );

    return c.json(
      {
        success: true as const,
        token,
        contributor: {
          id: contributor.id,
          email: contributor.email,
          displayName: contributor.displayName,
          role: contributor.role as "contributor" | "admin",
        },
      },
      200,
    );
  },
);

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

auth.use("/me", requireAuth);

auth.openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["Auth"],
    summary: "Get current authenticated contributor",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              contributor: z.object({
                id: z.number(),
                email: z.string(),
                role: z.string(),
              }),
            }),
          },
        },
        description: "Current contributor info",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  (c) => {
    const payload = c.get("contributor");
    return c.json(
      {
        success: true as const,
        contributor: {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
        },
      },
      200,
    );
  },
);

// ─── POST /auth/setup ─────────────────────────────────────────────────────────

auth.openapi(
  createRoute({
    method: "post",
    path: "/setup",
    tags: ["Auth"],
    summary:
      "Create initial admin account (one-time setup, fails if any contributor exists)",
    request: {
      body: {
        content: { "application/json": { schema: SetupBodySchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: MessageSchema } },
        description: "Admin account created",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Missing required fields",
      },
      403: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Setup already complete",
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: contributors.id })
      .from(contributors)
      .limit(1);

    if (existing.length > 0) {
      return c.json(
        { success: false as const, message: "Setup already complete" },
        403,
      );
    }

    const body = c.req.valid("json");
    const { hashPassword } = await import("../utils/crypto");
    const hash = await hashPassword(body.password);

    await db.insert(contributors).values({
      email: body.email.toLowerCase(),
      displayName: body.displayName,
      role: "admin",
      passwordHash: hash,
    });

    return c.json(
      { success: true as const, message: "Admin account created" },
      200,
    );
  },
);

export default auth;
