import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { eq, ne, and, desc } from "drizzle-orm";
import { contributions, wordTranslations } from "../db/schema";
import { requireAuth, requireActiveOnWrite } from "../middleware/auth";
import type { JwtPayload } from "../utils/jwt";
import type { VerseDetailSchema } from "../openapi/schemas";
import {
  ErrorSchema,
  VerseRowSchema,
  VerseTranslationIdParamSchema,
  VerseWithContributionsSchema,
  ContributionBodySchema,
  WordTranslationSchema,
  WordTranslationBodySchema,
  FootnoteSchema,
  FootnoteBodySchema,
  IdParamSchema,
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

const contributor = new OpenAPIHono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

contributor.use("/*", requireAuth);
contributor.use("/*", requireActiveOnWrite);

// ─── GET /contributor/verses ──────────────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/verses",
    tags: ["Contributor"],
    summary: "List verses with pending contribution and issue counts",
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        sourceId: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .openapi({
            param: { name: "sourceId", in: "query" },
            example: 1,
          }),
        surahNumber: z.coerce
          .number()
          .int()
          .min(1)
          .max(114)
          .optional()
          .openapi({
            param: { name: "surahNumber", in: "query" },
            example: 1,
          }),
        hasIssues: z
          .enum(["true", "false"])
          .optional()
          .openapi({ param: { name: "hasIssues", in: "query" } }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(VerseRowSchema),
            }),
          },
        },
        description: "Verse list",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const { sourceId, surahNumber, hasIssues } = c.req.valid("query");
    const resolvedSourceId = sourceId ?? 1;

    let query = `
      SELECT
        vt.id,
        vt.source_id,
        vt.surah_number,
        vt.verse_number,
        qt.content,
        vt.translation_text AS translation,
        vt.is_verified,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'pending') AS pending_count,
        COUNT(DISTINCT ir.id) AS issue_count
      FROM verse_translations vt
      LEFT JOIN quran_translations qt ON qt.surah_number = vt.surah_number AND qt.verse_number = vt.verse_number
      LEFT JOIN contributions c ON c.verse_translation_id = vt.id
      LEFT JOIN issue_reports ir ON ir.translation_id = qt.id
      WHERE vt.source_id = ${resolvedSourceId}
    `;

    if (surahNumber) {
      query += ` AND vt.surah_number = ${surahNumber}`;
    }
    if (hasIssues === "true") {
      query += ` AND qt.id IS NOT NULL AND (SELECT COUNT(*) FROM issue_reports WHERE translation_id = qt.id) > 0`;
    }

    query += ` GROUP BY vt.id ORDER BY vt.surah_number, vt.verse_number LIMIT 200`;

    const result = await c.env.DB.prepare(query).all();
    return c.json(
      {
        success: true as const,
        data: result.results as z.infer<typeof VerseRowSchema>[],
      },
      200,
    );
  },
);

// ─── GET /contributor/verses/:verseTranslationId/contributions ────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/verses/{verseTranslationId}/contributions",
    tags: ["Contributor"],
    summary: "Get verse detail with its contribution history",
    security: [{ bearerAuth: [] }],
    request: {
      params: VerseTranslationIdParamSchema,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: VerseWithContributionsSchema,
            }),
          },
        },
        description: "Verse and contributions",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Verse not found",
      },
    },
  }),
  async (c) => {
    const { verseTranslationId } = c.req.valid("param");
    const id = parseInt(verseTranslationId);

    const vtRow = await c.env.DB.prepare(
      `
      SELECT vt.id, vt.source_id, vt.surah_number, vt.verse_number, vt.translation_text, vt.is_verified,
             qt.content
      FROM verse_translations vt
      JOIN quran_translations qt ON qt.surah_number = vt.surah_number AND qt.verse_number = vt.verse_number
      WHERE vt.id = ?
      LIMIT 1
    `,
    )
      .bind(id)
      .first();

    if (!vtRow) {
      return c.json(
        { success: false as const, message: "Verse not found" },
        404,
      );
    }

    const db = drizzle(c.env.DB);
    const history = await db
      .select()
      .from(contributions)
      .where(eq(contributions.verseTranslationId, id))
      .orderBy(desc(contributions.createdAt))
      .all();

    return c.json(
      {
        success: true as const,
        data: {
          verse: vtRow as z.infer<typeof VerseDetailSchema>,
          contributions: history,
        },
      },
      200,
    );
  },
);

