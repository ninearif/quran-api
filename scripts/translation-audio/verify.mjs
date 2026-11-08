// Checks the translation audio as the player receives it: the URL and offsets from the API,
// the audio streamed with range requests (ffmpeg, like a browser's media element), so a stale
// edge cache shows up here exactly as it would for a reader.
//
//   node scripts/translation-audio/verify.mjs                  # every surah in the live set
//   node scripts/translation-audio/verify.mjs --surahs 78,101  [--api https://api.quran.in.th]
//
// Per surah: the decoded length must match durationMs, and every ayah's startMs must land on
// its lead-in silence (build.mjs --lead-ms). Exit code 1 when any surah fails. Needs ffmpeg.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseArgs, parseSurahs } from './common.mjs'

const run = promisify(execFile)
const args = parseArgs()
const api = (args.api && args.api !== true ? String(args.api) : 'https://api.quran.in.th').replace(/\/$/, '')
// Lead-in is digital silence; speech sits around -20 dBFS
const LEAD_MAX_DB = -50
const LENGTH_TOLERANCE_MS = 30

async function surahList() {
  if (args.surahs && args.surahs !== true) return parseSurahs(args.surahs)
  const out = []
  for (let s = 1; s <= 114; s++) {
    const res = await fetch(`${api}/translation-audio/${s}`)
    if (res.ok) out.push(s)
  }
  return out
}

async function verify(chapter) {
  const { data } = await (await fetch(`${api}/translation-audio/${chapter}?t=${Date.now()}`)).json()
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', data.audioUrl, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 1 << 30 })
  const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, stdout.byteLength >> 1)
  const db = (m0, m1) => {
    let sum = 0, n = 0
    for (let i = Math.floor(m0 * 16); i < Math.min(pcm.length, m1 * 16); i++) { const x = pcm[i] / 32768; sum += x * x; n++ }
    return n ? 20 * Math.log10(Math.sqrt(sum / n) + 1e-9) : -200
  }
  const decodedMs = Math.floor(pcm.length / 16)
  const off = data.ayahs.filter((a) => db(a.startMs + 20, a.startMs + 200) > LEAD_MAX_DB).map((a) => a.ayah)
  const lengthOk = Math.abs(decodedMs - data.durationMs) <= LENGTH_TOLERANCE_MS
  const ok = lengthOk && off.length === 0
  return { ok, line: `${String(chapter).padStart(3)}: ${ok ? 'ok' : 'FAIL'} decoded ${decodedMs} ms, manifest ${data.durationMs} ms` + (off.length ? `, ayah starts off their lead-in: ${off.join(',')}` : '') }
}

const surahs = await surahList()
const results = []
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let s = surahs.shift(); s; s = surahs.shift()) {
    try { results.push([s, await verify(s)]) } catch (e) { results.push([s, { ok: false, line: `${String(s).padStart(3)}: FAIL ${e.message}` }]) }
  }
}))
results.sort((a, b) => a[0] - b[0])
for (const [, r] of results) if (!r.ok || args.verbose) console.log(r.line)
const failed = results.filter(([, r]) => !r.ok).length
console.log(`${results.length} surahs checked, ${failed} failed`)
if (failed) process.exit(1)
