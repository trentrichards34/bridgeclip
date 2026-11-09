/**
 * Color grade: one look for the footage only (never the graphics, captions or text). The engine applies it as an
 * FFmpeg filter on the video layer before anything is drawn over it (engine color_grade.py, the same ids); screens
 * here show a CSS filter that comes close.
 */
export const COLOR_GRADES = ['none', 'warm', 'cinematic', 'film', 'cool', 'mono'] as const
export type ColorGrade = (typeof COLOR_GRADES)[number]
export const DEFAULT_COLOR_GRADE: ColorGrade = 'none'

export const COLOR_GRADE_INFO: Record<ColorGrade, { label: string; detail: string; css: string }> = {
  none: { label: 'None', detail: 'Your footage as filmed.', css: 'none' },
  warm: { label: 'Warm', detail: 'A little warmer and richer, like late sun.', css: 'sepia(0.18) saturate(1.12)' },
  cinematic: { label: 'Cinematic', detail: 'Warm skin, cool shadows and more contrast.', css: 'contrast(1.1) saturate(0.92) hue-rotate(-6deg)' },
  film: { label: 'Film', detail: 'Soft contrast and muted color, like film.', css: 'contrast(0.92) saturate(0.82) sepia(0.12) brightness(1.03)' },
  cool: { label: 'Cool', detail: 'A little cooler and cleaner.', css: 'saturate(0.96) hue-rotate(8deg) brightness(1.02)' },
  mono: { label: 'Mono', detail: 'Black and white.', css: 'grayscale(1) contrast(1.06)' }
}

export function isColorGrade(value: unknown): value is ColorGrade {
  return typeof value === 'string' && (COLOR_GRADES as readonly string[]).includes(value)
}

/** The CSS filter that previews a grade on a video element (undefined for none). */
export function gradePreviewFilter(grade: ColorGrade | undefined | null): string | undefined {
  return grade && grade !== 'none' ? COLOR_GRADE_INFO[grade].css : undefined
}
