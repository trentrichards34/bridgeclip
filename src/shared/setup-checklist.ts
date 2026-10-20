/**
 * The setup path ("Get set up"): each item is checked off from real state
 * (keys saved, the tools check, camera access, Zernio accounts, the member's
 * brand identities, call-to-action clips, avatars and Library runs), never
 * from a click. With goals in the member's profile, only the steps those goals
 * need are shown, plus a "make your first one" step for each kind of video.
 */

import { GOALS, isVideoGoal, type GoalId, type VideoGoalId } from './onboarding'
import { ZERNIO_PLATFORM_NAMES, type ZernioPlatform } from './zernio'

export type FirstRunId = 'first-clip' | 'first-ai-reaction' | 'first-camera-reaction' | 'first-article' | 'first-avatar-video' | 'first-edited-recording'
export type SetupItemId = 'openrouter' | 'tools' | 'camera' | 'posting' | 'brand' | 'cta' | 'avatar' | FirstRunId

/** Finished Library runs by what made them. */
export interface RunCounts {
  clips: number; aiReactions: number; cameraReactions: number; articles: number; avatarVideos: number
  /** Reels made on Edit my recording (missing: none counted yet). */
  editedRecordings?: number
}

export interface SetupFacts {
  openrouter: boolean
  /** null while the tools check runs. */
  toolsOk: boolean | null
  /** Camera and microphone allowed; null while unknown. */
  camera: boolean | null
  zernioKey: boolean
  /** Postable accounts connected in Zernio (any profile). */
  postingAccounts: number
  /** Platforms with at least one postable account. */
  connectedPlatforms: ZernioPlatform[]
  brandIdentities: number
  ctas: number
  avatars: number
  /** Finished Library runs (any kind). */
  runs: number
  runsByKind: RunCounts
}

export interface SetupItem {
  id: SetupItemId
  title: string
  detail: string
  done: boolean
  optional?: boolean
  /** Why it matters (one line). */
  why?: string
  /** How to do it, in short steps. */
  how?: string[]
  /** What it costs, in plain words (never a made-up number). */
  cost?: string
  /** The kind of video a first-run step makes. */
  goal?: VideoGoalId
}

export interface SetupProfile { goals: readonly GoalId[]; platforms: readonly ZernioPlatform[] }

const FIRST_RUNS: Record<VideoGoalId, { id: FirstRunId; title: string; detail: string; count: keyof RunCounts }> = {
  clips: { id: 'first-clip', title: 'Make your first clips', detail: 'Paste a video link on Create and start a run.', count: 'clips' },
  'ai-reactions': { id: 'first-ai-reaction', title: 'Make your first AI reaction', detail: 'In Remix, choose AI presenter and remix a video with your avatar.', count: 'aiReactions' },
  'camera-reactions': { id: 'first-camera-reaction', title: 'Make your first on-camera reaction', detail: 'In Remix, choose You on camera: Pause & react, Their clip then me, React then my thoughts, or a moment from a long video.', count: 'cameraReactions' },
  article: { id: 'first-article', title: 'Make your first article or post video', detail: 'Talk over a screenshot in Remix.', count: 'articles' },
  'avatar-videos': { id: 'first-avatar-video', title: 'Make your first avatar video', detail: 'Write a script in Avatar Studio and generate it.', count: 'avatarVideos' }
}

const FIRST_EDITED_RECORDING = {
  id: 'first-edited-recording', title: 'Make your first edited recording',
  detail: 'Open Edit my recording, add a video of you talking, review the edit and make your reel.'
} as const

