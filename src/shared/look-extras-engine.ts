/**
 * Look extras on their way to the engine (Create, Remix, Edit my recording): the
 * request field checked in main, and the engine's `look_extras` fields.
 */
import { parseLookExtras, type LookExtraId } from './look-extras'
import { isHexColor, type HeadlineLook } from './headline-look'

/** A request's `lookExtras`: missing (older saved requests) means none; anything but a list is refused. */
export function parseLookExtrasField(value: unknown): LookExtraId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 32) throw new Error('Choose your extras from the list.')
  return parseLookExtras(value)
}

/**
 * The engine's fields: the extras, and the color they use (the brand's color, else the hook bar's
 * brand color; none: each effect's own default). Nothing when no extras are picked.
 */
export function lookExtrasForEngine(extras: readonly LookExtraId[] | undefined, brandColor?: string | null, headlineLook?: HeadlineLook):
  { look_extras?: LookExtraId[]; look_extras_color?: string } {
  const ids = parseLookExtras(extras ?? [])
  if (!ids.length) return {}
  const color = isHexColor(brandColor) ? brandColor.toUpperCase()
    : headlineLook?.look === 'brand' && isHexColor(headlineLook.color) ? headlineLook.color.toUpperCase() : undefined
  return { look_extras: ids, ...(color ? { look_extras_color: color } : {}) }
}

/** Remix screenshots: an optional box around the key number, as shares of the picture (for the proof underline). */
export interface ImageHighlight { x: number; y: number; w: number; h: number }

export function parseImageHighlight(value: unknown): ImageHighlight | undefined {
  if (value === undefined || value === null) return undefined
  const raw = value as Record<string, unknown>
  const keys = ['x', 'y', 'w', 'h'] as const
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(raw).some((key) => !(keys as readonly string[]).includes(key)) ||
      keys.some((key) => typeof raw[key] !== 'number' || !Number.isFinite(raw[key]))) throw new Error('Mark the number on your screenshot again.')
  const [x, y, w, h] = keys.map((key) => raw[key] as number)
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) throw new Error('Mark the number on your screenshot again.')
  return { x, y, w, h }
}
