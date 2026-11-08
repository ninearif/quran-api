// Uploads measured pause files to R2 under recitation-pauses/<set>/<reciterId>/<chapter>.json.
// Local by default; production needs --remote --i-have-approval.
//
//   node scripts/recitation-pauses/upload.mjs --remote --i-have-approval   # only what changed
//   [--set v1] [--reciters 1012,1043] [--surahs 1,101] [--force] [--concurrency 6] [--dry-run]
//
// Safe to re-run: a file is uploaded only when its content differs from the last successful
// upload to the same target (local or remote), tracked in <set>/.uploaded-<target>.json.
// That record is saved after every upload, so an interrupted run resumes where it stopped.
// --force uploads everything selected regardless.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, parseSurahs, run, sha256, DATA_DIR } from '../translation-audio/common.mjs'

const args = parseArgs()
const setId = args.set && args.set !== true ? args.set : 'v1'
const remote = Boolean(args.remote)
if (remote && !args['i-have-approval']) throw new Error('--remote requires --i-have-approval')
const concurrency = Math.max(1, Number(args.concurrency) || 6)

const BUCKET = 'quran-assets'
const PREFIX = 'recitation-pauses'
const root = path.join(DATA_DIR, PREFIX, setId)
const target = remote ? 'remote' : 'local'
const recordFile = path.join(root, `.uploaded-${target}.json`)
const record = JSON.parse(await readFile(recordFile, 'utf8').catch(() => '{}'))

const reciterIds = args.reciters && args.reciters !== true
  ? String(args.reciters).split(',')
  : (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
const surahFilter = args.surahs && args.surahs !== true ? new Set(parseSurahs(args.surahs)) : null

const pending = []
let unchanged = 0
for (const reciterId of reciterIds) {
  const dir = path.join(root, reciterId)
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^\d+\.json$/.test(f))
  for (const f of files) {
    const chapter = Number(f.slice(0, -5))
    if (surahFilter && !surahFilter.has(chapter)) continue
    const file = path.join(dir, f)
    const hash = sha256(await readFile(file))
    const key = `${PREFIX}/${setId}/${reciterId}/${chapter}.json`
    if (!args.force && record[key] === hash) unchanged++
    else pending.push({ key, file, hash })
  }
}
console.log(`${target}: ${pending.length} to upload, ${unchanged} unchanged since last upload`)
if (args['dry-run']) process.exit(0)

let saving = Promise.resolve()
const saveRecord = () => {
  saving = saving.then(() => writeFile(recordFile, JSON.stringify(record, null, 1)))
  return saving
}

const failures = []
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let item = pending.shift(); item; item = pending.shift()) {
    try {
      // Wrangler 3 writes to the real bucket unless told --local; it has no --remote flag
      await run('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${item.key}`, ...(remote ? [] : ['--local']), '--file', item.file, '--content-type', 'application/json'])
      record[item.key] = item.hash
      await saveRecord()
      console.log(`${target} ${item.key}`)
    } catch (e) {
      failures.push(item.key)
      console.error(`${item.key}: FAILED ${e.message.split('\n')[0]}`)
    }
  }
}))
await saving
if (failures.length) {
  console.log(`${failures.length} failed (re-run to retry):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
