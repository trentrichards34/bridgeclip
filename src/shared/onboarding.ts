/**
 * Onboarding: the member's CreatorClips profile (what they want to make and
 * where they post) and the short written how-tos for each kind of video.
 * The profile picks which setup steps the member sees; the brand and call to
 * action live in their own libraries (brand identities, CTA clips).
 */

import { ZERNIO_PLATFORMS, type ZernioPlatform } from './zernio'
import { isAvatarStudioEnabled } from './features'

export type GoalId = 'clips' | 'edit-recording' | 'ai-reactions' | 'camera-reactions' | 'article' | 'avatar-videos' | 'listicle' | 'posting'

/** Where each kind of video is made (renderer page ids). */
export type GoalPage = 'clip' | 'edit' | 'remix' | 'avatar' | 'accounts'

export interface Goal {
  id: GoalId
  label: string
  detail: string
  page: GoalPage
}

export const GOALS: readonly Goal[] = [
  { id: 'clips', label: 'Clips from my long videos', detail: 'Turn podcasts, streams and YouTube videos into short clips with captions.', page: 'clip' },
  { id: 'edit-recording', label: 'Edit my raw recordings', detail: 'Film yourself talking, retakes and all; get back one finished vertical reel.', page: 'edit' },
  { id: 'ai-reactions', label: 'Reactions as my AI self', detail: 'Your avatar and voice react to other videos, with your take. In beta.', page: 'remix' },
  { id: 'camera-reactions', label: 'Reactions on camera', detail: 'Record yourself reacting to other videos, here or on your phone.', page: 'remix' },
  { id: 'article', label: 'Talk over an article or post', detail: 'Green screen yourself over a screenshot; the AI writes the headline.', page: 'remix' },
  { id: 'avatar-videos', label: 'AI avatar videos from a script', detail: 'Write a script and your avatar presents it.', page: 'avatar' },
  { id: 'listicle', label: 'Top lists, no camera', detail: '“5 tools you need” videos from screenshots and a voice-over.', page: 'avatar' },
  { id: 'posting', label: 'Post and schedule from here', detail: 'Connect your accounts and post or schedule without leaving the app.', page: 'accounts' }
]

/** Goals made with Avatar Studio or its avatars (AI reactions in Remix, avatar videos, Top lists). */
export const AVATAR_GOALS: readonly GoalId[] = ['ai-reactions', 'avatar-videos', 'listicle']

/** Whether a goal can be picked, and its guide shown: Avatar Studio's only while it's switched on (shared/features). */
export function goalAvailable(id: GoalId): boolean {
  return isAvatarStudioEnabled() || !AVATAR_GOALS.includes(id)
}

/** The goals a member can pick now. */
export function availableGoals(): readonly Goal[] {
  return GOALS.filter((goal) => goalAvailable(goal.id))
}

/** The kinds of video a member makes on Clip, Remix and Avatar Studio (their setup steps and first-run guides). */
// Edit my recording has its own page and guide; it isn't one of the setup's first-video steps.
export type VideoGoalId = Exclude<GoalId, 'posting' | 'edit-recording'>
export const VIDEO_GOALS: readonly VideoGoalId[] = ['clips', 'ai-reactions', 'camera-reactions', 'article', 'avatar-videos', 'listicle']

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

/** Guides for tools that aren't profile goals (they have no setup step): their own page opens them. */
export type ToolGuideId = 'broll-video' | 'ai-explainers'

