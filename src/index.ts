import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { drizzle } from "drizzle-orm/d1";
import { cors } from "hono/cors";
import { eq, asc } from "drizzle-orm";
import { quranTranslations, translationSources } from "./db/schema";

import { surahs } from "./data/surahs";
import auth from "./routes/auth";
import contributor from "./routes/contributor";
import admin from "./routes/admin";

import {
  ErrorSchema,
  TranslationSourceSchema,
  SurahSchema,
  SurahWithPaginatedVersesSchema,
  SurahIdParamSchema,
  SurahVerseQuerySchema,
  VersesByKeysBodySchema,
  VersesByKeysResponseSchema,
} from "./openapi/schemas";

type MushafPageEntry = {
  page: number;
  verseFrom: number;
  verseTo: number;
  verseCount: number;
};

type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS_BUCKET: R2Bucket;
  JWT_SECRET: string;
  ASSETS_BASE_URL: string;
};

// ─── App ──────────────────────────────────────────────────────────────────────
// defaultHook fires after every route's Zod validation.
// Returning a Response here short-circuits the handler; returning nothing
// lets the request proceed normally (void is the correct type for that path).

const app = new OpenAPIHono<{ Bindings: Bindings }>({
  // eslint-disable-next-line consistent-return
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false as const,
          message: "Validation error",
          errors: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        422,
      );
    }
  },
});

app.use("/*", cors());

// ─── GET / ────────────────────────────────────────────────────────────────────

app.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Health"],
    summary: "API health check",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              message: z.string(),
              status: z.string(),
              timestamp: z.string(),
            }),
          },
        },
        description: "API is online",
      },
    },
  }),
  (c) =>
    c.json(
      {
        message: "Quran API",
        status: "online",
        timestamp: new Date().toISOString(),
      },
      200,
    ),
);

// ─── GET /surahs ──────────────────────────────────────────────────────────────
// Returns static surah metadata (name, number, verse count, etc.) for all
// 114 surahs. No database query — data is bundled at build time.

app.openapi(
  createRoute({
    method: "get",
    path: "/surahs",
    tags: ["Quran"],
    summary: "List all 114 surahs (static metadata)",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(SurahSchema),
              timestamp: z.string(),
            }),
          },
        },
        description: "Surah list",
      },
    },
  }),
  (c) =>
    c.json(
      {
        success: true as const,
        data: surahs as any[],
        timestamp: new Date().toISOString(),
      },
      200,
    ),
);

// ─── GET /surahs/:id ──────────────────────────────────────────────────────────
// Returns a single surah with its Arabic verses and Thai translations.
// Accepts an optional `sourceId` query param to select a translation source;
// falls back to the source marked `is_default = 1` in the DB.
// Footnotes are fetched in a second query and joined in-memory by verse ID.

