import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { issueReports, quranTranslations } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  ErrorSchema,
  ReportBodySchema,
  ReportResponseSchema,
  ReportCheckResponseSchema,
} from "../openapi/schemas";

type Bindings = {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
};

const reports = new OpenAPIHono<{ Bindings: Bindings }>();

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

async function verifyTurnstile(
  token: string,
  secretKey: string,
  ip?: string,
): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
    });
    if (ip) body.set("remoteip", ip);

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
    });
    const data = (await res.json()) as { success: boolean };
    return data.success;
  } catch {
    return false;
  }
}

// ─── POST /reports ──────────────────────────────────────────────────────────
// Public endpoint for submitting translation issue reports.
// No authentication required. Protected by Cloudflare Turnstile.

reports.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Reports"],
    summary: "Submit a public translation issue report",
    request: {
      body: {
        content: { "application/json": { schema: ReportBodySchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ReportResponseSchema } },
        description: "Report submitted",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Validation error",
      },
      403: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Turnstile verification failed",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");

    // Verify Turnstile token
    const ip = c.req.header("CF-Connecting-IP");
    const turnstileValid = await verifyTurnstile(
      body.turnstileToken,
      c.env.TURNSTILE_SECRET_KEY,
      ip,
    );

    if (!turnstileValid) {
      return c.json(
        {
          success: false as const,
          message: "Human verification failed. Please try again.",
        },
        403,
      );
    }

    // Validate report type constraints
    if (body.reportType === "quick") {
      if (!body.categories || body.categories.length === 0) {
        return c.json(
          {
            success: false as const,
            message: "Quick reports require at least one category",
          },
          400,
        );
      }
    }

    if (body.reportType === "detailed") {
      if (!body.suggestedText || body.suggestedText.trim().length === 0) {
        return c.json(
          {
            success: false as const,
            message: "Detailed reports require suggested text",
          },
          400,
        );
      }
    }

    // Resolve translationId from surahNumber + verseNumber
    const db = drizzle(c.env.DB);
    const translation = await db
      .select({ id: quranTranslations.id })
      .from(quranTranslations)
      .where(
        and(
          eq(quranTranslations.surahNumber, body.surahNumber),
          eq(quranTranslations.verseNumber, body.verseNumber),
        ),
      )
      .limit(1);

    if (translation.length === 0) {
      return c.json(
        { success: false as const, message: "Verse not found" },
        400,
      );
    }

    try {
      const [inserted] = await db
        .insert(issueReports)
        .values({
          translationId: translation[0].id,
          fingerprint: body.fingerprint,
          reportType: body.reportType,
          categories: body.categories ? JSON.stringify(body.categories) : null,
          suggestedText: body.suggestedText?.trim() ?? null,
          suggestedFootnotes: body.suggestedFootnotes
            ? JSON.stringify(body.suggestedFootnotes)
            : null,
          contactName: body.contactName?.trim() ?? null,
          sourceId: body.sourceId ?? null,
          surahNumber: body.surahNumber,
          verseNumber: body.verseNumber,
          verseTranslationId: body.verseTranslationId ?? null,
        })
        .returning({ id: issueReports.id });

      return c.json({ success: true as const, data: { id: inserted.id } }, 201);
    } catch (e) {
      console.error("Failed to insert report:", e);
      return c.json(
        { success: false as const, message: "Failed to submit report" },
        500,
      );
    }
  },
);

// ─── GET /reports/check ─────────────────────────────────────────────────────
// Check if a fingerprint has already reported a specific verse.

reports.openapi(
  createRoute({
    method: "get",
    path: "/check",
    tags: ["Reports"],
    summary: "Check if a verse has been reported by this fingerprint",
    request: {
      query: z.object({
        fingerprint: z
          .string()
          .min(8)
          .openapi({
            param: { name: "fingerprint", in: "query" },
            example: "a1b2c3d4e5f6",
          }),
        surahNumber: z.coerce
          .number()
          .int()
          .min(1)
          .max(114)
          .openapi({
            param: { name: "surahNumber", in: "query" },
            example: 2,
          }),
        verseNumber: z.coerce
          .number()
          .int()
          .positive()
          .openapi({
            param: { name: "verseNumber", in: "query" },
            example: 255,
          }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: ReportCheckResponseSchema },
        },
        description: "Report check result",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    const { fingerprint, surahNumber, verseNumber } = c.req.valid("query");

    try {
      const db = drizzle(c.env.DB);
      const existing = await db
        .select({ id: issueReports.id })
        .from(issueReports)
        .where(
          and(
            eq(issueReports.fingerprint, fingerprint),
            eq(issueReports.surahNumber, surahNumber),
            eq(issueReports.verseNumber, verseNumber),
          ),
        )
        .limit(1);

      return c.json(
        {
          success: true as const,
          data: { reported: existing.length > 0 },
        },
        200,
      );
    } catch (e) {
      console.error("Failed to check report:", e);
      return c.json(
        { success: false as const, message: "Failed to check report status" },
        500,
      );
    }
  },
);

export default reports;