/** A short written how-to for one kind of video. */
export interface Guide {
  id: GoalId | ToolGuideId
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
      'Open Clip. Paste a YouTube or Twitch link, or choose a file from your computer. You can add up to 10 videos at once.',
      'Pick a workflow. Automatic makes finished clips. Review & edit shows you the candidates first so you can pick and trim them.',
      'Under Format, choose Vertical for TikTok, Reels and Shorts.',
      'Under Clips, type in What to clip the moments you want, if you have something in mind, and pick the lengths.',
      'Under Captions, choose a caption style and your brand, then Generate clips.',
      'Finished clips land in your Library, ready to post, schedule or edit.',
      'To change one, choose ⋯ → Open in editor. There, Add graphic opens the gallery; Design a custom graphic here has your AI design one for the words said at that spot. Pick Best or Lower cost: each shows its estimate before you spend anything.'
    ],
    tips: [
      'In the Library, “More clips from this video” finds new moments and reuses the transcript, so you don’t pay to transcribe it again.',
      'In the editor, Hook ideas writes hook options. Tick Trial reel on several to make a copy of the clip for each hook, for Instagram trial reels.',
      'Choosing your brand fills in your hook look, caption style and call to action for you.',
      'Edit a clip after it’s made: its framing, the size of each part of a split screen, the hook text, captions and call to action.'
    ]
  },
  'edit-recording': {
    id: 'edit-recording',
    title: 'Edit my recording',
    summary: 'Turn a raw recording of you talking to camera into one finished vertical reel.',
    needs: ['Your OpenRouter key', 'The system check passing'],
    steps: [
      'Open Edit my recording. Choose your recording, or a few takes of the same video. Or choose Film it here to record with your camera. Filmed your screen at the same time? Choose + Add a screen recording.',
      'Pick your brand, then choose Edit my recording. It listens to every word and plans the edit: the strongest hook first, your last complete take of each line, filler words and false starts cut.',
      'Review it: click any word to keep or cut it, try another hook, edit the hook text, and switch pop-ups and sounds on or off.',
      'Under Skills, turn on what you want, like Sound effects, or Custom graphics (Beta), where your AI designs scenes for the parts where you teach. Pick how many with Scenes: Light, Standard or Full. Each shows its estimate before you spend anything.',
      'Choose Make my reel. It lands in your Library, ready to post. To change it later, choose ⋯ → Open in editor.'
    ],
    tips: [
      'Fluff a line? Say it again, or say “scratch that” and start the line over: the edit keeps your last complete take.',
      'Not sure what to film? Open What should I film? for five ideas with a hook and talking points, then Film this.',
      'In the clip editor, Hook ideas writes hook options from what you said. Tick Trial reel on several to make a copy of the clip for each hook, for Instagram trial reels.',
      'Also in the clip editor: Hook stays on screen sets how long the hook text shows, Fix layout redoes the scenes from your graphics, and Design a custom graphic here (under Add graphic) designs one for a single spot.'
    ]
  },
  'ai-reactions': {
    id: 'ai-reactions',
    title: 'Reactions as your AI self',
    summary: 'Your avatar and voice react to someone else’s video with your take. The AI presenters are in beta: a still picture with voice-over, voice only, or a realistic lip-synced avatar through your own HeyGen account.',
    needs: ['Your OpenRouter key', 'An avatar (made in Avatar Studio)', 'For Avatar on camera: a HeyGen key and a HeyGen avatar'],
    steps: [
      'Make an avatar first: open Avatar Studio and choose Create avatar. Use your photo or an AI person, and pick or clone a voice.',
      'Open Remix and choose AI presenter (Beta) at the top, then paste links to the videos you want to react to.',
      'Choose a format. Voiced take plays a few seconds of their moment, then your take in your voice. React to a clip plays their moment while your avatar reacts.',
      'Under Presenter, choose Avatar photo or Voice only, and pick your avatar. With Voiced take you can also choose Avatar on camera (HeyGen, Beta): your realistic avatar says the take, lip-synced. It needs your HeyGen key in Settings → API keys and a HeyGen avatar made in Avatar Studio, and HeyGen bills it on your HeyGen account.',
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
      'From a long video like a podcast: choose Moment + my take, paste the link and add up to 3 time ranges (type them, like 37:00 to 42:00, or paste a screenshot of the player). The AI picks the best moment in each, you record your take on each one, and each becomes its own video: the moment, then you.',
      'From a reel, Short or TikTok: choose Their clip, then me. Their clip plays first with its captions, then you give your take, recorded here or uploaded.',
      'To react while it plays and then talk about it: choose React, then my thoughts. You film yourself watching their clip (it plays in a big box in front of you), then record your thoughts. Add your own clips or pictures as b-roll, or turn on stock footage, and the AI places them over your words. You can swap or remove any shot.',
      'To stand in front of their video, choose Green screen over their video. To read lines the AI writes, choose Scripted take.'
    ],
    tips: [
      'Wear headphones when you record in the app, so their video’s sound stays out of your microphone.',
      'To add graphics to a finished video, choose ⋯ → Open in editor in your Library, then Add graphic. Design a custom graphic here has your AI design one for that spot.',
      'Listening on the go? Screenshot the player when something stands out. Later, drop those screenshots into Moment + my take to set your ranges.',
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
      'Open Remix, choose Article or post, then Choose a screenshot.',
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
    tips: ['Recreate swaps your avatar into an existing video. It runs on fal.ai, so it needs a fal.ai key in Settings → API keys.', 'Realistic lip-synced avatars use HeyGen (Beta) with your own HeyGen key in Settings → API keys.']
  },
  listicle: {
    id: 'listicle',
    title: 'Top lists, no camera',
    summary: 'A “5 tools you need” style video: numbered items, your screenshots with the key part boxed, a voice-over and captions. No filming.',
    needs: ['Your OpenRouter key (not needed if you record your own voice)', 'The system check passing'],
    steps: [
      'Open Avatar Studio and choose Top list at the top. You don’t need an avatar for it.',
      'Write the list title and 3 to 7 items. For each one, add its name and a line or two about it.',
      'Add a screenshot to any item and drag on it to box the part that matters. Items without one show their number and name.',
      'Choose Write the script. Read each line and change anything that isn’t right: the video only says what you leave here.',
      'Pick a voice: a preset voice, your avatar’s voice, or record your own in the app (free). Check the header, your handle for the end card and your call to action.',
      'Check the estimated cost, then choose Make the video. It lands in your Library, ready to post.'
    ],
    tips: [
      'Crop screenshots to the part that matters so they read well on a phone.',
      'The header defaults to your brand name. Add a category after it, like “YOUR BRAND · AI TOOLS”.'
    ]
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

/** Where each tool guide's Start button goes (renderer page ids). */
export const TOOL_GUIDE_PAGES: Record<ToolGuideId, 'brollvideo' | 'aivideo'> = { 'broll-video': 'brollvideo', 'ai-explainers': 'aivideo' }

/** Guides for B-roll video and AI explainers, listed after the goal guides. */
export const TOOL_GUIDES: Record<ToolGuideId, Guide> = {
  'broll-video': {
    id: 'broll-video',
    title: 'B-roll video (Beta)',
    summary: 'Your voiceover, or a script read by an AI voice, covered start to end with your own b-roll, with captions, hook text and motion graphics.',
    needs: ['Your OpenRouter key', 'Clips or pictures in your B-roll library (or Fill gaps with AI shots turned on)'],
    steps: [
      'Open B-roll library (Beta) and add clips or pictures, or a whole folder. The AI looks at each one once; your files stay where they are.',
      'Open B-roll video (Beta). Under Your words, choose My voiceover (choose a file or record one), A script (AI voice), or Script + my recording.',
      'Under Your b-roll, use your whole library or only some clips. Turn on Fill gaps with AI shots for new AI shots where nothing in your library fits.',
      'Under The look, choose the shape, hook text, captions, motion graphics, crossfades and voice cleanup.',
      'Check the cost under the button, then choose Make my b-roll video. Swap any shot, open it in the editor, or see it in your Library.'
    ],
    tips: [
      'Everything stays editable in the clip editor.',
      'Add more b-roll to your library any time: the next video uses it.'
    ]
  },
  'ai-explainers': {
    id: 'ai-explainers',
    title: 'AI explainers',
    summary: 'Animated explainer reels with a cartoon presenter and a voiceover, made by a skill that runs in your own Claude (Claude Code).',
    needs: ['A paid Claude plan with Claude Code', 'An ElevenLabs account for the voice'],
    steps: [
      'Open AI explainers and choose Save the skill to my computer. Pick where to keep it, like Documents: CreatorClips copies the skill into a new “AI Video” folder there.',
      'Open that folder in Claude Code: in the Claude desktop app, open the Code tab and choose the “AI Video” folder. Or in Terminal, go into the folder and run claude.',
      'Say “set up the AI video skill”. Claude checks your computer and walks you through anything missing, one step at a time: Node.js, ffmpeg, Python, a private browser for rendering, your ElevenLabs voice key and picking a voice.',
      'Ask for a reel, like “Make a reel about 3 Notion templates every freelancer needs.” Or say “Use my script:” and paste your script.',
      'Post it: your video lands in the folder’s videos/<topic>/out/, with a caption ready to paste.'
    ],
    tips: [
      'It runs in your own Claude, so each video is covered by the plan you already pay for.',
      'Don’t paste your ElevenLabs key into the chat: Claude shows you the file to save it in.',
      'Each reel ends with “Comment KEYWORD”. Use that keyword in your DM automation so commenters get what you promised.'
    ]
  }
}
