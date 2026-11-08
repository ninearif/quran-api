// Measures the quiet window at every ayah boundary of a reciter's surah mp3, so the
// player can tell a real stop from ayahs joined in one breath (waṣl). Timing data
// alone cannot: mp3quran `from` sits anywhere inside (or after) the pause and QDC
// word ends drift by hundreds of ms.
//
// Output: scripts/data/recitation-pauses/<set>/<reciterId>/<chapter>.json, one entry
// per boundary (verse i -> i+1): the longest quiet run within ±SEARCH_MS of the next
// ayah's `from`, as absolute [startMs, endMs] in the audio, plus a final entry for the
// quiet after the last ayah (so pauses.length === verses.length). The player treats a
// boundary shorter than its own minimum as joined. Needs ffmpeg on PATH.
//
//   node scripts/recitation-pauses/measure.mjs                 # every reciter, surahs with Thai audio
//   node scripts/recitation-pauses/measure.mjs --all           # every reciter, every surah
//   node scripts/recitation-pauses/measure.mjs --reciters 1012,1043 --surahs 1,101
//   [--api https://api.quran.in.th] [--assets https://assets.quran.in.th] [--set v1]
//   [--force] [--keep-audio] [--concurrency 3] [--retries 2]
//
// Safe to re-run at any time; it only does the work that is needed. Per reciter and surah:
// - no file yet                                   -> measured ("new")
// - file matches the live timings                 -> left alone ("unchanged")
// - audioUrl or ayah list changed upstream        -> measured again ("stale"), same test the API uses
// - --force                                       -> measured again
// Reciters come from the live /reciters list, so new reciters are picked up automatically.
// Default surahs are the ones in the live Thai translation audio set, so the coverage grows
// with it. Failures are retried, listed at the end, and make the exit code 1; re-run to finish.
// Downloaded mp3s are deleted after use unless --keep-audio (a full reciter is ~1.5 GB).
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { parseArgs, parseSurahs, sleep, DATA_DIR } from '../translation-audio/common.mjs'

const SAMPLE_RATE = 16000
const HOP_MS = 10
const WIN_MS = 30
// How far from the next ayah's `from` a quiet run may lie and still count as the boundary
const SEARCH_MS = 500
// Shorter quiet runs are word gaps, not candidates
const MIN_RUN_MS = 60
// Bump when the measuring changes; older files then count as stale and are measured again
const ALGO_VERSION = 2
// A quiet run this long after the last ayah's `to` counts as the end of the recitation
const TAIL_MIN_PAUSE_MS = 300
// Quiet = 20 dB under the speech level (p98), but at least 8 dB above the noise floor (p5),
// clamped so a nearly silent or heavily compressed file still gets a sane level
const SPEECH_DROP_DB = 20
const FLOOR_RISE_DB = 8
const THRESHOLD_RANGE_DB = [-45, -20]

const args = parseArgs()
const opt = (name, fallback) => (args[name] && args[name] !== true ? String(args[name]) : fallback)
// Production by default: the API only serves a file whose audioUrl and ayah list match its own live timings
const api = opt('api', 'https://api.quran.in.th').replace(/\/$/, '')
const assets = opt('assets', 'https://assets.quran.in.th').replace(/\/$/, '')
const setId = opt('set', 'v1')
const outRoot = path.join(DATA_DIR, 'recitation-pauses', setId)
const cacheRoot = path.join(DATA_DIR, 'recitation-pauses', 'audio-cache')
const concurrency = Math.max(1, Number(args.concurrency) || 3)
const retries = Math.max(0, Number(opt('retries', '2')))

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const body = await res.json()
  if (!body.success) throw new Error(`API error for ${url}: ${body.message}`)
  return body.data
}

async function exists(file) {
  return stat(file).then(() => true, () => false)
}

async function download(url, file) {
  if (await exists(file)) return
  await mkdir(path.dirname(file), { recursive: true })
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`)
  const tmp = `${file}.part`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  await rename(tmp, file)
}

/** Mono 16 kHz PCM as Int16Array. */
function decode(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'])
    const chunks = []
    let err = ''
    ff.stdout.on('data', (c) => chunks.push(c))
    ff.stderr.on('data', (c) => { err += c })
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err}`))
      const buf = Buffer.concat(chunks)
      resolve(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1))
    })
  })
}

