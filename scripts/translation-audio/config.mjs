// Defaults for the ElevenLabs provider; any CLI flag overrides them.
// Changing a value changes every clip's hash, so the next run regenerates all clips.
export const ELEVENLABS_DEFAULTS = {
  // Oliver - Clean, British and Steady (chosen by the project owner, 2026-11-08)
  voiceId: 'L1aJrPa7pLJEyYlh3Ilq',
  model: 'eleven_v4_turbo',
  settings: { stability: 0.5, similarity_boost: 0.96 },
  outputFormat: 'mp3_44100_128',
  seed: 1,
}
