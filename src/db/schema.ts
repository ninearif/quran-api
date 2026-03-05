import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const translationSources = sqliteTable("translation_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  shortName: text("short_name"),
  author: text("author"),
  language: text("language").notNull().default("th"),
  description: text("description"),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const verseTranslations = sqliteTable(
  "verse_translations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => translationSources.id),
    surahNumber: integer("surah_number").notNull(),
    verseNumber: integer("verse_number").notNull(),
    translationText: text("translation_text").notNull(),
    isVerified: integer("is_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    lastUpdated: integer("last_updated", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (table) => ({
    uniqueIdx: uniqueIndex("idx_vt_unique").on(
      table.sourceId,
      table.surahNumber,
      table.verseNumber,
    ),
    surahIdx: index("idx_vt_surah").on(table.sourceId, table.surahNumber),
  }),
);

export const translationFootnotes = sqliteTable(
  "translation_footnotes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    verseTranslationId: integer("verse_translation_id")
      .notNull()
      .references(() => verseTranslations.id),
    footnoteNumber: integer("footnote_number").notNull(),
    text: text("text").notNull(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex("idx_fn_unique").on(
      table.verseTranslationId,
      table.footnoteNumber,
    ),
  }),
);

export const contributors = sqliteTable(
  "contributors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["contributor", "admin"] }).default(
      "contributor",
    ),
    passwordHash: text("password_hash"),
    oauthProvider: text("oauth_provider"),
    oauthId: text("oauth_id"),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  },
  (table) => {
    return {
      emailIdx: index("idx_contributors_email").on(table.email),
      oauthIdx: index("idx_contributors_oauth").on(
        table.oauthProvider,
        table.oauthId,
      ),
    };
  },
);

export const quranTranslations = sqliteTable(
  "quran_translations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    surahNumber: integer("surah_number").notNull(),
    verseNumber: integer("verse_number").notNull(),
    content: text("content").notNull(),
    isVerified: integer("is_verified", { mode: "boolean" }).default(false),
    lastUpdated: integer("last_updated", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (table) => {
    return {
      uniqueIdx: uniqueIndex("idx_qt_unique").on(
        table.surahNumber,
        table.verseNumber,
      ),
      surahIdx: index("surah_idx").on(table.surahNumber),
    };
  },
);

export const contributions = sqliteTable("contributions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  translationId: integer("translation_id").references(
    () => quranTranslations.id,
  ),
  suggestedTranslation: text("suggested_translation").notNull(),
  contributorName: text("contributor_name").notNull(),
  contributorId: integer("contributor_id").references(() => contributors.id),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).default(
    "pending",
  ),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
  sourceId: integer("source_id").references(() => translationSources.id),
  verseTranslationId: integer("verse_translation_id").references(
    () => verseTranslations.id,
  ),
});

export const issueReports = sqliteTable(
  "issue_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    translationId: integer("translation_id").references(
      () => quranTranslations.id,
    ),
    fingerprint: text("fingerprint").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (table) => {
    return {
      translationIdx: index("idx_reports_translation_id").on(
        table.translationId,
      ),
    };
  },
);

export const wordTranslations = sqliteTable(
  "word_translations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    surahNumber: integer("surah_number").notNull(),
    verseNumber: integer("verse_number").notNull(),
    wordPosition: integer("word_position").notNull(),
    arabicText: text("arabic_text").notNull(),
    thaiMeaning: text("thai_meaning").notNull(),
    contributorId: integer("contributor_id").references(() => contributors.id),
    status: text("status", {
      enum: ["pending", "approved", "rejected"],
    }).default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (table) => {
    return {
      verseIdx: index("idx_word_translations_verse").on(
        table.surahNumber,
        table.verseNumber,
      ),
      uniqueIdx: index("idx_word_translations_unique").on(
        table.surahNumber,
        table.verseNumber,
        table.wordPosition,
        table.contributorId,
      ),
    };
  },
);

export const changelog = sqliteTable("changelog", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  translationId: integer("translation_id").references(
    () => quranTranslations.id,
  ),
  oldText: text("old_text").notNull(),
  newText: text("new_text").notNull(),
  versionTag: text("version_tag").notNull(),
  changedAt: integer("changed_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});
