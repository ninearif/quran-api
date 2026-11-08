// Text actually sent to text-to-speech. CLI: node normalize.mjs  -> report on the snapshot.
import { fileURLToPath } from 'node:url'
import { loadSnapshot } from './common.mjs'

// Zero-width and control characters are markup-like noise, never spoken.
const MARKUP_CHARS = /[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

const AR = '[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]'
const ARABIC_RUN = new RegExp(`${AR}+(?:\\s+${AR}+)*`, 'g')
// Arabic run (optionally bracketed or quoted) directly followed by a "meaning:" lead-in.
const ARABIC_THEN_MEANING = new RegExp(`[(\\[\\u201C"]?\\s*\\.*\\s*${AR}+(?:\\s+${AR}+)*\\s*[)\\]\\u201D"]?\\s*(?:หมาย)?ความว่า\\s*:`, 'g')
const THAI = '[\\u0E00-\\u0E7F]'
const QUOTES = /["\u201C\u201D'\u2018\u2019\u2022]/g

// Words the Thai spelling makes the voice mispronounce: [written, spoken]. Matched as substrings,
// since Thai has no spaces between words. Applied after the Arabic-script removal.
export const PRONUNCIATIONS = [
  ['ญะฮันนัม', ' Jahannam '],
]

// Spoken-text rules, applied in this order. The snapshot text is never modified.
export const RULES = [
  {
    id: 'arabic',
    description: 'Remove Arabic-script runs and the brackets or quotes left empty around them (Thai transliterations stay). Where the removed Arabic was directly followed by "ความว่า:" or "หมายความว่า:", that second lead-in is dropped too.',
    apply: (t) => t.replace(ARABIC_THEN_MEANING, ' ').replace(ARABIC_RUN, ' ').replace(/[(\[\u201C"]\s*\.*\s*[)\]\u201D"]/g, ' '),
  },
  {
    id: 'cross-reference',
    description: 'Square-bracket references "[name:N]" are read out as ", ซูเราะฮฺname อายะฮฺที่ N, " with a pause on each side.',
    apply: (t) => t.replace(/\[\s*([^\]:\[]+?)\s*:\s*(\d+)\s*\]/g, ', ซูเราะฮฺ$1 อายะฮฺที่ $2, '),
  },
  {
    id: 'numbers',
    description: 'Ranges "55-56" become "55 ถึง 56"; a list numeral "1-(" or "1-word" becomes "1 " before the text. Other numbers stay as digits.',
    apply: (t) => t.replace(/(\d+)\s*[-–]\s*(?=\d)/g, '$1 ถึง ').replace(/(?<!\d)(\d+)-(?=[(\u0E00-\u0E7F])/g, '$1 '),
  },
  {
    id: 'parentheses',
    // Mukhtasar's parentheses mostly hold words added to clarify the sentence, so they are read straight through
    description: 'Parentheses are dropped and their words read as part of the sentence, with no pause: "กล่าวเท็จ (ต่อเจ้า) และ" becomes "กล่าวเท็จต่อเจ้า และ". A number before "(" keeps a space.',
    apply: (t) => t.replace(/(?<=\d)\s*\(\s*/g, ' ').replace(/\s*\(\s*/g, '').replace(/\s*\)/g, ''),
  },
  {
    id: 'aside-dashes',
    description: 'En dash or hyphen asides next to Thai letters (" –text- ") become ", ". Hyphens inside names and between digits are kept.',
    apply: (t) => t.replace(new RegExp(`\\s[–-](?=${THAI})`, 'g'), ', ').replace(new RegExp(`(?<=${THAI})[–-](?=\\s|$)`, 'g'), ', '),
  },
  {
    id: 'quotes',
    description: 'Quote characters (" \u201C \u201D \u2018 \u2019 \') and the bullet \u2022 are dropped.',
    apply: (t) => t.replace(QUOTES, ' '),
  },
  {
    id: 'stray-latin',
    description: 'Latin letters stuck to Thai letters (source typos) are removed. Standalone Latin words are kept.',
    apply: (t) => t.replace(new RegExp(`(?<=${THAI})[A-Za-z]+|[A-Za-z]+(?=${THAI})`, 'g'), ''),
  },
  {
    id: 'pronunciation',
    description: 'Words the voice mispronounces in Thai spelling are swapped from the PRONUNCIATIONS list: "ญะฮันนัม" is read as "Jahannam" (the Thai spelling came out with the wrong tone, ญะ-หัน-นัม).',
    apply: (t) => PRONUNCIATIONS.reduce((s, [written, spoken]) => s.replaceAll(written, spoken), t),
  },
  {
    id: 'cleanup',
    description: 'Collapse whitespace and repeated commas, remove space before and stray leading or trailing commas, trim.',
    apply: (t) =>
      t
        .replace(/\s+/g, ' ')
        .replace(/(?:\s*,)+/g, ',')
        .replace(/([:;.!?\u0E2F\u0E46]),/g, '$1')
        .replace(/,(?=[.!?:;])/g, '')
        .replace(/\s+(?=[!?.,])/g, '')
        .replace(/,(?=\S)/g, ', ')
        .replace(/^[\s,]+|[\s,]+$/g, ''),
  },
]

export function normalizeForSpeech(text) {
  return RULES.reduce((t, rule) => rule.apply(t), String(text ?? '').replace(MARKUP_CHARS, ''))
}

const KINDS = {
  'parentheses ()': /[()]/,
  'square brackets []': /[\[\]]/,
  'ornate parens ﴾﴿': /[﴾﴿]/,
  'guillemets «»': /[«»]/,
  'quotes " “”': /["“”]/,
  "quotes ' ‘’": /['‘’]/,
  'Arabic-script chars': /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/,
  'digits (ASCII)': /[0-9]/,
  'digits (Thai/Arabic-Indic)': /[๐-๙٠-٩۰-۹]/,
  'Latin letters': /[A-Za-z]/,
  'ellipsis …': /…/,
}
// Anything outside Thai, ASCII punctuation/space, and the kinds above.
const KNOWN = /[฀-๿ -~«»‘’“”…؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿٠-٩۰-۹]/
const UNUSUAL = /[^฀-๿ -~«»‘’“”…؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿٠-٩۰-۹]/gu

function snippet(text, index, len) {
  const s = Math.max(0, index - 40)
  return '...' + text.slice(s, index + len + 40).replace(/\n/g, '\\n') + '...'
}

const TAKE = { 'parentheses ()': 4, 'quotes " \u201C\u201D': 4, 'Arabic-script chars': 4, 'digits (ASCII)': 4, 'Latin letters': 2 }

function report(ayahs) {
  console.log(`ayahs: ${ayahs.length}`)
  console.log('\nAyahs containing each kind:')
  const examples = {}
  for (const [name, re] of Object.entries(KINDS)) {
    const hits = ayahs.filter((a) => re.test(a.text))
    examples[name] = hits
    console.log(`  ${name.padEnd(30)} ${hits.length}`)
  }
  const odd = new Map()
  const oddAyahs = []
  for (const a of ayahs) {
    const m = [...a.text.matchAll(UNUSUAL)]
    if (m.length) oddAyahs.push({ a, m })
    for (const x of m) odd.set(x[0], (odd.get(x[0]) ?? 0) + 1)
  }
  console.log(`  ${'other unusual symbols'.padEnd(30)} ${oddAyahs.length}`)
  if (odd.size) {
    console.log('\nUnusual symbols (char U+code count):')
    for (const [ch, n] of odd) console.log(`  ${JSON.stringify(ch)} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} x${n}`)
  }

  console.log('\nExamples (surah:ayah, +-40 chars of context):')
  let total = 0
  for (const [name, hits] of Object.entries(examples)) {
    // Spread picks across the list; more for the common kinds.
    const take = Math.min(hits.length, TAKE[name] ?? 3)
    for (let i = 0; i < take; i++) {
      const a = hits[Math.floor((i * hits.length) / take)]
      const re = new RegExp(KINDS[name].source, 'u')
      const m = re.exec(a.text)
      console.log(`  [${name}] ${a.surah}:${a.ayah}  ${snippet(a.text, m.index, m[0].length)}`)
      total++
    }
  }
  const seen = new Set()
  for (const { a, m } of oddAyahs) {
    if (seen.has(m[0][0]) && seen.size >= 2) continue
    seen.add(m[0][0])
    console.log(`  [unusual ${m[0][0]}] ${a.surah}:${a.ayah}  ${snippet(a.text, m[0].index, 1)}`)
    total++
  }
  console.log(`(${total} examples)`)
  const changed = ayahs.filter((a) => normalizeForSpeech(a.text) !== a.text).length
  console.log(`\nAyahs changed by current normalizeForSpeech: ${changed}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ayahs } = await loadSnapshot()
  const flag = process.argv[2]
  if (flag === '--rules') RULES.forEach((r, i) => console.log(`${i + 1}. ${r.id}: ${r.description}`))
  else if (flag === '--show') {
    // --show 1:1,2:240 prints before/after for each ayah
    for (const key of (process.argv[3] ?? '').split(',')) {
      const [surah, ayah] = key.split(':').map(Number)
      const a = ayahs.find((x) => x.surah === surah && x.ayah === ayah)
      if (!a) { console.log(`${key}: not found`); continue }
      const out = normalizeForSpeech(a.text)
      // Show only the span that differs, with 40 characters of context.
      let i = 0
      while (i < a.text.length && a.text[i] === out[i]) i++
      let j = 0
      while (j < a.text.length - i && j < out.length - i && a.text[a.text.length - 1 - j] === out[out.length - 1 - j]) j++
      const trim = (t) => (t.length > 260 ? `${t.slice(0, 120)} [...] ${t.slice(-120)}` : t)
      const cut = (t) => trim((i > 40 ? '...' : '') + t.slice(Math.max(0, i - 40), t.length - j + Math.min(40, j)) + (j > 40 ? '...' : ''))
      console.log(`${key}\n  before: ${cut(a.text)}\n  after:  ${cut(out)}`)
    }
  } else report(ayahs)
}
