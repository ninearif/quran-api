// Per-ayah clip generation (source of truth). See README.md.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, parseSurahs, loadSnapshot, setDir, sha256, ffprobeDurationMs } from './common.mjs'
import { normalizeForSpeech } from './normalize.mjs'
import { createSayProvider, createElevenLabsProvider } from './providers.mjs'
import { ELEVENLABS_DEFAULTS } from './config.mjs'

const args = parseArgs()
const setId = args.set
if (!setId || setId === true) throw new Error('--set <setId> is required')
// --ayahs 2:37,23:56 adds single ayahs on top of --surahs (useful for auditions)
const extraAyahs = new Set(args.ayahs && args.ayahs !== true ? String(args.ayahs).split(',').map((k) => k.trim()) : [])
const surahs = args.surahs && args.surahs !== true ? parseSurahs(args.surahs) : []
const clipsDir = path.join(setDir(setId), 'clips')

const el = ELEVENLABS_DEFAULTS
const settings = {
  stability: Number(args.stability ?? el.settings.stability),
  similarity_boost: Number(args.similarity ?? el.settings.similarity_boost),
}

const provider =
  args.provider === 'say'
    ? createSayProvider({ rate: Number(args.rate ?? 180), clipsDir })
    : args.provider === 'elevenlabs'
      ? createElevenLabsProvider({
          voiceId: args.voice ?? el.voiceId,
          model: args.model ?? el.model,
          seed: Number(args.seed ?? el.seed),
          settings,
          outputFormat: args.format ?? el.outputFormat,
          clipsDir,
        })
      : (() => { throw new Error('--provider say|elevenlabs is required') })()

const hashOf = (normalizedText) =>
  sha256([normalizedText, provider.name, provider.model, provider.voiceId, JSON.stringify(provider.settings), provider.seed].join('\n'))

async function existingHash(surah, ayah) {
  try {
    return JSON.parse(await readFile(path.join(clipsDir, String(surah), `${ayah}.json`), 'utf8')).textHash
  } catch { return null }
}

const { ayahs } = await loadSnapshot()
const wanted = new Set(surahs)
const todo = []
const perSurah = new Map()
for (const a of ayahs) {
  if (!wanted.has(a.surah) && !extraAyahs.has(`${a.surah}:${a.ayah}`)) continue
  const normalizedText = normalizeForSpeech(a.text)
  const row = perSurah.get(a.surah) ?? { ayahs: 0, chars: 0, regen: 0, regenChars: 0 }
  row.ayahs++
  row.chars += normalizedText.length
  perSurah.set(a.surah, row)
  if (!normalizedText) continue
  const textHash = hashOf(normalizedText)
  if (!args.force && (await existingHash(a.surah, a.ayah)) === textHash) continue
  row.regen++
  row.regenChars += normalizedText.length
  todo.push({ ...a, normalizedText, textHash })
}

const maxChars = args['max-chars'] ? Number(args['max-chars']) : Infinity
let spent = 0
const batch = []
for (const t of todo) {
  if (spent + t.normalizedText.length > maxChars) break
  spent += t.normalizedText.length
  batch.push(t)
}

if (args['dry-run']) {
  for (const [s, r] of perSurah) console.log(`surah ${s}: ${r.ayahs} ayahs, ${r.chars} chars, ${r.regen} to generate (${r.regenChars} chars)`)
  const totalChars = [...perSurah.values()].reduce((n, r) => n + r.chars, 0)
  console.log(`total: ${totalChars} chars; to generate: ${todo.length} clips, ${todo.reduce((n, t) => n + t.normalizedText.length, 0)} chars`)
  if (batch.length < todo.length) console.log(`--max-chars ${maxChars} would stop after ${batch.length} clips (${spent} chars)`)
  console.log(`estimated cost for this run: $${(spent * 0.08 / 1000).toFixed(2)} at $0.08/1K, $${(spent * 0.04 / 1000).toFixed(2)} at $0.04/1K`)
  process.exit(0)
}

if (provider.name === 'elevenlabs' && (!provider.model || !provider.voiceId)) {
  console.error('A real elevenlabs run needs --model <model_id> and --voice <voice_id> (list them with the voices command).')
  process.exit(1)
}
if (provider.name === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) {
  console.error('ELEVENLABS_API_KEY is missing. Put it in .dev.vars and run: node --env-file=.dev.vars generate.mjs ...')
  process.exit(1)
}

console.log(`${batch.length} clips to generate (${spent} chars)${batch.length < todo.length ? `, stopped by --max-chars ${maxChars}` : ''}`)

// A clip being regenerated is moved to clips/<surah>/archive/ first, so earlier audio is never lost
async function archivePrevious(t) {
  const dir = path.join(clipsDir, String(t.surah))
  let stamp
  try {
    stamp = JSON.parse(await readFile(path.join(dir, `${t.ayah}.json`), 'utf8')).createdAt.replace(/[:.]/g, '-')
  } catch { return }
  const archiveDir = path.join(dir, 'archive')
  await mkdir(archiveDir, { recursive: true })
  for (const ext of ['mp3', 'json', 'alignment.json']) {
    await rename(path.join(dir, `${t.ayah}.${ext}`), path.join(archiveDir, `${t.ayah}.${stamp}.${ext}`)).catch(() => {})
  }
}

async function generateOne(t) {
  await archivePrevious(t)
  const { mp3Path, request } = await provider.synthesize({ text: t.normalizedText, ayahKey: `${t.surah}/${t.ayah}` })
  const meta = {
    surah: t.surah, ayah: t.ayah, text: t.text, normalizedText: t.normalizedText, textHash: t.textHash,
    provider: provider.name, model: provider.model, voiceId: provider.voiceId,
    settings: provider.settings, seed: provider.seed,
    requestId: request.requestId ?? null, characterCount: request.characterCount ?? null,
    durationMs: await ffprobeDurationMs(mp3Path), createdAt: new Date().toISOString(),
  }
  await writeFile(path.join(clipsDir, String(t.surah), `${t.ayah}.json`), JSON.stringify(meta, null, 2))
}

await mkdir(clipsDir, { recursive: true })
const concurrency = provider.name === 'say' ? 1 : Number(args.concurrency ?? 3)
let next = 0, done = 0
const failures = []
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < batch.length) {
    const t = batch[next++]
    try { await generateOne(t); done++ } catch (err) { failures.push(`${t.surah}:${t.ayah} ${err.message}`) }
    if ((done + failures.length) % 25 === 0) console.log(`  ${done + failures.length}/${batch.length}`)
  }
}))
console.log(`generated ${done}, failed ${failures.length}`)
failures.forEach((f) => console.error('  FAILED ' + f))
if (failures.length) process.exit(1)
