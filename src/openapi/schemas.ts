import { z } from "@hono/zod-openapi";

// ─── Common ───────────────────────────────────────────────────────────────────

export const ErrorSchema = z
  .object({
    success: z.literal(false),
    message: z.string().openapi({ example: "Something went wrong" }),
  })
  .openapi("ErrorResponse");

export const MessageSchema = z
  .object({
    success: z.literal(true),
    message: z.string().openapi({ example: "Operation successful" }),
  })
  .openapi("MessageResponse");

export const IdParamSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/, "Must be a numeric ID")
    .openapi({ param: { name: "id", in: "path" }, example: "1" }),
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const ContributorPublicSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    email: z.string().email().openapi({ example: "admin@example.com" }),
    displayName: z.string().nullable().openapi({ example: "Admin User" }),
    role: z.enum(["contributor", "admin"]).openapi({ example: "admin" }),
  })
  .openapi("ContributorPublic");

export const LoginBodySchema = z
  .object({
    email: z.string().email().openapi({ example: "admin@example.com" }),
    password: z.string().min(1).openapi({ example: "password123" }),
  })
  .openapi("LoginBody");

export const LoginResponseSchema = z
  .object({
    success: z.literal(true),
    token: z
      .string()
      .openapi({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }),
    contributor: ContributorPublicSchema,
  })
  .openapi("LoginResponse");

export const SetupBodySchema = z
  .object({
    email: z.string().email().openapi({ example: "admin@example.com" }),
    password: z.string().min(6).openapi({ example: "strongpassword" }),
    displayName: z.string().min(1).openapi({ example: "System Admin" }),
  })
  .openapi("SetupBody");

// ─── Translation Sources ───────────────────────────────────────────────────────

export const TranslationSourceSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    name: z.string().openapi({ example: "IIFA Edition" }),
    short_name: z.string().nullable().openapi({ example: "IIFA" }),
    author: z.string().nullable().openapi({ example: "IIFA" }),
    language: z.string().openapi({ example: "th" }),
    description: z.string().nullable(),
    is_default: z.number().openapi({ example: 1 }),
    created_at: z.union([z.string(), z.number()]).nullable(),
  })
  .openapi("TranslationSource");

export const SourceCreateBodySchema = z
  .object({
    name: z.string().min(1).openapi({ example: "IIFA Edition" }),
    shortName: z.string().optional().openapi({ example: "IIFA" }),
    author: z.string().optional().openapi({ example: "IIFA" }),
    language: z.string().optional().openapi({ example: "th" }),
    description: z.string().optional(),
    isDefault: z.boolean().optional().openapi({ example: false }),
  })
  .openapi("SourceCreateBody");

export const SourceUpdateBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    shortName: z.string().optional(),
    author: z.string().optional(),
    language: z.string().optional(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi("SourceUpdateBody");

// ─── Users ────────────────────────────────────────────────────────────────────

export const UserCreateBodySchema = z
  .object({
    email: z.string().email().openapi({ example: "user@example.com" }),
    displayName: z.string().min(1).openapi({ example: "New User" }),
    password: z.string().min(6).openapi({ example: "password123" }),
    role: z
      .enum(["contributor", "admin"])
      .default("contributor")
      .openapi({ example: "contributor" }),
  })
  .openapi("UserCreateBody");

export const UserUpdateBodySchema = z
  .object({
    displayName: z.string().min(1).optional(),
    role: z.enum(["contributor", "admin"]).optional(),
    isActive: z.boolean().optional(),
  })
  .openapi("UserUpdateBody");

export const ContributorListItemSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    email: z.string().email().openapi({ example: "admin@example.com" }),
    displayName: z.string().nullable().openapi({ example: "Admin User" }),
    role: z.enum(["contributor", "admin"]).openapi({ example: "admin" }),
    isActive: z.boolean().openapi({ example: true }),
    createdAt: z.union([z.string(), z.number()]).nullable(),
    lastLoginAt: z.union([z.string(), z.number()]).nullable(),
  })
  .openapi("ContributorListItem");

// ─── Verses ───────────────────────────────────────────────────────────────────