app.openapi(
  createRoute({
    method: "get",
    path: "/surahs/{id}",
    tags: ["Quran"],
    summary: "Get a surah with verses and Thai translations",
    request: {
      params: SurahIdParamSchema,
      query: SurahVerseQuerySchema,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: SurahWithPaginatedVersesSchema,
            }),
          },
        },
        description: "Surah with paginated verses",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Surah not found",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { sourceId: sourceIdParam, offset, limit } = c.req.valid("query");
    const numericId = parseInt(id);
    const surah = surahs.find((s) => s.id === numericId);

    if (!surah) {
      return c.json(
        { success: false as const, message: "Surah not found" },
        404,
      );
    }

    try {
      const db = drizzle(c.env.DB);

      // Resolve which translation source to use
      let sourceId: number;
      if (sourceIdParam) {
        sourceId = sourceIdParam;
      } else {
        const defaultSource = await db
          .select({ id: translationSources.id })
          .from(translationSources)
          .where(eq(translationSources.isDefault, 1))
          .limit(1);
        sourceId = defaultSource[0]?.id ?? 1;
      }

      // Fetch Arabic verse text from quran_translations with pagination
      const arabicVerses = await db
        .select({
          surahNumber: quranTranslations.surahNumber,
          verseNumber: quranTranslations.verseNumber,
          content: quranTranslations.content,
        })
        .from(quranTranslations)
        .where(eq(quranTranslations.surahNumber, numericId))
        .orderBy(asc(quranTranslations.verseNumber))
        .limit(limit)
        .offset(offset)
        .all();

      // Fetch Thai translations for the chosen source with pagination
      const vtRows = await c.env.DB.prepare(
        `
        SELECT
          vt.id,
          vt.verse_number,
          vt.translation_text,
          vt.is_verified
        FROM verse_translations vt
        WHERE vt.source_id = ? AND vt.surah_number = ?
        ORDER BY vt.verse_number ASC
        LIMIT ? OFFSET ?
      `,
      )
        .bind(sourceId, numericId, limit, offset)
        .all<{
          id: number;
          verse_number: number;
          translation_text: string;
          is_verified: number;
        }>();

      // Fetch footnotes scoped to the current verse range to avoid D1's bound-parameter limit.
      const footnoteMap = new Map<number, { number: number; text: string }[]>();

      if (vtRows.results.length > 0) {
        // Calculate verse range: (offset, offset + limit]
        const verseStart = offset;
        const verseEnd = offset + limit;

        const fnRows = await c.env.DB.prepare(
          `
          SELECT tf.verse_translation_id, tf.footnote_number, tf.text
          FROM translation_footnotes tf
          WHERE tf.verse_translation_id IN (
            SELECT vt.id FROM verse_translations vt
            WHERE vt.source_id = ? AND vt.surah_number = ?
              AND vt.verse_number > ? AND vt.verse_number <= ?
          )
          ORDER BY tf.verse_translation_id, tf.footnote_number ASC
        `,
        )
          .bind(sourceId, numericId, verseStart, verseEnd)
          .all<{
            verse_translation_id: number;
            footnote_number: number;
            text: string;
          }>();

        fnRows.results.forEach((fn) => {
          if (!footnoteMap.has(fn.verse_translation_id)) {
            footnoteMap.set(fn.verse_translation_id, []);
          }
          footnoteMap
            .get(fn.verse_translation_id)!
            .push({ number: fn.footnote_number, text: fn.text });
        });
      }

      // Merge Arabic content + Thai translation + footnotes per verse
      const translationByVerse = new Map(
        vtRows.results.map((r) => [r.verse_number, r]),
      );

      const verses = arabicVerses.map((av) => {
        const vt = translationByVerse.get(av.verseNumber);
        return {
          verseNumber: av.verseNumber,
          content: av.content,
          translation: vt?.translation_text ?? "",
          footnotes: vt ? (footnoteMap.get(vt.id) ?? []) : [],
          isVerified: vt ? Boolean(vt.is_verified) : false,
        };
      });

      // Compute pagination metadata from static surah data
      const total = surah.verses_count;
      const hasMore = offset + limit < total;

      const pagination = {
        offset,
        limit,
        total,
        hasMore,
      };

      c.header("Cache-Control", "public, max-age=3600");
      return c.json(
        {
          success: true as const,
          data: { ...surah, sourceId, verses, pagination } as any,
        },
      );
    } catch (e) {
      console.error(e);
      return c.json(
        { success: false as const, message: "Failed to fetch verses" },
        500,
      );
    }
  },
);

// ─── POST /verses/by-keys ──────────────────────────────────────────────────────
// Returns a list of verses matching the provided "surahNumber:verseNumber" keys
// in the exact order requested. Used by Mushaf page translation views where
// verses span across multiple logical surahs or don't form a contiguous block.

