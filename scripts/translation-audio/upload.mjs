// Uploads a built set to R2. Local by default; production needs --remote --i-have-approval.
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, parseSurahs, setDir, run } from './common.mjs'

const args = parseArgs()
const setId = args.set
if (!setId || setId === true) throw new Error('--set is required')
const remote = Boolean(args.remote)
if (remote && !args['i-have-approval']) throw new Error('--remote requires --i-have-approval')

const BUCKET = 'quran-assets'
const PREFIX = 'translation-audio/mukhtasar-th'
const root = setDir(setId)
const surahs = args.surahs
  ? parseSurahs(args.surahs)
  : (await readdir(path.join(root, 'surahs'))).filter((f) => f.endsWith('.json')).map((f) => Number(f.slice(0, -5))).sort((a, b) => a - b)

const put = async (key, file, contentType) => {
  // Wrangler 3 writes to the real bucket unless told --local; it has no --remote flag
  const target = remote ? [] : ['--local']
  await run('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, ...target, '--file', file, '--content-type', contentType])
  console.log(`${remote ? 'REMOTE' : 'local'} ${key}`)
}

for (const s of surahs) {
  await put(`${PREFIX}/${setId}/${s}.mp3`, path.join(root, 'surahs', `${s}.mp3`), 'audio/mpeg')
  await put(`${PREFIX}/${setId}/${s}.json`, path.join(root, 'surahs', `${s}.json`), 'application/json')
}
await put(`${PREFIX}/${setId}/index.json`, path.join(root, 'index.json'), 'application/json')
if (args['make-current']) await put(`${PREFIX}/current.json`, path.join(root, 'index.json'), 'application/json')
