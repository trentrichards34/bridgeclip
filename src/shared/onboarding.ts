/**
 * Onboarding: the member's CreatorClips profile (what they want to make and
 * where they post) and the short written how-tos for each kind of video.
 * The profile picks which setup steps the member sees; the brand and call to
 * action live in their own libraries (brand identities, CTA clips).
 */

import { ZERNIO_PLATFORMS, type ZernioPlatform } from './zernio'

export type GoalId = 'clips' | 'ai-reactions' | 'camera-reactions' | 'article' | 'avatar-videos' | 'posting'

/** Where each kind of video is made (renderer page ids). */
export type GoalPage = 'clip' | 'remix' | 'avatar' | 'accounts'

export interface Goal {
  id: GoalId
  label: string
  detail: string
  page: GoalPage
}

export const GOALS: readonly Goal[] = [
  { id: 'clips', label: 'Clips from my long videos', detail: 'Turn podcasts, streams and YouTube videos into short clips with captions.', page: 'clip' },
  { id: 'ai-reactions', label: 'Reactions as my AI self', detail: 'Your avatar and voice react to other videos, with your take. In beta.', page: 'remix' },
  { id: 'camera-reactions', label: 'Reactions on camera', detail: 'Record yourself reacting to other videos, here or on your phone.', page: 'remix' },
  { id: 'article', label: 'Talk over an article or post', detail: 'Green screen yourself over a screenshot; the AI writes the headline.', page: 'remix' },
  { id: 'avatar-videos', label: 'AI avatar videos from a script', detail: 'Write a script and your avatar presents it.', page: 'avatar' },
  { id: 'posting', label: 'Post and schedule from here', detail: 'Connect your accounts and post or schedule without leaving the app.', page: 'accounts' }
]

/** The kinds of video a member makes (every goal but posting). */
export type VideoGoalId = Exclude<GoalId, 'posting'>
export const VIDEO_GOALS: readonly VideoGoalId[] = ['clips', 'ai-reactions', 'camera-reactions', 'article', 'avatar-videos']

export type OnboardingState = 'new' | 'skipped' | 'done'

export interface CreatorProfile {
  goals: GoalId[]
  platforms: ZernioPlatform[]
  /** 'new' opens the guided setup on launch; 'skipped' and 'done' don't. */
  onboarding: OnboardingState
}

export const DEFAULT_PROFILE: CreatorProfile = { goals: [], platforms: [], onboarding: 'new' }

export function isGoalId(value: unknown): value is GoalId {
  return typeof value === 'string' && GOALS.some((goal) => goal.id === value)
}

export function isVideoGoal(value: unknown): value is VideoGoalId {
  return typeof value === 'string' && (VIDEO_GOALS as readonly string[]).includes(value)
}

function isPlatform(value: unknown): value is ZernioPlatform {
  return typeof value === 'string' && (ZERNIO_PLATFORMS as readonly string[]).includes(value)
}

/** Known values only, each once, in the app's own order. */
function cleanList<T extends string>(value: unknown, order: readonly T[], check: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) return []
  const picked = new Set(value.filter(check))
  return order.filter((item) => picked.has(item))
}

/** A stored profile, read leniently: unknown values are dropped. */
export function readProfile(value: unknown): CreatorProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { goals: [], platforms: [], onboarding: 'new' }
  const raw = value as Record<string, unknown>
  return {
    goals: cleanList(raw.goals, GOALS.map((goal) => goal.id), isGoalId),
    platforms: cleanList(raw.platforms, ZERNIO_PLATFORMS, isPlatform),
    onboarding: raw.onboarding === 'skipped' || raw.onboarding === 'done' ? raw.onboarding : 'new'
  }
}

/** A profile update from the renderer: strict (an unknown value is an error, not dropped). */
export function parseProfileUpdate(value: unknown, current: CreatorProfile): CreatorProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid profile')
  const raw = value as Record<string, unknown>
  const next = { ...current }
  if ('goals' in raw) {
    if (!Array.isArray(raw.goals) || raw.goals.length > GOALS.length || !raw.goals.every(isGoalId)) throw new Error('Choose what you want to make from the list.')
    next.goals = cleanList(raw.goals, GOALS.map((goal) => goal.id), isGoalId)
  }
  if ('platforms' in raw) {
    if (!Array.isArray(raw.platforms) || raw.platforms.length > ZERNIO_PLATFORMS.length || !raw.platforms.every(isPlatform)) throw new Error('Choose where you post from the list.')
    next.platforms = cleanList(raw.platforms, ZERNIO_PLATFORMS, isPlatform)
  }
  if ('onboarding' in raw) {
    if (raw.onboarding !== 'new' && raw.onboarding !== 'skipped' && raw.onboarding !== 'done') throw new Error('Invalid setup state')
    next.onboarding = raw.onboarding
  }
  return next
}

/** A short written how-to for one kind of video. */
export interface Guide {
  id: GoalId
  title: string
  /** One line: what this makes. */
  summary: string
  /** What has to be set up first (plain words). */
  needs: string[]
  steps: string[]
  tips: string[]
}

