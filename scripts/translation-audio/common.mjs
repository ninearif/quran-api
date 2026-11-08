import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const run = promisify(execFile)
export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
export const SNAPSHOT_PATH = path.join(DATA_DIR, 'mukhtasar-th-snapshot.json')
export const setDir = (setId) => path.join(DATA_DIR, 'translation-audio', setId)
export const sha256 = (s) => createHash('sha256').update(s).digest('hex')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { out._.push(argv[i]); continue }
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

// "1,18,78-114" -> [1, 18, 78, ..., 114]
export function parseSurahs(list) {
  if (!list || list === true) throw new Error('--surahs is required, e.g. 1,18,78-114')
  const set = new Set()
  for (const part of String(list).split(',')) {
    const [a, b = a] = part.split('-').map(Number)
    if (!(a >= 1 && b <= 114 && a <= b)) throw new Error(`Bad surah list entry: ${part}`)
    for (let n = a; n <= b; n++) set.add(n)
  }
  return [...set].sort((x, y) => x - y)
}

export async function loadSnapshot() {
  return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'))
}

export async function ffprobeDurationMs(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Math.round(parseFloat(stdout) * 1000)
}
