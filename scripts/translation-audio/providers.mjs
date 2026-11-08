// ayahKey is "<surah>/<ayah>"; clips land at <clipsDir>/<surah>/<ayah>.mp3.
// Two TTS providers, one interface:
//   synthesize({ text, ayahKey }) -> { mp3Path, alignment|null, request:{ ...settings, model, voiceId } }
import { mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { run, sleep } from './common.mjs'

export function createSayProvider({ voice = 'Kanya', rate = 170, clipsDir }) {
  const request = { voice, rate }
  return {
    name: 'say',
    model: 'macos-say',
    voiceId: voice,
    settings: { rate },
    seed: null,
    async synthesize({ text, ayahKey }) {
      const mp3Path = path.join(clipsDir, `${ayahKey}.mp3`)
      await mkdir(path.dirname(mp3Path), { recursive: true })
      const wav = path.join(os.tmpdir(), `say-${process.pid}-${ayahKey.replace(/\W/g, '_')}.wav`)
      await run('say', ['-v', voice, '-r', String(rate), '-o', wav, '--data-format=LEI16@22050', '--', text])
      await run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-ac', '1', '-ar', '44100', '-b:a', '64k', mp3Path])
      await rm(wav, { force: true })
      return { mp3Path, alignment: null, request: { ...request, model: 'macos-say', voiceId: voice } }
    },
  }
}

const EL_BASE = 'https://api.elevenlabs.io'

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY is missing. Put it in .dev.vars and run: node --env-file=.dev.vars ...')
  return key
}

async function elGet(pathAndQuery) {
  const res = await fetch(EL_BASE + pathAndQuery, { headers: { 'xi-api-key': apiKey() } })
  if (!res.ok) throw new Error(`GET ${pathAndQuery.split('?')[0]} -> HTTP ${res.status}`)
  return res.json()
}

// Source clips are kept at high quality; build.mjs re-encodes the surah files for delivery
export function createElevenLabsProvider({ voiceId, model = null, seed = 1, settings, outputFormat = 'mp3_44100_128', clipsDir }) {
  const voiceSettings = settings ?? { stability: 0.5, similarity_boost: 0.75 }
  return {
    name: 'elevenlabs',
    model,
    voiceId,
    settings: { ...voiceSettings, outputFormat },
    seed,
    async synthesize({ text, ayahKey }) {
      if (!model) throw new Error('--model <model_id> is required for the elevenlabs provider')
      if (!voiceId) throw new Error('--voice <voice_id> is required for the elevenlabs provider')
      const key = apiKey()
      const url = `${EL_BASE}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${outputFormat}`
      const body = JSON.stringify({ text, model_id: model, language_code: 'th', voice_settings: voiceSettings, seed })
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body })
        if (res.ok) {
          const json = await res.json()
          const mp3Path = path.join(clipsDir, `${ayahKey}.mp3`)
          await mkdir(path.dirname(mp3Path), { recursive: true })
          await writeFile(mp3Path, Buffer.from(json.audio_base64, 'base64'))
          const alignment = { alignment: json.alignment ?? null, normalized_alignment: json.normalized_alignment ?? null }
          await writeFile(path.join(clipsDir, `${ayahKey}.alignment.json`), JSON.stringify(alignment))
          return {
            mp3Path,
            alignment,
            request: {
              ...voiceSettings, model, voiceId, seed,
              requestId: res.headers.get('request-id'),
              characterCount: Number(res.headers.get('x-character-count')) || null,
            },
          }
        }
        const detail = await res.text().catch(() => '')
        const retryable = res.status === 429 || res.status >= 500
        if (!retryable || attempt >= 6) throw new Error(`ElevenLabs HTTP ${res.status} for ${ayahKey}: ${detail.slice(0, 200)}`)
        // Concurrency limits clear fast; a busy system needs longer.
        const kind = /too_many_concurrent_requests/.test(detail) ? 'concurrency' : /system_busy/.test(detail) ? 'busy' : 'other'
        const delay = (kind === 'concurrency' ? 1000 : 3000) * 2 ** attempt + Math.random() * 500
        console.warn(`  ${ayahKey}: HTTP ${res.status} (${kind}), retry in ${Math.round(delay)}ms`)
        await sleep(delay)
      }
    },
  }
}

export async function listModels() {
  const models = await elGet('/v1/models')
  for (const m of models) {
    const thai = (m.languages ?? []).some((l) => l.language_id === 'th' || /thai/i.test(l.name ?? ''))
    console.log(`${m.model_id}\t${m.name}\tthai=${thai}`)
  }
}

function printVoice(v) {
  console.log(`${v.voice_id}\t${v.name}\t${v.category ?? ''}\t${JSON.stringify(v.labels ?? {})}\t${v.preview_url ?? ''}`)
}

export async function listVoices() {
  console.log('# my voices (/v2/voices)')
  let token
  do {
    const page = await elGet(`/v2/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`)
    page.voices.forEach(printVoice)
    token = page.has_more ? page.next_page_token : null
  } while (token)
  console.log('\n# shared library, Thai (/v1/shared-voices)')
  const shared = await elGet('/v1/shared-voices?language=th&page_size=100')
  shared.voices.forEach((v) => printVoice({ ...v, voice_id: v.voice_id, labels: { accent: v.accent, gender: v.gender, age: v.age, use_case: v.use_case } }))
}

if (process.argv[2] === 'voices') {
  await listModels()
  console.log()
  await listVoices()
}
