import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { drizzle } from "drizzle-orm/d1";
import { cors } from "hono/cors";
import { eq, asc } from "drizzle-orm";
import { quranTranslations, translationSources } from "./db/schema";

import { surahs } from "./data/surahs";
import { juzs } from "./data/juzs";
import { reciters, DEFAULT_RECITER_ID } from "./data/reciters";
import { revalidateExternalSource } from "./services/revalidation";
import { cleanMokhtasrText } from "./services/mokhtasr";
import auth from "./routes/auth";
import contributor from "./routes/contributor";
import admin from "./routes/admin";
import reports from "./routes/reports";

import {
  ErrorSchema,
  TranslationSourceSchema,
  SurahSchema,
  SurahWithPaginatedVersesSchema,
  SurahIdParamSchema,
  SurahVerseQuerySchema,
  VersesByKeysBodySchema,
  VersesByKeysResponseSchema,
  JuzSchema,
  ReciterSchema,
  RecitationTimingsParamSchema,
  RecitationTimingsSchema,
  TranslationAudioParamSchema,
  TranslationAudioSchema,
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
  TURNSTILE_SECRET_KEY: string;
  REVALIDATION_DAYS: string;
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
        data: surahs as unknown as z.infer<typeof SurahSchema>[],
        timestamp: new Date().toISOString(),
      },
      200,
    ),
);

// ─── GET /juzs ───────────────────────────────────────────────────────────────
// Returns static juz metadata for all 30 juz with surah info enriched from
// the surahs data. No database query — data is bundled at build time.

