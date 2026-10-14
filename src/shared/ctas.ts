/**
 * The member's call-to-action library: short clips of them asking for the
 * comment, the follow or the click (or an offer graphic), added to the end of
 * finished clips. Made once, reused on any clip from Create or Remix.
 */
export type CtaKind = 'video' | 'image'

export interface CtaSummary {
  id: string
  name: string
  kind: CtaKind
  /** How long it plays at the end of a clip. */
  seconds: number
  /** Playable/previewable file (a video, or the image itself). */
  path: string
  createdAt: string
}

/** Which CTA a finished clip ends with (stored on the clip in job_output.json). */
export interface ClipCta { id: string; name: string }

export const CTA_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm']
export const CTA_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
/** A recorded CTA keeps at most this much (the ask, not a second video). */
export const MAX_CTA_VIDEO_SECONDS = 15
export const IMAGE_CTA_SECONDS = { min: 2, max: 8, default: 4 } as const
export const MAX_CTAS = 20
export const MAX_CTA_NAME = 60

const ID = /^[a-f0-9]{16}$/

export function isCtaId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

/** A CTA choice from the renderer: an id, or null for none. */
export function parseCtaChoice(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (!isCtaId(value)) throw new Error('Choose a call to action from your library.')
  return value
}

export function cleanCtaName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_CTA_NAME) : ''
}
