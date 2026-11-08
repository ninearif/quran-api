# Thai translation audio pipeline

Per-ayah clips (source of truth) -> one mp3 + manifest per surah -> R2.
Nothing generated is committed: `scripts/data/translation-audio/` and
`scripts/data/mukhtasar-th-snapshot.json` are git-ignored.

Run from `quran-api/`. Commands in order:

```bash
# 1. Text snapshot (read-only against production, 50 ayahs per request, sequential)
node scripts/translation-audio/snapshot.mjs

# 2. Normalization report (what gets sent to TTS)
node scripts/translation-audio/normalize.mjs

# 3. Dry run: characters, clips to (re)generate, cost at $0.08 and $0.04 per 1K chars
node scripts/translation-audio/generate.mjs --provider elevenlabs --set v1 --surahs 1,78-114 --dry-run

# 4. Generate clips
node scripts/translation-audio/generate.mjs --provider say --set placeholder-kanya --surahs 1,112     # [--rate 180]
# Voice, model, settings and format default to config.mjs; flags override them
node --env-file=.dev.vars scripts/translation-audio/generate.mjs --provider elevenlabs \
  --set v1 --surahs 1,78-114 [--ayahs 2:255 --voice <id> --model <model_id> --stability 0.5 --similarity 0.96 \
  --format mp3_44100_128 --seed 1 --concurrency 3 --max-chars 50000 --force]

# 5. Stitch into surah mp3 + manifest + index
node scripts/translation-audio/build.mjs --set placeholder-kanya --surahs 1,112 [--lead-ms 250 --gap-ms 0 --allow-missing]

# 6. Upload to LOCAL R2 (bucket quran-assets)
node scripts/translation-audio/upload.mjs --set placeholder-kanya [--surahs 1,112] [--make-current]
# Production: only with both flags, after approval
node scripts/translation-audio/upload.mjs --set v1 --remote --i-have-approval [--make-current]

# 7. Verify what readers get: streams each surah like the player (API URL + range requests) and
#    checks every ayah starts on its lead-in silence. Run after every production upload.
node scripts/translation-audio/verify.mjs [--surahs 78,101]

# Voices and models (needs the key)
node --env-file=.dev.vars scripts/translation-audio/providers.mjs voices
```

## Text rules

`normalize.mjs` exports the pure function `normalizeForSpeech` and the ordered rule list `RULES`
(`node normalize.mjs --rules` prints it; `--show 2:37,1:1` prints before/after). The snapshot
text is never modified; only the text sent to TTS changes. Zero-width/control characters are
stripped first, then:

1. **arabic**: Remove Arabic-script runs and the brackets or quotes left empty around them (Thai transliterations stay).
2. **cross-reference**: Square-bracket references "[name:N]" are read out as ", ซูเราะฮฺname อายะฮฺที่ N, " with a pause on each side.
3. **numbers**: Ranges "55-56" become "55 ถึง 56"; a list numeral "1-(" or "1-word" becomes "1 " before the text. Other numbers stay as digits.
4. **parentheses**: Parentheses are dropped and their words read as part of the sentence, with no pause: "กล่าวเท็จ (ต่อเจ้า) และ" becomes "กล่าวเท็จต่อเจ้า และ". A number before "(" keeps a space.
5. **aside-dashes**: En dash or hyphen asides next to Thai letters (" –text- ") become ", ". Hyphens inside names and between digits are kept.
6. **quotes**: Quote characters (" “ ” ‘ ’ ') and the bullet • are dropped.
7. **stray-latin**: Latin letters stuck to Thai letters (source typos) are removed. Standalone Latin words are kept.
8. **pronunciation**: Words the voice mispronounces are swapped from the `PRONUNCIATIONS` list in `normalize.mjs`: "ญะฮันนัม" is sent as "Jahannam" (the Thai spelling came out as ญะ-หัน-นัม) and "สุญูด" as "สุหญูด" (low tone on the second syllable). Add a `[written, spoken]` pair for new cases, and test one clip before regenerating.
9. **cleanup**: Collapse whitespace and repeated commas, remove space before and stray leading or trailing commas, trim.

## Hash and resume

Each clip is `clips/<surah>/<ayah>.mp3` plus `.json` metadata. `textHash` is the sha256 of
normalizedText, provider, model, voiceId, JSON of settings and seed (newline separated).
A clip whose json already has the same hash is skipped, so runs are resumable and idempotent;
changing text, voice, model, settings or seed regenerates it. `--force` regenerates everything.
`--max-chars` stops before the budget would be exceeded. Failed clips are listed and exit code is 1;
rerun to continue.

## Build

Clips are decoded to mono 44.1 kHz PCM, each preceded by an exact-sample lead-in silence
(`--lead-ms`, default 250; `startMs` points at the lead so a late seek or a play() that drops
its first buffers still reaches the first syllable), optionally separated by `--gap-ms`, and
encoded once at mp3 64 kbps. Offsets come from decoded sample counts, and the final file is
ffprobed and compared with the computed length (drift is printed).
Missing clips fail the build unless `--allow-missing`.

## API key

`ELEVENLABS_API_KEY` lives in the git-ignored `.dev.vars`; scripts only read
`process.env.ELEVENLABS_API_KEY`, so run them with `node --env-file=.dev.vars`. The key is never
printed or written. `--dry-run` and the `say` provider do not need it; a real elevenlabs run
without it exits with a clear error before any request.