export const VerseRowSchema = z
  .object({
    id: z.number(),
    source_id: z.number(),
    surah_number: z.number().openapi({ example: 1 }),
    verse_number: z.number().openapi({ example: 1 }),
    content: z
      .string()
      .openapi({ example: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ" }),
    translation: z.string().openapi({ example: "ด้วยพระนามของอัลลอฮ์" }),
    is_verified: z.number(),
    pending_count: z.number(),
    issue_count: z.number(),
  })
  .openapi("VerseRow");

export const VerseTranslationIdParamSchema = z.object({
  verseTranslationId: z
    .string()
    .regex(/^\d+$/, "Must be a numeric ID")
    .openapi({
      param: { name: "verseTranslationId", in: "path" },
      example: "1",
    }),
});

export const VerseDetailSchema = z
  .object({
    id: z.number(),
    source_id: z.number(),
    surah_number: z.number(),
    verse_number: z.number(),
    translation_text: z.string(),
    is_verified: z.union([z.number(), z.boolean()]),
    content: z.string(),
  })
  .openapi("VerseDetail");

export const VerseWithContributionsSchema = z
  .object({
    verse: VerseDetailSchema,
    contributions: z.array(z.record(z.string(), z.unknown())),
  })
  .openapi("VerseWithContributions");

// ─── Contributions ─────────────────────────────────────────────────────────────

export const ContributionBodySchema = z
  .object({
    verseTranslationId: z.number().int().positive().openapi({ example: 1 }),
    suggestedTranslation: z
      .string()
      .min(1)
      .openapi({ example: "ด้วยพระนามของอัลลอฮ์ ผู้ทรงเมตตา" }),
  })
  .openapi("ContributionBody");

// ─── Word Translations ─────────────────────────────────────────────────────────

export const WordTranslationSchema = z
  .object({
    id: z.number(),
    surah_number: z.number(),
    verse_number: z.number(),
    word_position: z.number(),
    arabic_text: z.string(),
    thai_meaning: z.string(),
    contributor_id: z.number().nullable(),
    status: z.string(),
    created_at: z.union([z.string(), z.number()]).nullable(),
    updated_at: z.union([z.string(), z.number()]).nullable(),
  })
  .openapi("WordTranslation");

export const WordTranslationBodySchema = z
  .object({
    surahNumber: z.number().int().positive().openapi({ example: 1 }),
    verseNumber: z.number().int().positive().openapi({ example: 1 }),
    wordPosition: z.number().int().positive().openapi({ example: 1 }),
    arabicText: z.string().min(1).openapi({ example: "بِسْمِ" }),
    thaiMeaning: z.string().min(1).openapi({ example: "ในนาม" }),
  })
  .openapi("WordTranslationBody");

// ─── Footnotes ─────────────────────────────────────────────────────────────────

export const FootnoteSchema = z
  .object({
    id: z.number(),
    footnote_number: z.number(),
    text: z.string(),
  })
  .openapi("Footnote");

export const FootnoteBodySchema = z
  .object({
    verseTranslationId: z.number().int().positive().openapi({ example: 1 }),
    footnoteNumber: z.number().int().positive().openapi({ example: 1 }),
    text: z.string().min(1).openapi({ example: "หมายเหตุเพิ่มเติม..." }),
  })
  .openapi("FootnoteBody");

// ─── Surahs (Public) ──────────────────────────────────────────────────────────

export const SurahVerseSchema = z
  .object({
    verseNumber: z.number(),
    content: z.string(),
    translation: z.string(),
    footnotes: z.array(z.object({ number: z.number(), text: z.string() })),
    isVerified: z.boolean(),
  })
  .openapi("SurahVerse");

export const SurahSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    name: z.string().openapi({ example: "Al-Fatihah" }),
  })
  .passthrough()
  .openapi("Surah");

export const SurahWithVersesSchema = SurahSchema.extend({
  sourceId: z.number(),
  verses: z.array(SurahVerseSchema),
}).openapi("SurahWithVerses");

export const SurahIdParamSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/)
    .openapi({ param: { name: "id", in: "path" }, example: "1" }),
});

export const SurahVerseQuerySchema = z.object({
  sourceId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .openapi({
      param: { name: "sourceId", in: "query" },
      example: 1,
    }),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .openapi({
      param: { name: "offset", in: "query" },
      example: 0,
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .openapi({
      param: { name: "limit", in: "query" },
      example: 30,
    }),
});

export const PaginationSchema = z
  .object({
    offset: z.number(),
    limit: z.number(),
    total: z.number(),
    hasMore: z.boolean(),
  })
  .openapi("Pagination");

export const SurahWithPaginatedVersesSchema = SurahSchema.extend({
  sourceId: z.number(),
  verses: z.array(SurahVerseSchema),
  pagination: PaginationSchema,
}).openapi("SurahWithPaginatedVerses");