app.openapi(
  createRoute({
    method: "get",
    path: "/juzs",
    tags: ["Quran"],
    summary: "List all 30 juz with verse mappings and surah info",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(JuzSchema),
            }),
          },
        },
        description: "Juz list",
      },
    },
  }),
  (c) => {
    const data = juzs.map((juz) => {
      const juzSurahs = Object.entries(juz.verse_mapping).map(
        ([surahId, verses]) => {
          const surah = surahs.find((s) => s.id === Number(surahId));
          return {
            id: Number(surahId),
            name_thai: surah?.name_thai ?? "",
            name_arabic: surah?.name_arabic ?? "",
            verses,
          };
        },
      );
      return {
        number: juz.number,
        verse_mapping: juz.verse_mapping,
        verses_count: juz.verses_count,
        surahs: juzSurahs,
      };
    });

    return c.json(
      {
        success: true as const,
        data: data as unknown as z.infer<typeof JuzSchema>[],
      },
      200,
    );
  },
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

      // Lazy revalidation for external sources
      const revalidationDays = parseInt(c.env.REVALIDATION_DAYS || "0", 10);
      const sourceRow = await db
        .select({
          id: translationSources.id,
          externalType: translationSources.externalType,
          externalConfig: translationSources.externalConfig,
        })
        .from(translationSources)
        .where(eq(translationSources.id, sourceId))
        .limit(1);
      const isMokhtasr = sourceRow[0]?.externalType === "mokhtasr";

      if (revalidationDays > 0) {
        const src = sourceRow[0];
        if (src?.externalType) {
          // Stale-while-revalidate: serve what we have immediately and
          // refresh in the background via waitUntil. This avoids blocking
          // the response on slow external API calls (SWR pattern).
          const windowStart = offset + 1;
          const windowEnd = Math.min(offset + limit, surah.verses_count);
          const windowVerseNumbers = Array.from(
            { length: Math.max(0, windowEnd - windowStart + 1) },
            (_, i) => windowStart + i,
          );

          if (windowVerseNumbers.length > 0) {
            c.executionCtx.waitUntil(
              revalidateExternalSource(
                c.env.DB,
                src,
                numericId,
                windowVerseNumbers,
                revalidationDays,
              ),
            );
          }

          // Prefetch one page ahead in the background so forward
          // navigation is instant.
          const nextStart = windowEnd + 1;
          const nextEnd = Math.min(windowEnd + limit, surah.verses_count);
          if (nextStart <= nextEnd) {
            const nextVerseNumbers = Array.from(
              { length: nextEnd - nextStart + 1 },
              (_, i) => nextStart + i,
            );
            c.executionCtx.waitUntil(
              revalidateExternalSource(
                c.env.DB,
                src,
                numericId,
                nextVerseNumbers,
                revalidationDays,
              ),
            );
          }
        }
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

      if (arabicVerses.length === 0) {
        return c.json(
          {
            success: true as const,
            data: {
              ...surah,
              sourceId,
              verses: [],
              pagination: {
                offset,
                limit,
                total: surah.verses_count,
                hasMore: false,
              },
            } as unknown as z.infer<typeof SurahWithPaginatedVersesSchema>,
          },
          200,
        );
      }

      const verseNumbers = arabicVerses.map((v) => v.verseNumber);
      const placeholders = verseNumbers.map(() => "?").join(",");

      // Fetch Thai translations for the chosen source precisely for these verses
      const vtRows = await c.env.DB.prepare(
        `
        SELECT
          vt.id,
          vt.verse_number,
          vt.translation_text,
          vt.is_verified
        FROM verse_translations vt
        WHERE vt.source_id = ? AND vt.surah_number = ? AND vt.verse_number IN (${placeholders})
        ORDER BY vt.verse_number ASC
      `,
      )
        .bind(sourceId, numericId, ...verseNumbers)
        .all<{
          id: number;
          verse_number: number;
          translation_text: string;
          is_verified: number;
        }>();

      // Fetch footnotes scoped to the current verse range
      const footnoteMap = new Map<number, { number: number; text: string }[]>();

      if (vtRows.results.length > 0) {
        const fnRows = await c.env.DB.prepare(
          `
          SELECT tf.verse_translation_id, tf.footnote_number, tf.text
          FROM translation_footnotes tf
          WHERE tf.verse_translation_id IN (
            SELECT vt.id FROM verse_translations vt
            WHERE vt.source_id = ? AND vt.surah_number = ?
              AND vt.verse_number IN (${placeholders})
          )
          ORDER BY tf.verse_translation_id, tf.footnote_number ASC
        `,
        )
          .bind(sourceId, numericId, ...verseNumbers)
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
          translation: vt
            ? isMokhtasr
              ? cleanMokhtasrText(vt.translation_text)
              : vt.translation_text
            : "",
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

      // Cache-Control: Cache the response at the edge for 1 hour.
      // The lazy revalidation ensures that even cached responses are fresh within the revalidation window,
      // so we can afford to cache for a reasonable duration to improve performance and reduce load.
      c.header("Cache-Control", "public, max-age=3600");
      // populates missing external translations. Page-level ISR handles
      // edge caching in production.
      return c.json(
        {
          success: true as const,
          data: {
            ...surah,
            sourceId,
            verses,
            pagination,
          } as unknown as z.infer<typeof SurahWithPaginatedVersesSchema>,
        },
        200,
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

      // Lazy revalidation for external sources (by-keys)
      const revalidationDays = parseInt(c.env.REVALIDATION_DAYS || "0", 10);
      const sourceRow = await db
        .select({
          id: translationSources.id,
          externalType: translationSources.externalType,
          externalConfig: translationSources.externalConfig,
        })
        .from(translationSources)
        .where(eq(translationSources.id, sourceId))
        .limit(1);
      const isMokhtasr = sourceRow[0]?.externalType === "mokhtasr";

      if (revalidationDays > 0 && keys.length > 0) {
        const src = sourceRow[0];
        if (src?.externalType) {
          // Group keys by surah to check revalidation per surah
          const surahGroups = new Map<number, number[]>();
          for (const k of keys) {
            const [s, v] = k.split(":").map(Number);
            if (!surahGroups.has(s)) surahGroups.set(s, []);
            surahGroups.get(s)!.push(v);
          }

          // Stale-while-revalidate: refresh in the background so the
          // response is never blocked on slow external API calls.
          c.executionCtx.waitUntil(
            Promise.all(
              Array.from(surahGroups, ([surahNum, verses]) =>
                revalidateExternalSource(
                  c.env.DB,
                  src,
                  surahNum,
                  verses,
                  revalidationDays,
                ),
              ),
            ),
          );
        }
      }

      // Parse requested keys: "surah:verse" -> { surah, verse }
      const keyMap = new Map<
        string,
        { surah: number; verse: number; originalOrder: number }
      >();
      keys.forEach((k, idx) => {
        const [surah, verse] = k.split(":").map(Number);
        keyMap.set(k, { surah, verse, originalOrder: idx });
      });

      // Construct WHERE clause for multiple pairs: (surah = X AND verse = Y) OR ...
      // D1 has a parameter limit (usually 100 or 999), so if keys > 100 we might need chunking.
      // Maximum page size is ~15 verses on average, so max keys ~15. Chunking not strictly needed for page,
      // but let's build the query dynamically.
      const conditions: string[] = [];
      const params: (string | number | null | boolean)[] = [];
      for (const { surah, verse } of keyMap.values()) {
        conditions.push("(surah_number = ? AND verse_number = ?)");
        params.push(surah, verse);
      }

      if (conditions.length === 0) {
        return c.json(
          { success: true as const, data: { sourceId, verses: [] } },
          200,
        );
      }

      const whereClause = conditions.join(" OR ");

      // Fetch Arabic verse text
      const arabicVerses = await c.env.DB.prepare(
        `SELECT surah_number, verse_number, content FROM quran_translations WHERE ${whereClause}`,
      )
        .bind(...params)
        .all<{ surah_number: number; verse_number: number; content: string }>();

      // Fetch Thai translations for the chosen source
      const vtRows = await c.env.DB.prepare(
        `SELECT id, surah_number, verse_number, translation_text, is_verified 
         FROM verse_translations 
         WHERE source_id = ? AND (${whereClause})`,
      )
        .bind(sourceId, ...params)
        .all<{
          id: number;
          surah_number: number;
          verse_number: number;
          translation_text: string;
          is_verified: number;
        }>();

      const vtIds = vtRows.results.map((r) => r.id);

      const footnoteMap = new Map<number, { number: number; text: string }[]>();

      if (vtIds.length > 0) {
        // Fetch footnotes
        const placeholders = vtIds.map(() => "?").join(",");
        const fnRows = await c.env.DB.prepare(
          `SELECT verse_translation_id, footnote_number, text 
           FROM translation_footnotes 
           WHERE verse_translation_id IN (${placeholders})
           ORDER BY verse_translation_id, footnote_number ASC`,
        )
          .bind(...vtIds)
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
        vtRows.results.map((r) => [`${r.surah_number}:${r.verse_number}`, r]),
      );

      const arabicByVerse = new Map(
        arabicVerses.results.map((r) => [
          `${r.surah_number}:${r.verse_number}`,
          r,
        ]),
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
          translation: vt
            ? isMokhtasr
              ? cleanMokhtasrText(vt.translation_text)
              : vt.translation_text
            : "",
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
      return c.json(
        { success: false as const, message: "Failed to fetch verses by keys" },
        500,
      );
    }
  },
);

// ─── GET /verse-words/:surahId ─────────────────────────────────────────────────
// Serves word-level data for QCF glyph rendering, fetched from R2 assets.
// Falls back to local static files if R2 doesn't have the data.

app.get("/verse-words/:surahId", async (c) => {
  const { surahId } = c.req.param();
  const numericId = parseInt(surahId);

  if (numericId < 1 || numericId > 114) {
    return c.json({ success: false, message: "Invalid surah ID" }, 400);
  }

  try {
    // Try R2 first
    const obj = await c.env.ASSETS_BUCKET.get(`quran-words/${numericId}.json`);

    if (obj) {
      const data = await obj.json();
      return c.json({ success: true, data });
    }

    // Fallback: Import local static file
    const localData = await import(`../data/quran-words/${numericId}.json`);
    return c.json({ success: true, data: localData.default || localData });
  } catch (e) {
    console.error("Error fetching verse words:", e);
    return c.json({ success: false, message: "Words not found" }, 404);
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
      const data = sources.map((s) => ({
        id: s.id,
        name: s.name,
        short_name: s.shortName,
        author: s.author,
        language: s.language,
        description: s.description,
        is_default: s.isDefault,
        isExternal: s.externalType !== null,
        created_at: s.createdAt,
      }));
      return c.json(
        {
          success: true as const,
          data: data as unknown as z.infer<typeof TranslationSourceSchema>[],
        },
        200,
      );
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

// ─── GET /reciters ────────────────────────────────────────────────────────────
// Reciters with word-level timing segments (static list).

app.openapi(
  createRoute({
    method: "get",
    path: "/reciters",
    tags: ["Recitations"],
    summary:
      "List reciters (hasWordTimings marks word-by-word highlight support)",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: z.array(ReciterSchema),
              defaultReciterId: z.number(),
            }),
          },
        },
        description: "Reciter list",
      },
    },
  }),
  (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(
      {
        success: true as const,
        data: reciters.map(({ id, name, style, hasWordTimings }) => ({
          id,
          name,
          style,
          hasWordTimings,
        })),
        defaultReciterId: DEFAULT_RECITER_ID,
      },
      200,
    );
  },
);