/** dBFS of overlapping WIN_MS windows every HOP_MS. */
function levels(pcm) {
  const hop = (SAMPLE_RATE * HOP_MS) / 1000
  const win = (SAMPLE_RATE * WIN_MS) / 1000
  const n = Math.max(0, Math.floor((pcm.length - win) / hop) + 1)
  const db = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const off = i * hop
    for (let j = 0; j < win; j++) {
      const s = pcm[off + j] / 32768
      sum += s * s
    }
    db[i] = 20 * Math.log10(Math.sqrt(sum / win) + 1e-9)
  }
  return db
}

function percentile(values, p) {
  const sorted = Float32Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/**
 * Levels are taken from the recited span only. The silence before and after a recitation is
 * true silence, but reciters recorded with echo never get that quiet between ayahs, so a floor
 * that included it put the threshold below their real pauses (Budair: pauses at -25 dB).
 */
function quietThreshold(db, fromMs, toMs) {
  const span = db.subarray(Math.max(0, Math.floor(fromMs / HOP_MS)), Math.min(db.length, Math.ceil(toMs / HOP_MS)))
  const levels = span.length >= 100 ? span : db
  const floor = percentile(levels, 5)
  const speech = percentile(levels, 98)
  const [lo, hi] = THRESHOLD_RANGE_DB
  return { floor, speech, threshold: Math.min(hi, Math.max(lo, Math.max(speech - SPEECH_DROP_DB, floor + FLOOR_RISE_DB))) }
}

/** Quiet runs as [startMs, endMs], at least MIN_RUN_MS long. */
function quietRuns(db, threshold) {
  const runs = []
  let start = -1
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i] < threshold
    if (quiet && start < 0) start = i
    if (!quiet && start >= 0) {
      const s = start * HOP_MS
      const e = i * HOP_MS + WIN_MS - HOP_MS
      if (e - s >= MIN_RUN_MS) runs.push([s, e])
      start = -1
    }
  }
  return runs
}

/** The quiet run containing `from` (longest if several), else the nearest one within SEARCH_MS. */
function pauseNear(runs, from) {
  const near = runs.filter(([s, e]) => e > from - SEARCH_MS && s < from + SEARCH_MS)
  const containing = near.filter(([s, e]) => s <= from && from <= e)
  if (containing.length > 0) return containing.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
  if (near.length === 0) return [from, from]
  const dist = ([s, e]) => Math.min(Math.abs(s - from), Math.abs(e - from))
  return near.reduce((a, b) => (dist(b) < dist(a) ? b : a))
}

/** Same test the API applies before serving a file (loadRecitationPauses in src/index.ts). */
function matchesTimings(file, audioUrl, verseKeys) {
  return file.algo === ALGO_VERSION
    && file.audioUrl === audioUrl
    && Array.isArray(file.pauses) && file.pauses.length === verseKeys.length
    && Array.isArray(file.verses) && file.verses.length === verseKeys.length
    && file.verses.every((k, i) => k === verseKeys[i])
}

async function readExisting(out) {
  try {
    return JSON.parse(await readFile(out, 'utf8'))
  } catch {
    return null
  }
}

/** Returns [status, detail]; status is new, stale, forced or unchanged. */
async function measure(reciterId, chapter) {
  const out = path.join(outRoot, String(reciterId), `${chapter}.json`)
  const timings = await fetchJson(`${api}/recitations/${reciterId}/${chapter}/timings`)
  const verses = [...timings.verses].sort((a, b) => a.from - b.from)
  if (verses.length === 0 || !timings.audioUrl) throw new Error('timings have no audio or ayahs')
  const existing = await readExisting(out)
  if (existing && !args.force && matchesTimings(existing, timings.audioUrl, verses.map((v) => v.verseKey))) {
    return ['unchanged', '']
  }
  const status = !existing ? 'new' : args.force ? 'forced' : 'stale'
  const audioFile = path.join(cacheRoot, String(reciterId), `${chapter}.mp3`)
  // A kept mp3 is keyed by reciter and surah, not URL, so it may be the old recording
  if (status !== 'new') await rm(audioFile, { force: true })
  try {
    await download(timings.audioUrl, audioFile)
    return [status, await analyse(reciterId, chapter, timings, verses, audioFile, out)]
  } catch (e) {
    // A truncated download would otherwise be reused on the retry
    await rm(audioFile, { force: true })
    await rm(`${audioFile}.part`, { force: true })
    throw e
  }
}