// ─── POST /contributor/contributions ─────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "post",
    path: "/contributions",
    tags: ["Contributor"],
    summary: "Submit a translation correction proposal",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: { "application/json": { schema: ContributionBodySchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.record(z.string(), z.unknown()),
            }),
          },
        },
        description: "Contribution submitted",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Missing required fields",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Verse not found",
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const payload = c.get("contributor");
    const db = drizzle(c.env.DB);

    const vtRow = await c.env.DB.prepare(
      `
      SELECT id, source_id FROM verse_translations WHERE id = ? LIMIT 1
    `,
    )
      .bind(body.verseTranslationId)
      .first<{ id: number; source_id: number }>();

    if (!vtRow) {
      return c.json(
        { success: false as const, message: "Verse not found" },
        404,
      );
    }

    const [inserted] = await db
      .insert(contributions)
      .values({
        verseTranslationId: body.verseTranslationId,
        sourceId: vtRow.source_id,
        suggestedTranslation: body.suggestedTranslation.trim(),
        contributorName: payload.email,
        contributorId: payload.sub,
      })
      .returning();

    return c.json(
      { success: true as const, data: inserted as Record<string, unknown> },
      201,
    );
  },
);

// ─── GET /contributor/word-translations ───────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/word-translations",
    tags: ["Contributor"],
    summary: "List word-level translations for a specific verse",
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        surahNumber: z.coerce
          .number()
          .int()
          .min(1)
          .max(114)
          .openapi({
            param: { name: "surahNumber", in: "query" },
            example: 1,
          }),
        verseNumber: z.coerce
          .number()
          .int()
          .positive()
          .openapi({
            param: { name: "verseNumber", in: "query" },
            example: 1,
          }),
        language: z
          .string()
          .optional()
          .openapi({
            param: { name: "language", in: "query" },
            example: "en",
          }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(WordTranslationSchema),
            }),
          },
        },
        description: "Word translations for the verse",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "surahNumber and verseNumber are required",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const { surahNumber, verseNumber, language } = c.req.valid("query");
    const db = drizzle(c.env.DB);

    const conditions = [
      eq(wordTranslations.surahNumber, surahNumber),
      eq(wordTranslations.verseNumber, verseNumber),
    ];
    if (language) {
      conditions.push(eq(wordTranslations.language, language));
    }

    const words = await db
      .select()
      .from(wordTranslations)
      .where(and(...conditions))
      .orderBy(wordTranslations.wordPosition)
      .all();

    return c.json(
      {
        success: true as const,
        data: words as unknown as z.infer<typeof WordTranslationSchema>[],
      },
      200,
    );
  },
);

// ─── GET /contributor/word-translations/similar ───────────────────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/word-translations/similar",
    tags: ["Contributor"],
    summary: "Find similar words across different verses by Arabic text",
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        arabicText: z
          .string()
          .min(1)
          .openapi({
            param: { name: "arabicText", in: "query" },
            example: "الْحَمْدُ",
          }),
        language: z
          .string()
          .optional()
          .openapi({
            param: { name: "language", in: "query" },
            example: "en",
          }),
        excludeSurahNumber: z.coerce
          .number()
          .int()
          .min(1)
          .max(114)
          .optional()
          .openapi({
            param: { name: "excludeSurahNumber", in: "query" },
            example: 1,
          }),
        excludeVerseNumber: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .openapi({
            param: { name: "excludeVerseNumber", in: "query" },
            example: 2,
          }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(WordTranslationSchema),
            }),
          },
        },
        description: "Similar words found in other verses",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const { arabicText: rawArabicText, language, excludeSurahNumber, excludeVerseNumber } =
      c.req.valid("query");
    const arabicText = rawArabicText.normalize("NFC");
    const db = drizzle(c.env.DB);

    // Build conditions for finding similar words
    const conditions = [eq(wordTranslations.arabicText, arabicText)];

    // Filter by language if provided
    if (language) {
      conditions.push(eq(wordTranslations.language, language));
    }

    // Exclude current verse if specified
    if (excludeSurahNumber !== undefined && excludeVerseNumber !== undefined) {
      // Build SQL dynamically based on language filter
      let sql = `
        SELECT
          id,
          surah_number,
          verse_number,
          word_position,
          arabic_text,
          meaning,
          language,
          transliteration,
          contributor_id,
          status,
          created_at,
          updated_at
        FROM word_translations
        WHERE arabic_text = ?
          AND NOT (surah_number = ? AND verse_number = ?)
          AND TRIM(meaning) != ''
      `;

      const bindParams: any[] = [arabicText, excludeSurahNumber, excludeVerseNumber];

      if (language) {
        sql += ` AND language = ?`;
        bindParams.push(language);
      }

      sql += ` ORDER BY surah_number, verse_number, word_position LIMIT 50`;

      const words = await c.env.DB.prepare(sql).bind(...bindParams).all();

      return c.json(
        {
          success: true as const,
          data: words.results as unknown as z.infer<typeof WordTranslationSchema>[],
        },
        200,
      );
    }

    // Standard query without exclusion
    conditions.push(ne(wordTranslations.meaning, ""));
    const words = await db
      .select()
      .from(wordTranslations)
      .where(and(...conditions))
      .orderBy(wordTranslations.surahNumber, wordTranslations.verseNumber, wordTranslations.wordPosition)
      .limit(50)
      .all();

    return c.json(
      {
        success: true as const,
        data: words as unknown as z.infer<typeof WordTranslationSchema>[],
      },
      200,
    );
  },
);

