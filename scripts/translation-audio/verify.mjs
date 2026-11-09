// Checks the translation audio as the player receives it: the URL and offsets from the API,
// the audio streamed with range requests (ffmpeg, like a browser's media element), so a stale
// edge cache shows up here exactly as it would for a reader.
//
//   node scripts/translation-audio/verify.mjs                  # every surah in the live set
//   node scripts/translation-audio/verify.mjs --surahs 78,101  [--api https://api.quran.in.th]
//
// Per surah: the decoded length must match durationMs, and every ayah's startMs must land on
// its lead-in silence (build.mjs --lead-ms). When the set is built locally, the timings are also
// checked against it: no clip may be newer than its surah's build, and the API's durationMs and
// every ayah's startMs/endMs must equal the local build's. Exit code 1 when any surah fails. Needs ffmpeg.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { parseArgs, parseSurahs, setDir } from './common.mjs'

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

const readJson = (file) => readFile(file, 'utf8').then(JSON.parse, () => null)

// A regenerated clip shifts every later ayah, so the build must postdate every clip and the
// API must serve exactly the build's offsets; otherwise readers get the old timings
async function timingProblems(chapter, data) {
  const local = await readJson(path.join(setDir(data.set), 'surahs', `${chapter}.json`))
  if (!local) return { problems: [], note: 'no local build, timing compare skipped' }
  const problems = []
  const builtAt = Date.parse(local.generatedAt)
  const newer = []
  for (const a of local.ayahs) {
    const clip = await readJson(path.join(setDir(data.set), 'clips', String(chapter), `${a.ayah}.json`))
    if (clip && Date.parse(clip.createdAt) > builtAt) newer.push(a.ayah)
  }
  if (newer.length) problems.push(`clips newer than the build (rebuild): ${newer.join(',')}`)
  if (data.durationMs !== local.durationMs) problems.push(`API durationMs ${data.durationMs} != local build ${local.durationMs}`)
  const byAyah = new Map(local.ayahs.map((a) => [a.ayah, a]))
  const differ = data.ayahs.filter((a) => { const l = byAyah.get(a.ayah); return !l || l.startMs !== a.startMs || l.endMs !== a.endMs }).map((a) => a.ayah)
  if (differ.length || data.ayahs.length !== local.ayahs.length) problems.push(`API timings differ from local build (upload?): ayahs ${differ.join(',') || 'count'}`)
  return { problems }
}

async function verify(chapter) {
  const { data } = await (await fetch(`${api}/translation-audio/${chapter}?t=${Date.now()}`)).json()
  const timing = await timingProblems(chapter, data)
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
  const ok = lengthOk && off.length === 0 && timing.problems.length === 0
  const extra = [...(off.length ? [`ayah starts off their lead-in: ${off.join(',')}`] : []), ...timing.problems, ...(timing.note ? [timing.note] : [])]
  return { ok, line: `${String(chapter).padStart(3)}: ${ok ? 'ok' : 'FAIL'} decoded ${decodedMs} ms, manifest ${data.durationMs} ms` + extra.map((e) => `, ${e}`).join('') }
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