async function analyse(reciterId, chapter, timings, verses, audioFile, out) {
  const db = levels(await decode(audioFile))
  const { floor, speech, threshold } = quietThreshold(db, verses[0].from, verses[verses.length - 1].to)
  const runs = quietRuns(db, threshold)
  const pauses = verses.slice(1).map((v) => pauseNear(runs, v.from))
  // Trailing entry: where the last ayah really ends. mp3quran's last `to` can sit seconds
  // before the sound stops, so when nothing quiet is near it, take the first real pause after it.
  const last = verses[verses.length - 1]
  const fileEnd = db.length * HOP_MS + WIN_MS - HOP_MS
  let tail = pauseNear(runs, last.to)
  if (tail[1] - tail[0] < TAIL_MIN_PAUSE_MS) {
    // A shorter quiet run still counts when it runs into the end of the file
    tail = runs.find(([s, e]) => s >= last.to && (e - s >= TAIL_MIN_PAUSE_MS || e >= fileEnd - HOP_MS)) ?? [fileEnd, fileEnd]
  }
  pauses.push(tail)
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify({
    reciterId,
    chapter,
    audioUrl: timings.audioUrl,
    algo: ALGO_VERSION,
    measuredAt: new Date().toISOString(),
    levelsDb: { floor: +floor.toFixed(1), speech: +speech.toFixed(1), threshold: +threshold.toFixed(1) },
    verses: verses.map((v) => v.verseKey),
    pauses,
  }))
  if (!args['keep-audio']) await rm(audioFile, { force: true })
  const boundaries = pauses.slice(0, -1)
  const joined = boundaries.filter(([s, e]) => e - s < 300).length
  return `${boundaries.length} boundaries, ${joined} under 300 ms, ends ${tail[0]} (to ${last.to})`
}

async function thaiAudioSurahs() {
  const res = await fetch(`${assets}/translation-audio/mukhtasar-th/current.json`)
  if (!res.ok) throw new Error(`${res.status} reading the Thai audio set; pass --surahs or --all`)
  const { surahs } = await res.json()
  if (!Array.isArray(surahs) || surahs.length === 0) throw new Error('Thai audio set lists no surahs; pass --surahs or --all')
  return surahs.map(Number).sort((a, b) => a - b)
}

const reciterIds = args.reciters && args.reciters !== true
  ? String(args.reciters).split(',').map(Number)
  : (await fetchJson(`${api}/reciters`)).map((r) => r.id)
const surahs = args.surahs && args.surahs !== true
  ? parseSurahs(args.surahs)
  : args.all ? parseSurahs('1-114') : await thaiAudioSurahs()
console.log(`${reciterIds.length} reciters x ${surahs.length} surahs (${args.surahs ? 'given' : args.all ? 'all' : 'with Thai audio'}), api ${api}`)

const jobs = reciterIds.flatMap((r) => surahs.map((s) => [r, s]))
const counts = { new: 0, stale: 0, forced: 0, unchanged: 0 }
const failures = []
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const [reciterId, chapter] = job
    for (let attempt = 0; ; attempt++) {
      try {
        const [status, detail] = await measure(reciterId, chapter)
        counts[status]++
        if (status !== 'unchanged') console.log(`${reciterId}/${chapter}: ${status}, ${detail}`)
        break
      } catch (e) {
        if (attempt < retries) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        failures.push(`${reciterId}/${chapter}: ${e.message}`)
        console.error(`${reciterId}/${chapter}: FAILED ${e.message}`)
        break
      }
    }
  }
}))
console.log(`done: ${counts.new} new, ${counts.stale} stale re-measured, ${counts.forced} forced, ${counts.unchanged} unchanged, ${failures.length} failed`)
if (failures.length) {
  console.log(`failed (re-run to retry):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