export const GUIDES: Record<GoalId, Guide> = {
  clips: {
    id: 'clips',
    title: 'Clips from your long videos',
    summary: 'Paste a long video and get short, captioned clips of its best moments.',
    needs: ['Your OpenRouter key', 'The system check passing'],
    steps: [
      'Open Create. Paste a YouTube or Twitch link, or choose a file from your computer. You can add up to 10 videos at once.',
      'Pick a workflow. Automatic makes finished clips. Review & edit shows you the candidates first so you can pick and trim them.',
      'Under Format, choose Vertical for TikTok, Reels and Shorts.',
      'Under Clips, describe the moments you want if you have something in mind, and pick the lengths.',
      'Under Captions, choose a caption style and your brand, then Generate clips.',
      'Finished clips land in your Library, ready to post, schedule or edit.'
    ],
    tips: [
      'In the Library, “More clips from this video” finds new moments and reuses the transcript, so you don’t pay to transcribe it again.',
      'Choosing your brand fills in your hook look, caption style and call to action for you.',
      'Edit a clip after it’s made: its framing, the size of each part of a split screen, the hook text, captions and call to action.'
    ]
  },
  'ai-reactions': {
    id: 'ai-reactions',
    title: 'Reactions as your AI self',
    summary: 'Your avatar and voice react to someone else’s video with your take. The AI presenter is in beta: a still picture with voice-over, no lip-sync yet.',
    needs: ['Your OpenRouter key', 'An avatar (made in Avatar Studio)'],
    steps: [
      'Make an avatar first: open Avatar Studio and choose Create avatar. Use your photo or an AI person, and pick or clone a voice.',
      'Open Remix and paste links to the videos you want to react to.',
      'Choose a format. Voiced take plays a few seconds of their moment, then your take in your voice. Silent react plays their moment while your avatar reacts.',
      'Under Presenter, choose Avatar photo or Voice only, and pick your avatar.',
      'Choose Write the takes. Read them, fix anything marked in red, then make the videos.'
    ],
    tips: [
      'Only remix videos you own or have permission to use. Remix asks you to confirm before it starts.',
      'Pick your brand so the takes are written in your voice, with your look and call to action.'
    ]
  },
  'camera-reactions': {
    id: 'camera-reactions',
    title: 'Reactions on camera',
    summary: 'You react to someone else’s video on camera: record here or upload a phone video.',
    needs: ['Your OpenRouter key', 'Camera and microphone access (or a phone video to upload)'],
    steps: [
      'Easiest: open Remix, choose Pause & react and paste one video link (or choose a file, or use ⋯ → Remix this clip in your Library).',
      'Trim it to the part you react to, then record: their video plays above your camera and Space pauses it while you talk. Or upload a phone recording where you paused it yourself.',
      'Check the pauses, let the AI write the hook text and caption from what you said, then make the video.',
      'For other styles, choose Voiced take or Silent react with Me, on camera as the presenter, and record each take in the app or upload it.'
    ],
    tips: [
      'Wear headphones when you record in the app, so their video’s sound stays out of your microphone.',
      'Face a window or a lamp and keep your head and shoulders in the frame; the cut-out background works best with good light.',
      'Only remix videos you own or have permission to use.'
    ]
  },
  article: {
    id: 'article',
    title: 'Talk over an article or post',
    summary: 'Stand in front of a screenshot like a green screen and say your take.',
    needs: ['Your OpenRouter key', 'Camera and microphone access (or a phone video to upload)'],
    steps: [
      'Take a screenshot of the article, post or tweet you want to talk about.',
      'Open Remix, choose the Article or post format, then Choose a screenshot.',
      'Record your take on camera in front of it (up to 3 minutes), or upload a phone video.',
      'The AI writes the headline and caption from what you said. Check them, then make the video.'
    ],
    tips: ['Crop the screenshot to the part that matters so it reads well on a phone.']
  },
  'avatar-videos': {
    id: 'avatar-videos',
    title: 'AI avatar videos from a script',
    summary: 'Write a script and your avatar presents it in your voice.',
    needs: ['Your OpenRouter key', 'An avatar'],
    steps: [
      'Open Avatar Studio and choose Create avatar: use your photo, an AI version of you or a new AI person, and pick or clone a voice.',
      'Under 1 · Script, write your script or have the AI draft one.',
      'Under 2 · Look, choose captions, hook text and whether to show your handle.',
      'Under 3 · Generate, check the estimated cost, then generate. The video is saved to your Library.'
    ],
    tips: ['Recreate swaps your avatar into an existing video. It runs on fal.ai, so it needs a fal.ai key in Settings → API keys.']
  },
  posting: {
    id: 'posting',
    title: 'Post and schedule from CreatorClips',
    summary: 'Post finished videos to your accounts now or on a schedule.',
    needs: ['A Zernio API key', 'Your accounts connected in Accounts'],
    steps: [
      'Zernio is the service CreatorClips posts through. Create a Zernio account and an API key, then paste the key in Settings → API keys.',
      'Open Accounts and connect TikTok, Instagram, YouTube or the other places you post.',
      'In the Library, choose Post or schedule on any video. Pick the accounts, the caption and a time.',
      'Open Posts to see everything scheduled and posted, as a list or a calendar. Automations post new videos on a schedule for you.'
    ],
    tips: ['Zernio is a separate service with its own plans and pricing.']
  }
}