// ─── GET /recitations/:reciterId/:chapter/timings ────────────────────────────
// Word-level timings for a surah recitation, sourced from quran.com (QDC).
// Only timings pass through the Worker; the client streams `audioUrl`
// directly from quranicaudio.com. Upstream responses are edge-cached via
// cf.cacheTtl and the browser caches ours for 7 days — timings almost never
// change, so no KV layer is needed.

const RECITATION_CACHE_SECONDS = 604800;

interface QdcAudioFilesResponse {
  audio_files: {
    audio_url: string;
    duration: number;
    verse_timings: {
      verse_key: string;
      timestamp_from: number;
      timestamp_to: number;
      segments: number[][];
    }[];
  }[];
}

interface Mp3QuranAyahTiming {
  ayah: number;
  start_time: number;
  end_time: number;
}

// Quiet window at each ayah boundary, measured offline from the reciter's mp3 by
// scripts/recitation-pauses/measure.mjs and uploaded to R2. Lets the player keep
// playing through ayahs the reciter joins in one breath.
const RECITATION_PAUSES_PREFIX = "recitation-pauses/v1";

interface RecitationPausesFile {
  audioUrl: string;
  verses: string[];
  pauses: [number, number][];
}

async function loadRecitationPauses(
  bucket: R2Bucket,
  reciterId: number,
  chapter: number,
  audioUrl: string,
  verses: { verseKey: string; from: number }[],
): Promise<[number, number][] | undefined> {
  // Measured in playback order, which is how the player indexes them
  const verseKeys = [...verses]
    .sort((a, b) => a.from - b.from)
    .map((v) => v.verseKey);
  try {
    const obj = await bucket.get(
      `${RECITATION_PAUSES_PREFIX}/${reciterId}/${chapter}.json`,
    );
    if (!obj) return undefined;
    const file = await obj.json<RecitationPausesFile>();
    // Stale if the upstream audio or its verse list changed since measuring
    const matches =
      file.audioUrl === audioUrl &&
      file.pauses.length === verseKeys.length &&
      file.verses.every((k, i) => k === verseKeys[i]);
    return matches ? file.pauses : undefined;
  } catch (e) {
    console.error("recitation pauses unreadable", e);
    return undefined;
  }
}

