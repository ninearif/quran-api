/**
 * Mokhtasr API client for fetching external translations.
 *
 * Used by the lazy revalidation flow: when a user opens a surah whose
 * external-source translations are stale (older than REVALIDATION_DAYS),
 * this service fetches fresh data from Mokhtasr and updates the DB.
 */

const MOKHTASR_BASE = "https://admin.mokhtasr.com/api/v1";

interface MokhtasrBookEntry {
  text: string;
  footnotes: string;
}

interface MokhtasrAyah {
  sura: number;
  aya: number;
  text: string;
  books: MokhtasrBookEntry[];
}

interface MokhtasrResponse {
  status: boolean;
  data: MokhtasrAyah[];
}

interface ExternalConfig {
  bookId: number;
  apiToken: string;
}

export interface FetchedVerse {
  surahNumber: number;
  verseNumber: number;
  translationText: string;
}

export function parseExternalConfig(
  json: string | null,
): ExternalConfig | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed.bookId && parsed.apiToken) return parsed as ExternalConfig;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a single ayah translation from Mokhtasr.
 */
async function fetchAyah(
  config: ExternalConfig,
  surah: number,
  ayah: number,
): Promise<FetchedVerse | null> {
  try {
    const url = `${MOKHTASR_BASE}/book-contents?books=${config.bookId}&sura=${surah}&aya=${ayah}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;

    const json = (await res.json()) as MokhtasrResponse;
    const item = json.data?.[0];
    const text = item?.books?.[0]?.text ?? "";
    if (!text) return null;

    return {
      surahNumber: surah,
      verseNumber: ayah,
      translationText: text,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch translations for a range of ayahs from Mokhtasr.
 * Uses limited concurrency to avoid rate limits.
 */
export async function fetchMokhtasrSurahVerses(
  config: ExternalConfig,
  surahNumber: number,
  verseNumbers: number[],
): Promise<FetchedVerse[]> {
  const CONCURRENCY = 3;
  const results: FetchedVerse[] = [];

  for (let i = 0; i < verseNumbers.length; i += CONCURRENCY) {
    const batch = verseNumbers.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map((v) => fetchAyah(config, surahNumber, v)),
    );
    for (const r of fetched) {
      if (r) results.push(r);
    }
  }

  return results;
}