app.openapi(
  createRoute({
    method: "post",
    path: "/verses/by-keys",
    tags: ["Quran"],
    summary: "Get specific verses by their surah:verse keys",
    request: {
      body: {
        content: {
          "application/json": {
            schema: VersesByKeysBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: VersesByKeysResponseSchema,
          },
        },
        description: "List of requested verses",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    const { sourceId: sourceIdParam, keys } = c.req.valid("json");

    try {
      const db = drizzle(c.env.DB);

      // Resolve which translation source to use
      let sourceId: number;
      if (sourceIdParam) {
        sourceId = sourceIdParam;
      } else {
        const defaultSource = await db
          .select({ id: translationSources.id })
          .from(translationSources)
          .where(eq(translationSources.isDefault, 1))
          .limit(1);
        sourceId = defaultSource[0]?.id ?? 1;
      }

      // Parse requested keys: "surah:verse" -> { surah, verse }
      const keyMap = new Map<string, { surah: number; verse: number; originalOrder: number }>();
      keys.forEach((k, idx) => {
        const [surah, verse] = k.split(":").map(Number);
        keyMap.set(k, { surah, verse, originalOrder: idx });
      });

      // Construct WHERE clause for multiple pairs: (surah = X AND verse = Y) OR ...
      // D1 has a parameter limit (usually 100 or 999), so if keys > 100 we might need chunking.
      // Maximum page size is ~15 verses on average, so max keys ~15. Chunking not strictly needed for page, 
      // but let's build the query dynamically.
      const conditions: string[] = [];
      const params: any[] = [];
      for (const { surah, verse } of keyMap.values()) {
        conditions.push("(surah_number = ? AND verse_number = ?)");
        params.push(surah, verse);
      }
      
      if (conditions.length === 0) {
        return c.json({ success: true as const, data: { sourceId, verses: [] } }, 200);
      }

      const whereClause = conditions.join(" OR ");

      // Fetch Arabic verse text
      const arabicVerses = await c.env.DB.prepare(
        `SELECT surah_number, verse_number, content FROM quran_translations WHERE ${whereClause}`
      ).bind(...params).all<{ surah_number: number; verse_number: number; content: string }>();

      // Fetch Thai translations for the chosen source 
      const vtRows = await c.env.DB.prepare(
        `SELECT id, surah_number, verse_number, translation_text, is_verified 
         FROM verse_translations 
         WHERE source_id = ? AND (${whereClause})`
      ).bind(sourceId, ...params).all<{ id: number; surah_number: number; verse_number: number; translation_text: string; is_verified: number }>();

      const vtIds = vtRows.results.map((r) => r.id);
      
      const footnoteMap = new Map<number, { number: number; text: string }[]>();
      
      if (vtIds.length > 0) {
        // Fetch footnotes
        const placeholders = vtIds.map(() => "?").join(",");
        const fnRows = await c.env.DB.prepare(
          `SELECT verse_translation_id, footnote_number, text 
           FROM translation_footnotes 
           WHERE verse_translation_id IN (${placeholders})
           ORDER BY verse_translation_id, footnote_number ASC`
        ).bind(...vtIds).all<{ verse_translation_id: number; footnote_number: number; text: string }>();

        fnRows.results.forEach((fn) => {
          if (!footnoteMap.has(fn.verse_translation_id)) {
            footnoteMap.set(fn.verse_translation_id, []);
          }
          footnoteMap.get(fn.verse_translation_id)!.push({ number: fn.footnote_number, text: fn.text });
        });
      }

      // Merge Arabic content + Thai translation + footnotes per verse
      const translationByVerse = new Map(
        vtRows.results.map((r) => [`${r.surah_number}:${r.verse_number}`, r])
      );
      
      const arabicByVerse = new Map(
        arabicVerses.results.map((r) => [`${r.surah_number}:${r.verse_number}`, r])
      );

      // Assemble results strictly in the order requested by `keys`
      const verses = keys.map((k) => {
        const arabic = arabicByVerse.get(k);
        const vt = translationByVerse.get(k);
        const [surah, verse] = k.split(":").map(Number);
        
        return {
          surahNumber: surah,
          verseNumber: verse,
          content: arabic?.content ?? "",
          translation: vt?.translation_text ?? "",
          footnotes: vt ? (footnoteMap.get(vt.id) ?? []) : [],
          isVerified: vt ? Boolean(vt.is_verified) : false,
        };
      });

      return c.json(
        {
          success: true as const,
          data: { sourceId, verses },
        },
        200,
      );
    } catch (e) {
      console.error(e);
      return c.json({ success: false as const, message: "Failed to fetch verses by keys" }, 500);
    }
  }
);

// ─── GET /verse-words/:surahId ─────────────────────────────────────────────────
// Serves word-level data for QCF glyph rendering, fetched from R2 assets.

app.get("/verse-words/:surahId", async (c) => {
  const { surahId } = c.req.param();
  const numericId = parseInt(surahId);

  if (numericId < 1 || numericId > 114) {
    return c.json({ success: false, message: "Invalid surah ID" }, 400);
  }

  try {
    const obj = await c.env.ASSETS_BUCKET.get(`quran-words/${numericId}.json`);

    if (!obj) {
      return c.json({ success: false, message: "Words not found" }, 404);
    }

    const data = await obj.json();
    return c.json({ success: true, data });
  } catch (e) {
    console.error("Error fetching verse words:", e);
    return c.json({ success: false, message: "Server error" }, 500);
  }
});

// ─── GET /surahs/:id/mushaf-pages ───────────────────────────────────────────────
// Returns Mushaf page boundaries for a surah.
// Each entry maps a Mushaf page number to the verse range it contains.
// Frontend uses this for Mushaf-aligned pagination.

app.get("/surahs/:id/mushaf-pages", async (c) => {
  const { id } = c.req.param();
  const numericId = parseInt(id);

  if (numericId < 1 || numericId > 114) {
    return c.json({ success: false, message: "Invalid surah ID" }, 400);
  }

  try {
    const obj = await c.env.ASSETS_BUCKET.get(
      "quran-pages/surah-page-mapping.json",
    );

    if (!obj) {
      return c.json(
        { success: false, message: "Failed to fetch page mapping" },
        500,
      );
    }

    const mapping = await obj.json<Record<string, MushafPageEntry[]>>();
    const pages = mapping[String(numericId)];

    if (!pages) {
      return c.json(
        { success: false, message: "Surah page mapping not found" },
        404,
      );
    }

    return c.json({ success: true, data: pages });
  } catch (e) {
    console.error("Error fetching Mushaf page mapping:", e);
    return c.json({ success: false, message: "Server error" }, 500);
  }
});

// ─── GET /translation-sources ─────────────────────────────────────────────────
// Lists all available translation sources ordered by ID.
// The frontend uses this to populate the source selector dropdown.

app.openapi(
  createRoute({
    method: "get",
    path: "/translation-sources",
    tags: ["Quran"],
    summary: "List all available translation sources",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(TranslationSourceSchema),
            }),
          },
        },
        description: "Translation sources",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const sources = await db
        .select()
        .from(translationSources)
        .orderBy(asc(translationSources.id))
        .all();
      return c.json({ success: true as const, data: sources as any[] }, 200);
    } catch (e) {
      console.error(e);
      return c.json(
        {
          success: false as const,
          message: "Failed to fetch translation sources",
        },
        500,
      );
    }
  },
);

// ─── Sub-routers ──────────────────────────────────────────────────────────────
// Each sub-router is defined in its own file and mounted here.
// OpenAPIHono automatically aggregates their routes into the /doc spec.

app.route("/auth", auth);
app.route("/contributor", contributor);
app.route("/admin", admin);

// ─── OpenAPI spec + Swagger UI ────────────────────────────────────────────────
// Register the bearer auth security scheme so it appears in the Swagger UI
// "Authorize" button. Individual routes opt in via security: [{ bearerAuth: [] }].

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "JWT token obtained from POST /auth/login",
});

// Serve the OpenAPI JSON spec at /doc
app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    title: "Quran API",
    version: "1.0.0",
    description:
      "REST API for the Open Thai Quran Project — community-driven Quran translation correction for Thai readers.",
  },
  servers: [
    { url: "http://localhost:8787", description: "Local development" },
    { url: "https://api.quran.example.com", description: "Production" },
  ],
});

// Serve the Swagger UI at /ui
app.get("/ui", swaggerUI({ url: "/doc" }));

// Export AppType for Hono RPC client
export type AppType = typeof app;

export default app;