// ─── POST /contributor/word-translations ──────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "post",
    path: "/word-translations",
    tags: ["Contributor"],
    summary: "Upsert a word-level translation (per contributor + position)",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: { "application/json": { schema: WordTranslationBodySchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.record(z.string(), z.unknown()),
            }),
          },
        },
        description: "Word translation updated",
      },
      201: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.record(z.string(), z.unknown()),
            }),
          },
        },
        description: "Word translation created",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const {
      surahNumber,
      verseNumber,
      wordPosition,
      arabicText: rawArabicText,
      meaning,
      language,
      transliteration,
    } = body;
    const arabicText = rawArabicText.normalize("NFC");
    const payload = c.get("contributor");
    const db = drizzle(c.env.DB);

    const existing = await db
      .select({ id: wordTranslations.id })
      .from(wordTranslations)
      .where(
        and(
          eq(wordTranslations.surahNumber, surahNumber),
          eq(wordTranslations.verseNumber, verseNumber),
          eq(wordTranslations.wordPosition, wordPosition),
          eq(wordTranslations.language, language),
          eq(wordTranslations.contributorId, payload.sub),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(wordTranslations)
        .set({
          meaning: meaning.trim(),
          transliteration: transliteration?.trim() ?? "",
          updatedAt: new Date(),
        })
        .where(eq(wordTranslations.id, existing[0].id))
        .returning();
      return c.json(
        { success: true as const, data: updated as Record<string, unknown> },
        200,
      );
    }

    const [inserted] = await db
      .insert(wordTranslations)
      .values({
        surahNumber,
        verseNumber,
        wordPosition,
        arabicText,
        meaning: meaning.trim(),
        language,
        transliteration: transliteration?.trim() ?? "",
        contributorId: payload.sub,
      })
      .returning();

    return c.json(
      { success: true as const, data: inserted as Record<string, unknown> },
      201,
    );
  },
);

// ─── GET /contributor/footnotes ───────────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/footnotes",
    tags: ["Contributor"],
    summary: "List footnotes for a verse translation",
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        verseTranslationId: z.coerce
          .number()
          .int()
          .positive()
          .openapi({
            param: { name: "verseTranslationId", in: "query" },
            example: 1,
          }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(FootnoteSchema),
            }),
          },
        },
        description: "Footnote list",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "verseTranslationId is required",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const { verseTranslationId } = c.req.valid("query");

    const result = await c.env.DB.prepare(
      `
      SELECT id, footnote_number, text
      FROM translation_footnotes
      WHERE verse_translation_id = ?
      ORDER BY footnote_number ASC
    `,
    )
      .bind(verseTranslationId)
      .all();

    return c.json(
      {
        success: true as const,
        data: result.results as z.infer<typeof FootnoteSchema>[],
      },
      200,
    );
  },
);

