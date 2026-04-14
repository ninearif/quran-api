/**
 * Lazy revalidation for external translation sources.
 *
 * When a surah is requested and the translations for an external source
 * are missing, partial, or older than REVALIDATION_DAYS, this triggers
 * a background fetch from the external provider and upserts into the DB.
 *
 * Incremental by design: each run fetches only missing/stale verses so
 * large surahs that can't complete within a single waitUntil window
 * converge across multiple visits.
 */

import { parseExternalConfig, fetchMokhtasrSurahVerses } from "./mokhtasr";
import type { FetchedVerse } from "./mokhtasr";

interface SourceRow {
  id: number;
  externalType: string | null;
  externalConfig: string | null;
}

/**
 * Check if translations for a given source + surah need revalidation.
 * Returns true when coverage is partial (fewer rows than expectedCount)
 * or when the oldest row is older than revalidationDays.
 */
export async function needsRevalidation(
  db: D1Database,
  sourceId: number,
  surahNumber: number,
  expectedCount: number,
  revalidationDays: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT COUNT(*) as cnt, MIN(last_updated) as oldest
       FROM verse_translations
       WHERE source_id = ? AND surah_number = ?`,
    )
    .bind(sourceId, surahNumber)
    .first<{ cnt: number; oldest: number | null }>();

  const cnt = result?.cnt ?? 0;
  if (cnt < expectedCount) return true;

  if (revalidationDays <= 0) return false;
  const cutoff = Math.floor(Date.now() / 1000) - revalidationDays * 86400;
  return (result?.oldest ?? 0) < cutoff;
}

/**
 * Revalidate translations for a surah from its external source.
 *
 * Only fetches verses that are missing from the DB or whose last_updated
 * is older than the cutoff. This keeps each run cheap enough to finish
 * within the Worker's background-task budget on large surahs.
 */
export async function revalidateExternalSource(
  db: D1Database,
  source: SourceRow,
  surahNumber: number,
  expectedVerseNumbers: number[],
  revalidationDays: number,
): Promise<void> {
  if (source.externalType !== "mokhtasr") return;

  const config = parseExternalConfig(source.externalConfig);
  if (!config) return;

  const cutoff =
    revalidationDays > 0
      ? Math.floor(Date.now() / 1000) - revalidationDays * 86400
      : 0;

  const existing = await db
    .prepare(
      `SELECT verse_number, last_updated
       FROM verse_translations
       WHERE source_id = ? AND surah_number = ?`,
    )
    .bind(source.id, surahNumber)
    .all<{ verse_number: number; last_updated: number }>();

  const freshness = new Map<number, number>(
    (existing.results ?? []).map((r) => [r.verse_number, r.last_updated]),
  );

  const toFetch = expectedVerseNumbers.filter((v) => {
    const lu = freshness.get(v);
    if (lu === undefined) return true;
    return revalidationDays > 0 && lu < cutoff;
  });

  if (toFetch.length === 0) return;

  let verses: FetchedVerse[];
  try {
    verses = await fetchMokhtasrSurahVerses(config, surahNumber, toFetch);
  } catch {
    console.error(`Revalidation fetch failed for surah ${surahNumber}`);
    return;
  }

  if (verses.length === 0) return;

  const now = Math.floor(Date.now() / 1000);

  // Batch upsert — SQLite supports INSERT OR REPLACE.
  // D1 caps bound parameters at 100 per statement; 5 params/row → max 20 rows.
  const BATCH_SIZE = 16;
  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?, ?, ?, ?, 1, ?)").join(", ");
    const params = batch.flatMap((v) => [
      source.id,
      v.surahNumber,
      v.verseNumber,
      v.translationText,
      now,
    ]);

    try {
      await db
        .prepare(
          `INSERT OR REPLACE INTO verse_translations
           (source_id, surah_number, verse_number, translation_text, is_verified, last_updated)
           VALUES ${placeholders}`,
        )
        .bind(...params)
        .run();
    } catch (e) {
      console.error(`Revalidation upsert failed for surah ${surahNumber}:`, e);
    }
  }

  console.log(
    `Revalidated ${verses.length}/${toFetch.length} verses for surah ${surahNumber} (source ${source.id})`,
  );
}
