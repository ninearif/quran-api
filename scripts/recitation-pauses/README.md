# Recitation pauses

Measured silence at each ayah boundary of a reciter's recording. With Thai translation
audio on, the player uses it to tell a real stop from ayahs joined in one breath (waṣl). It
then plays the Arabic through a joined run and plays the Thai for each ayah in it at the next
real stop. Without a file, a reciter and surah keep the old timing-based stops.

## One command, any time

Run from `quran-api/`. ffmpeg must be on PATH.

```bash
npm run pauses:measure                 # every reciter x every surah with Thai audio
npm run pauses:upload -- --remote --i-have-approval
```

Both are safe to re-run and only do the work that is needed, so there is no list to keep.

| Situation                               | What `pauses:measure` does                                                  |
| --------------------------------------- | --------------------------------------------------------------------------- |
| New reciter added to `/reciters`        | Measures all its surahs (picked up from the live list)                      |
| Thai audio added for more surahs        | Measures them (default surahs come from the live Thai set's `current.json`) |
| Upstream audio URL or ayah list changed | Re-measures ("stale"); same test the API uses before serving a file         |
| Already measured and still matching     | Leaves it alone ("unchanged")                                               |
| Download or decode fails                | Retries twice, lists failures at the end, exits 1; re-run to finish         |
| Interrupted                             | Re-run; finished files are kept, a half-written file is measured again      |

`pauses:upload` sends only files whose content changed since the last successful upload to
the same target, recorded in `scripts/data/recitation-pauses/<set>/.uploaded-<local|remote>.json`.
That record is saved after each file, so an interrupted upload resumes. Without `--remote`, it
uploads to the local R2 used by `wrangler dev`.

## Options

`measure.mjs`:

- `--all`: all 114 surahs instead of the Thai set.
- `--surahs 1,78-114` and `--reciters 7,1012`: narrow the selection.
- `--force`: re-measure even when unchanged.
- `--api` (default `https://api.quran.in.th`) and `--assets` (default `https://assets.quran.in.th`).
- `--set v1`, `--concurrency 3`, `--retries 2`, `--keep-audio`. Downloaded mp3s are deleted after
  measuring unless `--keep-audio` (about 1.5 GB per reciter for all 114 surahs).

`upload.mjs`: `--dry-run`, `--force`, `--reciters`, `--surahs`, `--set`, `--concurrency 6`.

## How it measures

Each mp3 is decoded to mono 16 kHz. The level is read in dBFS over 30 ms windows every 10 ms.
The quiet threshold adapts per file: 20 dB under the speech level (p98), but at least 8 dB
above the noise floor (p5), clamped to −45..−20 dBFS. Both levels come from the recited span only,
not the silence around it, because reciters recorded with echo never get that quiet between ayahs
(Budair pauses at about −25 dB against speech at −14). Files record the `algo` version that measured
them; bumping `ALGO_VERSION` makes the next run re-measure older files.

- **Boundary:** for each boundary, the quiet run of at least 60 ms that contains the next ayah's
  `from`, else the nearest within ±500 ms.
- **Last entry:** the quiet after the last ayah, because mp3quran's last `to` can sit seconds
  before the voice ends.
- **Output:** `<set>/<reciterId>/<chapter>.json` with `audioUrl`, `verses` (playback order) and
  `pauses: [startMs, endMs][]`, where `pauses.length === verses.length`.
- **Head:** `head: [startMs, endMs] | null` is the quiet just before ayah 1's voice: the quiet run
  containing its `from`, else the last one ending within 1 s before it. The player starts ayah 1
  inside it, because mp3quran's `from` can sit up to ~500 ms after the voice. Files measured before
  `head` existed get it added on the next run by decoding only the first seconds ("head added").

In the player (`quran-web` `recitationStore.ts`), a window under 300 ms means joined. A real
stop pauses 200 ms after the voice ends and resumes from the same point.

Generated data is git-ignored. R2 holds only the measured JSON, never the audio.