app.openapi(
  createRoute({
    method: "get",
    path: "/recitations/{reciterId}/{chapter}/timings",
    tags: ["Recitations"],
    summary: "Get surah audio URL with word-level timings",
    request: {
      params: RecitationTimingsParamSchema,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: RecitationTimingsSchema,
            }),
          },
        },
        description: "Audio URL and per-word timings",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Reciter not supported",
      },
      502: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Upstream audio provider error",
      },
    },
  }),
  async (c) => {
    const { reciterId, chapter } = c.req.valid("param");

    // Allowlist prevents this route from acting as an open proxy.
    const reciter = reciters.find((r) => r.id === reciterId);
    if (!reciter) {
      return c.json(
        { success: false as const, message: "Reciter not supported" },
        404,
      );
    }

    if (reciter.ayahTimingsRead && reciter.audioFolder) {
      try {
        const upstream = await fetch(
          `https://www.mp3quran.net/api/v3/ayat_timing?surah=${chapter}&read=${reciter.ayahTimingsRead}`,
          {
            cf: { cacheTtl: RECITATION_CACHE_SECONDS, cacheEverything: true },
          },
        );
        if (!upstream.ok) {
          return c.json(
            { success: false as const, message: "Upstream error" },
            502,
          );
        }

        const rows = await upstream.json<Mp3QuranAyahTiming[]>();
        // ayah 0 is the audio intro (isti'adha/basmala), not a verse
        const verses = rows
          .filter((r) => r.ayah > 0)
          .map((r) => ({
            verseKey: `${chapter}:${r.ayah}`,
            from: r.start_time,
            to: r.end_time,
            segments: [] as [number, number, number][],
          }));
        if (verses.length === 0) {
          return c.json(
            { success: false as const, message: "Recitation not available" },
            502,
          );
        }

        const audioUrl = `https://cdn.mp3quran.net/audio/${reciter.audioFolder}/${String(chapter).padStart(3, "0")}.mp3`;
        const pauses = await loadRecitationPauses(
          c.env.ASSETS_BUCKET,
          reciterId,
          chapter,
          audioUrl,
          verses,
        );

        c.header(
          "Cache-Control",
          `public, max-age=${RECITATION_CACHE_SECONDS}, stale-while-revalidate=86400`,
        );
        return c.json(
          {
            success: true as const,
            data: {
              reciterId,
              chapter,
              audioUrl,
              duration: verses[verses.length - 1]!.to,
              verses,
              pauses,
            },
          },
          200,
        );
      } catch (e) {
        console.error(e);
        return c.json(
          { success: false as const, message: "Upstream error" },
          502,
        );
      }
    }

    try {
      const upstream = await fetch(
        `https://api.qurancdn.com/api/qdc/audio/reciters/${reciterId}/audio_files?chapter=${chapter}&segments=true`,
        {
          cf: { cacheTtl: RECITATION_CACHE_SECONDS, cacheEverything: true },
        },
      );
      if (!upstream.ok) {
        return c.json(
          { success: false as const, message: "Upstream error" },
          502,
        );
      }

      const { audio_files: files } =
        await upstream.json<QdcAudioFilesResponse>();
      const file = files?.[0];
      if (!file) {
        return c.json(
          { success: false as const, message: "Recitation not available" },
          502,
        );
      }

      const verses = file.verse_timings.map((v) => ({
        verseKey: v.verse_key,
        from: v.timestamp_from,
        to: v.timestamp_to,
        // Upstream contains malformed entries like [1] or [2, 500]
        segments: (v.segments ?? []).filter(
          (s): s is [number, number, number] => s.length === 3,
        ),
      }));
      const pauses = await loadRecitationPauses(
        c.env.ASSETS_BUCKET,
        reciterId,
        chapter,
        file.audio_url,
        verses,
      );

      c.header(
        "Cache-Control",
        `public, max-age=${RECITATION_CACHE_SECONDS}, stale-while-revalidate=86400`,
      );
      return c.json(
        {
          success: true as const,
          data: {
            reciterId,
            chapter,
            audioUrl: file.audio_url,
            duration: file.duration,
            verses,
            pauses,
          },
        },
        200,
      );
    } catch (e) {
      console.error(e);
      return c.json(
        { success: false as const, message: "Upstream error" },
        502,
      );
    }
  },
);

