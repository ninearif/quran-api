// Fetches the Thai Al-Mukhtasar text (sourceId=4) for all 114 surahs from production (read-only).
import { mkdir, writeFile } from 'node:fs/promises'
import { SNAPSHOT_PATH, DATA_DIR, sleep } from './common.mjs'

const API = 'https://api.quran.in.th'
const PAGE = 50 // production returns 500 above ~98; stay well below
const PAUSE_MS = 400

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt >= 5) throw new Error(`${url}: ${err.message}`)
      await sleep(1000 * 2 ** attempt)
    }
  }
}

const surahs = (await getJson(`${API}/surahs`)).data
const ayahs = []
for (const s of surahs) {
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await getJson(`${API}/surahs/${s.id}?sourceId=4&offset=${offset}&limit=${PAGE}`)
    for (const v of data.verses) ayahs.push({ surah: s.id, ayah: v.verseNumber, text: v.translation ?? '' })
    await sleep(PAUSE_MS)
    if (!data.pagination?.hasMore) break
  }
  process.stdout.write(`\rsurah ${s.id}/114`)
}
ayahs.sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)

await mkdir(DATA_DIR, { recursive: true })
const meta = { source: 'quran.in.th sourceId=4 (Thai Al-Mukhtasar)', fetchedAt: new Date().toISOString() }
await writeFile(SNAPSHOT_PATH, JSON.stringify({ meta, ayahs }))

const empties = ayahs.filter((a) => !a.text.trim()).length
const chars = ayahs.reduce((n, a) => n + a.text.length, 0)
const expected = surahs.reduce((n, s) => n + s.verses_count, 0)
console.log(`\nayahs=${ayahs.length} (surah list says ${expected}) empties=${empties} chars=${chars}`)