export function firstRunGoal(id: SetupItemId): VideoGoalId | null {
  return (Object.keys(FIRST_RUNS) as VideoGoalId[]).find((goal) => FIRST_RUNS[goal].id === id) ?? null
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The setup path for this profile (no goals: the general checklist). */
export function setupItems(facts: SetupFacts, profile: SetupProfile = { goals: [], platforms: [] }): SetupItem[] {
  const goals = new Set(profile.goals)
  const general = goals.size === 0
  const needsAvatar = goals.has('ai-reactions') || goals.has('avatar-videos')
  const needsCamera = goals.has('camera-reactions') || goals.has('article') || goals.has('edit-recording')
  const posting = general || goals.has('posting')
  const platforms = profile.platforms
  const missing = platforms.filter((platform) => !facts.connectedPlatforms.includes(platform))
  const postingDone = facts.zernioKey && (platforms.length ? missing.length === 0 : facts.postingAccounts > 0)

  const items: SetupItem[] = [
    {
      id: 'openrouter', title: 'Add your OpenRouter key', detail: 'One key covers transcription, picking the best moments and writing.', done: facts.openrouter,
      why: 'CreatorClips uses AI models through OpenRouter to transcribe, find the best moments and write titles and takes.',
      how: ['Sign in at openrouter.ai and add credit to your account.', 'Create an API key there.', 'Paste it in Settings → API keys. It’s stored encrypted on this computer.'],
      cost: 'You pay OpenRouter for what each run uses. You can set a spending limit in Settings → Spending.'
    },
    {
      id: 'tools', title: 'Pass the system check', done: facts.toolsOk === true,
      detail: facts.toolsOk === null ? 'Checking the tools CreatorClips needs…' : facts.toolsOk ? 'All the tools to download, transcribe and cut video are installed.' : 'Some tools are missing. Settings shows which ones.',
      why: 'Video is downloaded, cut and captioned on your own computer.',
      how: ['Open Settings → System check.', 'If anything is missing, follow the fix shown next to it.'],
      cost: 'Free.'
    }
  ]
  if (needsCamera) items.push({
    id: 'camera', title: 'Allow the camera and microphone', done: facts.camera === true,
    detail: facts.camera === false ? 'CreatorClips can’t use the camera yet. You can still upload a phone video.' : 'To record yourself in the app. You can also upload a phone video.',
    why: 'Recording in the app needs your camera and microphone.',
    how: ['Choose Allow camera and say OK when your computer asks.', 'If you said no before: on a Mac, open System Settings → Privacy & Security, then turn on CreatorClips under Camera and under Microphone.'],
    cost: 'Free.'
  })
  if (posting) items.push({
    id: 'posting', done: postingDone,
    title: platforms.length ? `Connect ${listNames(platforms.map((platform) => ZERNIO_PLATFORM_NAMES[platform]))}` : 'Connect a posting account',
    detail: !facts.zernioKey ? 'Add your Zernio key, then connect the accounts you post to.'
      : postingDone ? 'You can post and schedule from CreatorClips.'
        : missing.length && platforms.length ? `Still to connect: ${listNames(missing.map((platform) => ZERNIO_PLATFORM_NAMES[platform]))}.`
          : 'Your Zernio key is saved. Now connect an account to post to.',
    why: 'CreatorClips posts and schedules through Zernio, so you never leave the app to post.',
    how: ['Create a Zernio account and an API key.', 'Paste the key in Settings → API keys.', 'Open Accounts and connect each place you post.'],
    cost: 'Zernio is a separate service with its own plans and pricing.'
  })
  items.push(
    {
      id: 'brand', title: 'Set up your brand', detail: 'Your niche, voice and offer, plus your color, caption style and handle.', done: facts.brandIdentities > 0,
      why: 'Titles, hook text and takes are written in your voice, and your look is filled in for you.',
      how: ['Add a brand: who you help, what you believe, your offer and your proof.', 'Under Look, add your color, hook and caption style, handle or logo, and comment keyword.', 'Choose the brand on Create, Remix or Avatar Studio to use it.'],
      cost: 'Free.'
    },
    {
      id: 'cta', title: 'Add a call-to-action clip', detail: 'A short video or image added to the end of your videos.', done: facts.ctas > 0,
      why: 'Every video can end by telling viewers what to do next, like follow you or comment a keyword.',
      how: ['Choose a short video or image file.', 'Pick it as your brand’s call to action, or on any run.'],
      cost: 'Free.'
    }
  )
  if (needsAvatar || general) items.push({
    id: 'avatar', title: 'Make an avatar', done: facts.avatars > 0, optional: general,
    detail: needsAvatar ? 'Your AI presenter: a picture and a voice.' : 'For Avatar Studio videos and Remix takes with an AI presenter.',
    why: 'AI reactions and avatar videos are presented by your avatar.',
    how: ['Open Avatar Studio and choose Create avatar.', 'Use your photo as is, make an AI version of it, or generate an AI person.', 'Pick a voice, or clone your own.']
  })
  // In the app's order, whatever order the goals were picked in.
  const runGoals: GoalId[] = general ? ['clips'] : GOALS.map((goal) => goal.id).filter((id) => goals.has(id) && (isVideoGoal(id) || id === 'edit-recording'))
  for (const goal of runGoals) {
    if (goal === 'edit-recording') {
      // Its own page, not one of the first-run guides (no `goal`): the step opens Edit my recording.
      items.push({ ...FIRST_EDITED_RECORDING, done: (facts.runsByKind.editedRecordings ?? 0) > 0 })
      continue
    }
    if (!isVideoGoal(goal)) continue
    const run = FIRST_RUNS[goal]
    const done = general ? facts.runs > 0 : (facts.runsByKind[run.count] ?? 0) > 0
    items.push({ id: run.id, title: general ? 'Make your first clip' : run.title, detail: run.detail, done, goal })
  }
  return items
}

/** Required items left (optional ones never block "all set"). */
export function remainingSetup(items: SetupItem[]): number {
  return items.filter((item) => !item.optional && !item.done).length
}

/** The goal labels, for headings ("Clips from my long videos and Reactions on camera"). */
export function goalLabels(goals: readonly GoalId[]): string[] {
  return GOALS.filter((goal) => goals.includes(goal.id)).map((goal) => goal.label)
}
