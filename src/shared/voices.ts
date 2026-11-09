/** Voices shared by Avatar Studio and Remix. */

/**
 * ElevenLabs v3 voices OpenRouter lists for elevenlabs/eleven-v3 (its
 * supported_voices are lower case; ids here are display names).
 */
export const PRESET_VOICES = [
  { id: 'Brian', label: 'Brian', hint: 'Deep, narrator' },
  { id: 'Adam', label: 'Adam', hint: 'Deep, confident' },
  { id: 'Charlie', label: 'Charlie', hint: 'Natural, Australian' },
  { id: 'George', label: 'George', hint: 'Warm, British' },
  { id: 'Daniel', label: 'Daniel', hint: 'Authoritative, British' },
  { id: 'Eric', label: 'Eric', hint: 'Friendly, smooth' },
  { id: 'Chris', label: 'Chris', hint: 'Casual, natural' },
  { id: 'Liam', label: 'Liam', hint: 'Young, energetic' },
  { id: 'Harry', label: 'Harry', hint: 'Animated, energetic' },
  { id: 'Will', label: 'Will', hint: 'Relaxed, friendly' },
  { id: 'Callum', label: 'Callum', hint: 'Intense, gravelly' },
  { id: 'Roger', label: 'Roger', hint: 'Laid-back' },
  { id: 'Bill', label: 'Bill', hint: 'Older, trustworthy' },
  { id: 'Sarah', label: 'Sarah', hint: 'Soft, reassuring' },
  { id: 'Jessica', label: 'Jessica', hint: 'Expressive, upbeat' },
  { id: 'Laura', label: 'Laura', hint: 'Bright, quirky' },
  { id: 'Bella', label: 'Bella', hint: 'Bright, warm' },
  { id: 'Alice', label: 'Alice', hint: 'Clear, British' },
  { id: 'Matilda', label: 'Matilda', hint: 'Warm, friendly' },
  { id: 'Lily', label: 'Lily', hint: 'Warm, British' },
  { id: 'River', label: 'River', hint: 'Calm, neutral' }
] as const
export const PRESET_VOICE_IDS: readonly string[] = PRESET_VOICES.map((voice) => voice.id)
