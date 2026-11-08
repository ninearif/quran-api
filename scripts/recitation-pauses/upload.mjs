// Uploads measured pause files to R2 under recitation-pauses/<set>/<reciterId>/<chapter>.json.
// Local by default; production needs --remote --i-have-approval.
//
//   node scripts/recitation-pauses/upload.mjs [--set v1] [--reciters 1012,1043] [--surahs 1,101]
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, parseSurahs, run, DATA_DIR } from '../translation-audio/common.mjs'

const args = parseArgs()
const setId = args.set && args.set !== true ? args.set : 'v1'
const remote = Boolean(args.remote)
if (remote && !args['i-have-approval']) throw new Error('--remote requires --i-have-approval')

const BUCKET = 'quran-assets'
const PREFIX = 'recitation-pauses'
const root = path.join(DATA_DIR, PREFIX, setId)
const reciterIds = args.reciters && args.reciters !== true
  ? String(args.reciters).split(',')
  : (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)

for (const reciterId of reciterIds) {
  const dir = path.join(root, reciterId)
  const chapters = args.surahs
    ? parseSurahs(args.surahs)
    : (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => Number(f.slice(0, -5))).sort((a, b) => a - b)
  for (const chapter of chapters) {
    const key = `${PREFIX}/${setId}/${reciterId}/${chapter}.json`
    // Wrangler 3 writes to the real bucket unless told --local; it has no --remote flag
    const target = remote ? [] : ['--local']
    await run('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, ...target, '--file', path.join(dir, `${chapter}.json`), '--content-type', 'application/json'])
    console.log(`${remote ? 'REMOTE' : 'local'} ${key}`)
  }
}
