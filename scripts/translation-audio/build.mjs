// Stitches a set's clips into one mp3 per surah plus a manifest with exact per-ayah offsets.
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseArgs, parseSurahs, loadSnapshot, setDir, run, ffprobeDurationMs } from './common.mjs'

const args = parseArgs()
const setId = args.set
if (!setId || setId === true) throw new Error('--set is required')
const surahs = parseSurahs(args.surahs)
// Silence before each clip. `startMs` points at its start, so a player that seeks a little
// late or drops the first buffers after play() (iOS) still reaches the first syllable.
const leadMs = Number(args['lead-ms'] ?? 250)
const gapMs = Number(args['gap-ms'] ?? 0)
const root = setDir(setId)
const { ayahs } = await loadSnapshot()
const SOURCE = 'mukhtasar-th'
const execFileP = promisify(execFile)

// Each clip is decoded to mono 44.1 kHz 16-bit PCM, so its length is an exact sample count.
// The pieces and silences are joined as PCM and encoded once (mp3 64 kbps), which avoids
// the per-file encoder padding that makes joined mp3 files drift from summed durations.
const RATE = 44100
const decode = async (file) => {
  const { stdout } = await execFileP('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { encoding: 'buffer', maxBuffer: 1 << 30 })
  return stdout
}
const silence = (ms) => { const samples = Math.round((ms * RATE) / 1000); return { samples, pcm: Buffer.alloc(samples * 2) } }
const lead = silence(leadMs)
const gap = silence(gapMs)
const msOf = (samples) => Math.round((samples * 1000) / RATE)

await mkdir(path.join(root, 'surahs'), { recursive: true })

const report = []
const missingAll = []
for (const surah of surahs) {
  const list = ayahs.filter((a) => a.surah === surah)
  const clipDir = path.join(root, 'clips', String(surah))
  const have = new Set((await readdir(clipDir).catch(() => [])).filter((f) => f.endsWith('.json')).map((f) => Number(f.slice(0, -5))))
  const missing = list.filter((a) => !have.has(a.ayah)).map((a) => `${surah}:${a.ayah}`)
  if (missing.length) {
    missingAll.push(...missing)
    if (!args['allow-missing']) continue
  }
  const present = list.filter((a) => have.has(a.ayah))
  if (!present.length) continue

  const chunks = []
  const entries = []
  let samples = 0
  let meta
  for (let i = 0; i < present.length; i++) {
    const a = present[i]
    const m = JSON.parse(await readFile(path.join(clipDir, `${a.ayah}.json`), 'utf8'))
    meta ??= m
    const pcm = await decode(path.join(clipDir, `${a.ayah}.mp3`))
    const start = samples
    chunks.push(lead.pcm, pcm)
    samples += lead.samples + pcm.length / 2
    entries.push({ ayah: a.ayah, startMs: msOf(start), endMs: msOf(samples), textHash: m.textHash })
    if (gap.samples && i < present.length - 1) { chunks.push(gap.pcm); samples += gap.samples }
  }
  const cursor = msOf(samples)
  const pcmFile = path.join(root, `.build-${surah}.pcm`)
  await writeFile(pcmFile, Buffer.concat(chunks))
  const out = path.join(root, 'surahs', `${surah}.mp3`)
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', pcmFile, '-c:a', 'libmp3lame', '-b:a', '64k', out])
  await rm(pcmFile, { force: true })
  const actual = await ffprobeDurationMs(out)
  report.push({ surah, expected: cursor, actual, drift: actual - cursor })

  const manifest = {
    source: SOURCE, set: setId, surah, provider: meta.provider, model: meta.model, voiceId: meta.voiceId,
    generatedAt: new Date().toISOString(),
    audioPath: `translation-audio/${SOURCE}/${setId}/${surah}.mp3`,
    durationMs: actual, ayahs: entries,
  }
  await writeFile(path.join(root, 'surahs', `${surah}.json`), JSON.stringify(manifest, null, 2))
  console.log(`surah ${surah}: ${entries.length} ayahs, ${actual} ms, drift ${actual - cursor} ms`)
}

if (missingAll.length) {
  const msg = `missing clips (${missingAll.length}): ${missingAll.join(', ')}`
  if (!args['allow-missing']) { console.error('FAILED, ' + msg + '\nUse --allow-missing to build anyway.'); process.exit(1) }
  console.warn('WARNING ' + msg)
}

// Index lists every surah that has a built manifest, not only this run's.
const built = (await readdir(path.join(root, 'surahs'))).filter((f) => f.endsWith('.json')).map((f) => Number(f.slice(0, -5))).sort((a, b) => a - b)
await writeFile(path.join(root, 'index.json'), JSON.stringify({ source: SOURCE, set: setId, surahs: built, updatedAt: new Date().toISOString() }, null, 2))
const maxDrift = Math.max(0, ...report.map((r) => Math.abs(r.drift)))
console.log(`built ${report.length} surahs, max |drift| ${maxDrift} ms, index surahs: ${built.join(',')}`)
