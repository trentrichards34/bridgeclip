/**
 * Caption language for Create: the captions burned into each clip (and its
 * captions file) can be translated. The speech always stays as recorded.
 * Mirrors CAPTION_LANGUAGES in engine/clip_engine/services/caption_translation.py.
 */
export const CAPTION_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'it', label: 'Italian' },
  { id: 'hi', label: 'Hindi' },
  { id: 'ar', label: 'Arabic' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'zh', label: 'Chinese' }
] as const

export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number]['id']

/** "original" keeps the spoken language (no translation). */
export type CaptionLanguageChoice = 'original' | CaptionLanguage

export function isCaptionLanguage(value: unknown): value is CaptionLanguage {
  return typeof value === 'string' && CAPTION_LANGUAGES.some((language) => language.id === value)
}

export function captionLanguageLabel(value: unknown): string {
  return CAPTION_LANGUAGES.find((language) => language.id === value)?.label ?? 'Original'
}