// ─── GET /translation-audio/:chapter ─────────────────────────────────────────
// Thai reading of the Al-Mukhtasar translation: one mp3 per surah plus per-ayah
// offsets. `current.json` points at the active audio set; the mp3 is streamed
// straight from the assets host, only the manifest passes through the Worker.

const TRANSLATION_AUDIO_PREFIX = "translation-audio/mukhtasar-th";

interface TranslationAudioManifest {
  set: string;
  surah: number;
  provider: string;
  model: string;
  voiceId: string;
  durationMs: number;
  ayahs: { ayah: number; startMs: number; endMs: number }[];
}

app.openapi(
  createRoute({
    method: "get",
    path: "/translation-audio/{chapter}",
    tags: ["Recitations"],
    summary: "Get Thai translation audio URL with per-ayah timings",
    request: {
      params: TranslationAudioParamSchema,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              data: TranslationAudioSchema,
            }),
          },
        },
        description: "Audio URL and per-ayah offsets",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No translation audio for this surah",
      },
    },
  }),
  async (c) => {
    const { chapter } = c.req.valid("param");
    const notFound = () =>
      c.json(
        { success: false as const, message: "Translation audio not found" },
        404,
      );

    const pointer = await c.env.ASSETS_BUCKET.get(
      `${TRANSLATION_AUDIO_PREFIX}/current.json`,
    );
    if (!pointer) return notFound();
    const { set } = await pointer.json<{ set: string }>();

    const manifestObj = await c.env.ASSETS_BUCKET.get(
      `${TRANSLATION_AUDIO_PREFIX}/${set}/${chapter}.json`,
    );
    if (!manifestObj) return notFound();
    const manifest = await manifestObj.json<TranslationAudioManifest>();

    c.header("Cache-Control", "public, max-age=300");
    return c.json(
      {
        success: true as const,
        data: {
          set,
          chapter,
          audioUrl: `${c.env.ASSETS_BASE_URL}/${TRANSLATION_AUDIO_PREFIX}/${set}/${chapter}.mp3`,
          durationMs: manifest.durationMs,
          ayahs: manifest.ayahs.map(({ ayah, startMs, endMs }) => ({
            ayah,
            startMs,
            endMs,
          })),
          voice: {
            provider: manifest.provider,
            model: manifest.model,
            voiceId: manifest.voiceId,
          },
        },
      },
      200,
    );
  },
);

// ─── Sub-routers ──────────────────────────────────────────────────────────────
// Each sub-router is defined in its own file and mounted here.
// OpenAPIHono automatically aggregates their routes into the /doc spec.

app.route("/auth", auth);
app.route("/contributor", contributor);
app.route("/admin", admin);
app.route("/reports", reports);

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