// ─── POST /contributor/footnotes ──────────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "post",
    path: "/footnotes",
    tags: ["Contributor"],
    summary:
      "Create or update a footnote (upsert by verseTranslationId + footnoteNumber)",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: { "application/json": { schema: FootnoteBodySchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: FootnoteSchema,
            }),
          },
        },
        description: "Footnote created or updated",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Verse translation not found",
      },
    },
  }),
  async (c) => {
    const { verseTranslationId, footnoteNumber, text } = c.req.valid("json");

    const vt = await c.env.DB.prepare(
      `SELECT id FROM verse_translations WHERE id = ? LIMIT 1`,
    )
      .bind(verseTranslationId)
      .first();

    if (!vt) {
      return c.json(
        { success: false as const, message: "Verse translation not found" },
        404,
      );
    }

    await c.env.DB.prepare(
      `
      INSERT INTO translation_footnotes (verse_translation_id, footnote_number, text)
      VALUES (?, ?, ?)
      ON CONFLICT(verse_translation_id, footnote_number) DO UPDATE SET text = excluded.text
    `,
    )
      .bind(verseTranslationId, footnoteNumber, text.trim())
      .run();

    const row = await c.env.DB.prepare(
      `
      SELECT id, footnote_number, text
      FROM translation_footnotes
      WHERE verse_translation_id = ? AND footnote_number = ?
    `,
    )
      .bind(verseTranslationId, footnoteNumber)
      .first<{ id: number; footnote_number: number; text: string }>();

    return c.json({ success: true as const, data: row! }, 201);
  },
);

// ─── DELETE /contributor/footnotes/:id ────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "delete",
    path: "/footnotes/{id}",
    tags: ["Contributor"],
    summary: "Delete a footnote by ID",
    security: [{ bearerAuth: [] }],
    request: {
      params: IdParamSchema,
    },
    responses: {
      200: {
        content: { "application/json": { schema: MessageSchema } },
        description: "Footnote deleted",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Footnote not found",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const numericId = parseInt(id);

    const row = await c.env.DB.prepare(
      `SELECT id FROM translation_footnotes WHERE id = ? LIMIT 1`,
    )
      .bind(numericId)
      .first();

    if (!row) {
      return c.json(
        { success: false as const, message: "Footnote not found" },
        404,
      );
    }

    await c.env.DB.prepare(`DELETE FROM translation_footnotes WHERE id = ?`)
      .bind(numericId)
      .run();

    return c.json({ success: true as const, message: "Footnote deleted" }, 200);
  },
);

// ─── GET /contributor/issues ──────────────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/issues",
    tags: ["Contributor"],
    summary: "List verses sorted by issue report count (descending)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(z.record(z.string(), z.unknown())),
            }),
          },
        },
        description: "Issues list",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const query = `
      SELECT
        qt.id,
        qt.surah_number,
        qt.verse_number,
        qt.content,
        COUNT(ir.id) AS issue_count
      FROM quran_translations qt
      JOIN issue_reports ir ON ir.translation_id = qt.id
      GROUP BY qt.id
      ORDER BY issue_count DESC
      LIMIT 100
    `;

    const result = await c.env.DB.prepare(query).all();
    return c.json(
      {
        success: true as const,
        data: result.results as Record<string, unknown>[],
      },
      200,
    );
  },
);

