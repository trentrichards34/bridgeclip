/** Video types accepted for the gameplay background library. */
export const BACKGROUND_VIDEO_EXTENSIONS: readonly string[] = ['.mp4', '.mov', '.m4v', '.webm']

/**
 * A plain file name inside the background library: no folders, no dot-files,
 * a known video extension. Anything else could reach outside the library.
 */
export function isBackgroundVideoName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(value)) return false
  if (value.includes('..')) return false
  const dot = value.lastIndexOf('.')
  return dot > 0 && BACKGROUND_VIDEO_EXTENSIONS.includes(value.slice(dot).toLowerCase())
}
