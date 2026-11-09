// Cover frames and YouTube closed captions for posts made through Zernio.
// Shared by the main process (authoritative checks, payloads) and the post
// dialog (what to show for which platform).
//
// What Zernio takes, from the API types in @zernio/node (types.gen.ts):
// - MediaItem.thumbnail: a cover image URL for Facebook videos and Reels,
//   LinkedIn videos and regular (not Shorts) YouTube videos.
// - InstagramPlatformData.thumbOffset (ms) or .instagramThumbnail (image URL).
// - TikTokPlatformData.videoCoverTimestampMs or .videoCoverImageUrl.
// - YouTubePlatformData: "Custom thumbnails for regular videos only".
// - MediaItem.subtitles: [{ url, language }] SRT or WebVTT, up to 1 MB each.
// X and Threads have no cover option.

import type { ZernioPlatform } from './zernio'

/** A frame of the clip (milliseconds from its start), or an image the member chose. */
export type PostCover = { kind: 'frame'; atMs: number } | { kind: 'image'; path: string }

export type CoverHow = 'timestamp' | 'image'
export interface CoverSupport {
  supported: boolean
  /** How a picked frame reaches the platform: as a time in the video, or as an uploaded image. */
  frameAs: CoverHow | null
  /** Why not, when unsupported. */
  reason: string | null
}

const NONE = (reason: string): CoverSupport => ({ supported: false, frameAs: null, reason })

/** Whether `platform` can take a custom cover. `youtubeShort`: the clip posts to YouTube as a Short. */
export function coverSupport(platform: ZernioPlatform, youtubeShort: boolean): CoverSupport {
  switch (platform) {
    case 'tiktok':
    case 'instagram':
      return { supported: true, frameAs: 'timestamp', reason: null }
    case 'facebook':
    case 'linkedin':
      return { supported: true, frameAs: 'image', reason: null }
    case 'youtube':
      return youtubeShort ? NONE('YouTube doesn’t allow custom covers on Shorts.') : { supported: true, frameAs: 'image', reason: null }
    case 'twitter':
      return NONE('X doesn’t take a custom cover.')
    case 'threads':
      return NONE('Threads doesn’t take a custom cover.')
  }
}

/** Facebook takes cover images up to 10 MB, the tightest of the platforms; JPG and PNG work everywhere. */
export const COVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const COVER_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const

/** JPEG or PNG by its first bytes; null for anything else. */
export function coverImageType(head: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (head.length >= 8 && png.every((byte, i) => head[i] === byte)) return 'image/png'
  return null
}

/** Null when `atMs` is a frame inside a clip of `durationMs` (unknown length: any time up to 6 hours). */
export function coverFrameError(atMs: unknown, durationMs: number | null): string | null {
  if (typeof atMs !== 'number' || !Number.isInteger(atMs) || atMs < 0) return 'Choose a cover frame inside the clip.'
  const limit = durationMs != null && durationMs > 0 ? durationMs : 6 * 3_600_000
  if (atMs > limit) return 'Choose a cover frame inside the clip.'
  return null
}

export interface SuggestedFrame { label: string; atMs: number }

/**
 * Frames worth offering as a cover: the hook (about a second in, past any
 * fade-in) and the middle. Only times inside the clip; nothing invented.
 */
export function suggestedCoverFrames(durationMs: number | null): SuggestedFrame[] {
  if (durationMs == null || durationMs <= 0) return [{ label: 'Opening', atMs: 0 }]
  const frames: SuggestedFrame[] = [{ label: 'Hook', atMs: Math.min(1000, Math.floor(durationMs / 4)) }]
  const middle = Math.floor(durationMs / 2)
  if (middle - frames[0].atMs >= 500) frames.push({ label: 'Middle', atMs: middle })
  return frames
}

// ---- Closed captions --------------------------------------------------------

/** Zernio rejects subtitle files over 1 MB (INVALID_SUBTITLES). */
export const SUBTITLE_MAX_BYTES = 1024 * 1024

/** BCP-47 with a two-letter language, as Zernio asks: en, es, pt-BR. */
export function isSubtitleLanguage(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(value)
}

/** Languages offered in the dialog; a clip's recorded language is added when it isn't here. */
export const SUBTITLE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' }
]

export type SubtitleFormat = 'srt' | 'vtt'

/**
 * Null when `text` is an SRT or WebVTT file Zernio can take: at most 1 MB
 * (checked by the caller on bytes), with at least one cue timing line.
 */
export function subtitleTextError(text: string, format: SubtitleFormat): string | null {
  if (text.includes('\0')) return 'The clip’s subtitle file isn’t text.'
  const body = text.replace(/^\uFEFF/, '')
  if (format === 'vtt' && !/^WEBVTT/.test(body)) return 'The clip’s subtitle file isn’t valid WebVTT.'
  const cue = format === 'srt'
    ? /^\d{1,2}:\d{2}:\d{2},\d{3}[ \t]*-->[ \t]*\d{1,2}:\d{2}:\d{2},\d{3}/m
    : /^(\d{1,2}:)?\d{2}:\d{2}\.\d{3}[ \t]*-->[ \t]*(\d{1,2}:)?\d{2}:\d{2}\.\d{3}/m
  if (!cue.test(body)) return format === 'srt' ? 'The clip’s subtitle file has no SRT cues.' : 'The clip’s subtitle file has no WebVTT cues.'
  return null
}

/** What the dialog learns about a clip's subtitles before posting. */
export interface ClipSubtitles {
  found: boolean
  /** File name only, for display. */
  fileName: string | null
  /** The language the run recorded for its captions, when it did. */
  language: string | null
}

/**
 * YouTube posts a vertical clip of 3 minutes or less as a Short, and Shorts
 * can't have a custom cover. An unknown length or shape counts as a Short,
 * so a cover is never promised where YouTube may drop it.
 */
export function postsAsYouTubeShort(media: { durationMs: number | null; width: number | null; height: number | null }): boolean {
  if (media.durationMs == null) return true
  const vertical = media.width && media.height ? media.height > media.width : null
  return vertical !== false && media.durationMs / 1000 <= YOUTUBE_SHORT_SECONDS
}
/** Same as YOUTUBE_SHORT_MAX_SEC in zernio-posts.ts (kept here to avoid an import cycle). */
const YOUTUBE_SHORT_SECONDS = 180

/** The selected platforms that can take a cover for this clip, and a note naming the ones that can't. */
export function coverPlatforms(platforms: readonly ZernioPlatform[], youtubeShort: boolean): { supported: ZernioPlatform[]; unsupported: { platform: ZernioPlatform; reason: string }[] } {
  const supported: ZernioPlatform[] = []
  const unsupported: { platform: ZernioPlatform; reason: string }[] = []
  for (const platform of new Set(platforms)) {
    const support = coverSupport(platform, youtubeShort)
    if (support.supported) supported.push(platform)
    else unsupported.push({ platform, reason: support.reason ?? '' })
  }
  return { supported, unsupported }
}