// ─── GET /contributor/words ───────────────────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/words",
    tags: ["Contributor"],
    summary: "List all word translations with filters and pagination",
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        surahNumber: z.coerce.number().int().min(1).max(114).optional(),
        verseNumber: z.coerce.number().int().positive().optional(),
        language: z.string().optional(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(50),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(z.record(z.string(), z.unknown())),
              meta: z.object({
                total: z.number(),
                page: z.number(),
                pageSize: z.number(),
                totalPages: z.number(),
              }),
            }),
          },
        },
        description: "Paginated word translations",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const { surahNumber, verseNumber, language, status, page, pageSize } = c.req.valid("query");

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (surahNumber !== undefined) {
      conditions.push("wt.surah_number = ?");
      params.push(surahNumber);
    }
    if (verseNumber !== undefined) {
      conditions.push("wt.verse_number = ?");
      params.push(verseNumber);
    }
    if (language !== undefined) {
      conditions.push("wt.language = ?");
      params.push(language);
    }
    if (status !== undefined) {
      conditions.push("wt.status = ?");
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM word_translations wt
      ${whereClause}
    `;
    const countResult = await c.env.DB.prepare(countQuery)
      .bind(...params)
      .first<{ total: number }>();
    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / pageSize);

    // Get paginated data
    const offset = (page - 1) * pageSize;
    const dataQuery = `
      SELECT
        wt.id,
        wt.surah_number,
        wt.verse_number,
        wt.word_position,
        wt.arabic_text,
        wt.meaning,
        wt.language,
        wt.transliteration,
        wt.status,
        wt.contributor_id,
        wt.created_at,
        wt.updated_at,
        co.email AS contributor_email,
        co.display_name AS contributor_name
      FROM word_translations wt
      LEFT JOIN contributors co ON co.id = wt.contributor_id
      ${whereClause}
      ORDER BY wt.surah_number ASC, wt.verse_number ASC, wt.word_position ASC
      LIMIT ? OFFSET ?
    `;

    const result = await c.env.DB.prepare(dataQuery)
      .bind(...params, pageSize, offset)
      .all();

    return c.json({
      success: true as const,
      data: result.results as Record<string, unknown>[],
      meta: {
        total,
        page,
        pageSize,
        totalPages,
      },
    });
  },
);

// ─── PUT /contributor/words/:id ───────────────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "put",
    path: "/words/{id}",
    tags: ["Contributor"],
    summary: "Update a word translation",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: "id", in: "path" },
          example: "1",
        }),
      }),
      body: {
        content: {
          "application/json": z.object({
            meaning: z.string().optional(),
            transliteration: z.string().optional(),
            status: z.enum(["pending", "approved", "rejected"]).optional(),
          }),
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              message: z.string(),
            }),
          },
        },
        description: "Word translation updated",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Invalid request",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Word translation not found",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const numericId = parseInt(id);
    const body = c.req.valid("json");

    // Check if word translation exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM word_translations WHERE id = ?"
    )
      .bind(numericId)
      .first<{ id: number }>();

    if (!existing) {
      return c.json(
        { success: false as const, message: "Word translation not found" },
        404
      );
    }

    // Build update query
    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (body.meaning !== undefined) {
      updates.push("meaning = ?");
      params.push(body.meaning);
    }
    if (body.transliteration !== undefined) {
      updates.push("transliteration = ?");
      params.push(body.transliteration);
    }
    if (body.status !== undefined) {
      updates.push("status = ?");
      params.push(body.status);
    }

    if (updates.length === 0) {
      return c.json(
        { success: false as const, message: "No fields to update" },
        400
      );
    }

    updates.push("updated_at = strftime('%s', 'now')");
    params.push(numericId);

    await c.env.DB.prepare(
      `UPDATE word_translations SET ${updates.join(", ")} WHERE id = ?`
    )
      .bind(...params)
      .run();

    return c.json(
      { success: true as const, message: "Word translation updated" },
      200
    );
  },
);

// ─── DELETE /contributor/words/:id ────────────────────────────────────────────────

contributor.openapi(
  createRoute({
    method: "delete",
    path: "/words/{id}",
    tags: ["Contributor"],
    summary: "Delete a word translation",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: "id", in: "path" },
          example: "1",
        }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: MessageSchema,
          },
        },
        description: "Word translation deleted",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Word translation not found",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const numericId = parseInt(id);

    // Check if word translation exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM word_translations WHERE id = ?"
    )
      .bind(numericId)
      .first<{ id: number }>();

    if (!existing) {
      return c.json(
        { success: false as const, message: "Word translation not found" },
        404
      );
    }

    await c.env.DB.prepare("DELETE FROM word_translations WHERE id = ?")
      .bind(numericId)
      .run();

    return c.json(
      { success: true as const, message: "Word translation deleted" },
      200
    );
  },
);

// ─── GET /contributor/word-translations/progress ──────────────────────────────

contributor.openapi(
  createRoute({
    method: "get",
    path: "/word-translations/progress",
    tags: ["Contributor"],
    summary:
      "Get per-surah word translation progress (approved and pending verse counts)",
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        language: z
          .string()
          .optional()
          .openapi({
            param: { name: "language", in: "query" },
            example: "th",
          }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(
                z.object({
                  surah_number: z.number(),
                  translated: z.number(),
                  pending: z.number(),
                })
              ),
            }),
          },
        },
        description: "Per-surah word translation progress",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const { language } = c.req.valid("query");
    const langFilter = language || "th";

    // Count distinct verses that have at least one approved word translation per surah
    // and distinct verses that have at least one pending word translation per surah
    const rows = await c.env.DB.prepare(
      `SELECT
        surah_number,
        COUNT(DISTINCT CASE WHEN status = 'approved' THEN surah_number || ':' || verse_number END) AS translated,
        COUNT(DISTINCT CASE WHEN status = 'pending' THEN surah_number || ':' || verse_number END) AS pending
      FROM word_translations
      WHERE language = ?
      GROUP BY surah_number
      ORDER BY surah_number`
    )
      .bind(langFilter)
      .all();

    return c.json({
      success: true as const,
      data: (rows.results || []).map((r: any) => ({
        surah_number: r.surah_number as number,
        translated: (r.translated as number) || 0,
        pending: (r.pending as number) || 0,
      })),
    });
  }
);

export default contributor;
