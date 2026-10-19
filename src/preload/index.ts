import type { JevThresholdSettings } from '../shared/jev-settings'
import type { LibraryClipTarget } from '../shared/library-posting'
import type { AutomationReviewResult } from '../shared/automations'
import type { AutomaticEditInfo, CandidateEdit, EditorProgressSummary, EditorSession, HookIdea } from '../shared/clip-editor'
import type { JobOutput } from '../shared/job-output'
import type { HeadlineLook } from '../shared/headline-look'
import type { CtaSummary } from '../shared/ctas'
import type { EditAudit } from '../shared/editorial'
import { contextBridge, ipcRenderer } from 'electron'
import { decodeSpendGate, type OpenRouterBalance, type SpendGate, type SpendOverview, type SpendProvider } from '../shared/spending'
import type {
  ZernioConnectOptions,
  ZernioConnectResult,
  ZernioConnectStart,
  ZernioOverview,
  ZernioPendingConnect,
  ZernioPlatform,
  ZernioProfile,
  ZernioSyncResult,
  ZernioStatusCheck
} from '../shared/zernio'
import type { ClipSubtitles } from '../shared/zernio-extras'
import type { ClipMediaInfo, PostClipRequest, PostClipResult, PostProgress, PostRecord, PostsRefreshResult, PostStatsRefreshResult, TikTokCreatorInfo, TikTokLegalLink } from '../shared/zernio-posts'
import type { PostInsights } from '../shared/post-insights'
import type { ClipJobRequest, JobSnapshot, QualityBar } from '../shared/jobs'
import type { CaptionLanguage } from '../shared/caption-language'
import type { MetadataEnhancement, AutomationSourceGroup, AutomationBatchResult, AutomationSourceContext, Automation, AutomationUpdate, AutomationTikTokReview, AutomationTikTokReviewUpdate } from '../shared/automations'
import type { LibraryClipPostingStatus, LibraryEnhancementOptions, LibraryRunPostingCounts } from '../shared/library-posting'
import type { ReadyToPostResult } from '../shared/ready-to-post'
import type { OpenRouterCatalog } from '../shared/openrouter-models'
import type { UpdateState } from '../shared/updates'
import type { OutputStorageUsage } from '../shared/output-storage'
import type { CleanupFilters, CleanupGroupId, CleanupPlan, CleanupResult, FolderChangeInfo, FreeSpace, MoveProgress, MoveResult, RunSize } from '../shared/library-storage'
import type { YouTubePreview } from '../shared/youtube-preview'
import type { AvatarRenderStatus, AvatarScript, AvatarSummary } from '../shared/avatars'
import type { AppPrefsUpdate, MemberPrefs, StyleKind } from '../shared/member-prefs'
import type { CreatorProfile } from '../shared/onboarding'
import type { BrandLook } from '../shared/brand-kit'
import type { BrandIdentity, RecordingPart, RemixDraft, RemixEdit, RemixRecordings, RemixRequest, RemixStatus } from '../shared/remix'
import type { PauseEvent, PauseSettings, PauseView } from '../shared/pause-react'
import type { TimecodeRead } from '../shared/moment-take'
import type {
  AppDataScope,
  AssistantConversation,
  AssistantConversationSummary,
  AssistantEvent,
  AssistantNavigationPage,
  AssistantPreferences,
  AssistantCliProviderId,
  AssistantProviderId,
  AssistantProviderStatus,
  AssistantSignInState
} from '../shared/assistant'

export interface ClipSettings extends JevThresholdSettings {
  openrouterConfigured: boolean
  zernioConfigured: boolean
  pexelsConfigured: boolean
  falConfigured: boolean
  jevEnabled: string
  jevVisualContext: string
  sourceContextWebResearch: string
  outputDirectory: string
  pythonPath: string
  customVocabulary: string
  /** Instagram, TikTok, X and Facebook links download with this browser's login ('' for none). */
  downloadLoginBrowser?: string
}

export type { ClipJobRequest, JobSnapshot } from '../shared/jobs'

export interface StartManyJobsResult {
  started?: { jobId: string; queued: boolean; job: JobSnapshot; videoUrl: string }[]
  failed?: { videoUrl: string; error: string }[]
  error?: string
}

export interface MoreClipsInfo {
  runId: string
  title: string
  videoUrl: string
  /** original: the local file is used in place; kept: the copy kept in the run; download: the link is downloaded again; missing: can't clip again. */
  source: 'original' | 'kept' | 'download' | 'missing'
  transcriptSaved: boolean
  excludedCount: number
  request: ClipJobRequest
  /** False for runs made before settings were saved: some style choices use defaults. */
  savedSettings: boolean
  /** Something the new run does differently (e.g. the earlier brand was deleted, so none is used). */
  note?: string
}

export interface MoreClipsChoices {
  maxClips: number | null
  autoClipCount: boolean
  durationRanges: string[] | null
  qualityBar: QualityBar
  clipRequest?: string
  captionLanguage?: CaptionLanguage
}

export interface HistoryEntry {
  /** What made a finished run: Create, Remix or Avatar Studio. */
  madeWith?: 'create' | 'remix' | 'avatar'
  /** Remix runs: AI presenter, on camera, or over an article or post. */
  remixKinds?: ('ai' | 'camera' | 'image')[]
  editorProject?: boolean
  candidateCount?: number
  favorite?: boolean
  jobId: string
  date: string
  videoTitle: string
  clipCount: number
  status: 'completed' | 'failed' | 'cancelled' | 'running' | 'interrupted' | 'incomplete'
  outputDir: string
  totalCostUsd: number | null
  finishedAt: string | null
  durationMs: number | null
  errorMessage: string | null
}

export interface ToolStatus {
  python: boolean
  pythonDeps: boolean
  pythonPath: string
  pythonError: string | null
  pythonHint?: string | null
  pythonRepairCommand?: string | null
  ffmpeg: boolean
  ffmpegCaptions: boolean
  ffprobe: boolean
  ytdlp: boolean
  engine: boolean
  enginePath: string
  bridgeRunner: boolean
  bridgePath: string
}

export interface BridgeClipAPI {
  source: { youtubePreview: (url: string, details?: boolean) => Promise<YouTubePreview> }
  /** Chat with the user's own Claude Code or Codex, signed in with their subscription. */
  assistant: {
    status: (fresh?: boolean) => Promise<AssistantProviderStatus[]>
    onStatus: (cb: (status: AssistantProviderStatus) => void) => () => void
    preferences: () => Promise<AssistantPreferences>
    savePreferences: (preferences: Partial<AssistantPreferences>) => Promise<AssistantPreferences>
    conversations: () => Promise<AssistantConversationSummary[]>
    conversation: (id: string) => Promise<AssistantConversation | null>
    deleteConversation: (id: string) => Promise<AssistantConversationSummary[]>
    running: () => Promise<string[]>
    send: (message: { conversationId: string | null; provider: AssistantProviderId; model: string; text: string }) => Promise<{ conversationId: string; messageId: string }>
    stop: (conversationId: string) => Promise<void>
    approve: (requestId: string, allowed: boolean) => Promise<void>
    /** Copy the provider's install or sign-in command. */
    copyCommand: (provider: AssistantCliProviderId, which: 'install' | 'signIn') => Promise<boolean>
    onEvent: (cb: (event: AssistantEvent) => void) => () => void
    signIn: {
      start: (provider: AssistantCliProviderId) => Promise<AssistantSignInState>
      state: (provider: AssistantCliProviderId) => Promise<AssistantSignInState>
      submitCode: (provider: AssistantCliProviderId, code: string) => Promise<void>
      cancel: (provider: AssistantCliProviderId) => Promise<void>
      openPage: (provider: AssistantCliProviderId) => Promise<boolean>
      onState: (cb: (state: AssistantSignInState) => void) => () => void
    }
  }
  app: {
    /** Main-side data changed (e.g. the assistant edited it); reload what's shown. */
    onDataChanged: (cb: (scope: AppDataScope) => void) => () => void
    /** The assistant asked the window to show a page. */
    onNavigate: (cb: (target: { page: AssistantNavigationPage; runDir: string | null }) => void) => () => void
    /** A finished-job notification was clicked: show that page (a Library run or a job, when given). */
    onOpenPage: (cb: (target: { page: 'library' | 'jobs' | 'remix' | 'avatar'; runDir: string | null; jobId: string | null }) => void) => () => void
    /** Camera and microphone allowed (true/false), or null when the system hasn't asked yet. */
    mediaAccessStatus: () => Promise<{ camera: boolean | null; microphone: boolean | null }>
  }
  /** Remembered styles, saved styles, the support link and notifications. */
  prefs: {
    load: () => Promise<MemberPrefs>
    saveLast: (kind: StyleKind, style: object) => Promise<void>
    savePreset: (kind: StyleKind, name: string, style: object) => Promise<MemberPrefs>
    renamePreset: (kind: StyleKind, id: string, name: string) => Promise<MemberPrefs>
    deletePreset: (kind: StyleKind, id: string) => Promise<MemberPrefs>
    saveApp: (update: AppPrefsUpdate) => Promise<MemberPrefs>
    /** Goals, platforms and whether the guided setup is done (onboarding). */
    saveProfile: (update: Partial<CreatorProfile>) => Promise<MemberPrefs>
  }
  support: {
    /** Copies the support report; with `open`, then opens the member's support link or email. */
    report: (jobId: string | null, open: boolean) => Promise<{ copied: true; opened: 'email' | 'link' | null }>
  }
  editor: {
    open: (path: string) => Promise<EditorSession>
    save: (path: string, revision: number, edits: CandidateEdit[]) => Promise<EditorSession>
    run: (path: string, revision: number, id: string, action: 'review' | 'export' | 'export-all' | 'scan-cameras') => Promise<EditorSession>
    cancel: (path: string) => Promise<void>
    replaceSource: (path: string, revision: number, replacement: string) => Promise<EditorSession>
    /** Status counts only; cheap enough for list rows and polling. */
    progress: (path: string) => Promise<EditorProgressSummary>
    freeMedia: (path: string, revision: number) => Promise<EditorSession>
    /** Add a clip from transcript lines, or a copy of `sourceId` (a variant). Main assigns its id. */
    addCandidate: (path: string, revision: number, candidate: CandidateEdit, sourceId?: string) => Promise<EditorSession>
    /** Hook ideas from the clip's own words, graded with the hook rubric. Uses the OpenRouter key. */
    suggestHooks: (path: string, revision: number, id: string) => Promise<{ hooks: HookIdea[] }>
    /** Main asks the open editor to save before a close or quit continues. */
    onSaveBeforeClose: (callback: () => void) => () => void
    closeReady: (saved: boolean) => Promise<void>
    /** What opening an Automatic run (or a project made from one) in the editor involves. */
    automaticInfo: (path: string) => Promise<AutomaticEditInfo>
    /** Make the run's editor project from its clips, or get its video back. `localFile`: a video the member chose. */
    prepareAutomatic: (path: string, localFile?: string) => Promise<AutomaticEditInfo>
    /** The running editor operation and its progress, also before a run has an editor project. */
    operationStatus: (path: string) => Promise<{ operation: EditorSession['operation']; progress?: EditorSession['progress'] }>
  }
  edits: { inspect: (outputDir: string) => Promise<EditAudit> }
  models: { list: (refresh?: boolean) => Promise<OpenRouterCatalog> }
  automations: {
    reviewContent: (id: string, contentId: string, returnToQueue: boolean) => Promise<AutomationReviewResult>
    acknowledgeWarnings: (id: string | null, contentId?: string) => Promise<Automation[]>
    dismissMetadataError: (id: string, contentId: string) => Promise<Automation[]>
    libraryClip: (id: string, contentId: string) => Promise<LibraryClipTarget | null>
    showInFolder: (id: string, contentId: string) => Promise<boolean>
    reorder: (id: string, contentId: string, beforeId: string | null) => Promise<Automation[]>
    enhancementGroups: (id: string) => Promise<AutomationSourceGroup[]>
    enhanceBatch: (id: string, contentIds: string[], key: string, guidance?: string) => Promise<AutomationBatchResult>
    source: (id: string, contentId: string) => Promise<AutomationSourceContext | null>
    enhance: (id: string, contentId: string, options: { source?: AutomationSourceContext | null; research: boolean }) => Promise<Automation[]>
    resolveDraft: (id: string, contentId: string, draftId: string, apply: boolean) => Promise<Automation[]>
    list: () => Promise<Automation[]>
    create: (name: string) => Promise<Automation[]>
    update: (id: string, update: AutomationUpdate) => Promise<Automation[]>
    delete: (id: string) => Promise<Automation[]>
    retryContent: (id: string, contentId: string) => Promise<Automation[]>
    run: (id: string) => Promise<Automation[]>
    /** Cancels the clip's post scheduled ahead with Zernio and returns it to the front of the queue. */
    unscheduleContent: (id: string, contentId: string) => Promise<Automation[]>
    addContent: (id: string) => Promise<Automation[]>
    addLibraryClips: (id: string, outputDir: string, clipIndices: number[]) => Promise<Automation[]>
    updateContent: (id: string, contentId: string, update: { title: string; caption: string; returnToQueue?: boolean }) => Promise<Automation[]>
    prepareTikTokReview: (id: string, contentId: string) => Promise<AutomationTikTokReview>
    approveTikTokReview: (id: string, contentId: string, update: AutomationTikTokReviewUpdate) => Promise<Automation[]>
    removeContent: (id: string, contentId: string) => Promise<Automation[]>
  }
  settings: {
    load: () => Promise<ClipSettings>
    /** Pass true to count again instead of reusing a result from the last few seconds. */
    storageUsage: (fresh?: boolean) => Promise<OutputStorageUsage>
    save: (settings: ClipSettings) => Promise<ClipSettings>
    replaceApiKey: (key: 'openrouterApiKey' | 'zernioApiKey' | 'pexelsApiKey' | 'falApiKey', value: string) => Promise<ClipSettings>
    selectOutputDir: () => Promise<string | null>
  }
  zernio: {
    checkStatus: () => Promise<ZernioStatusCheck>
    overview: () => Promise<ZernioOverview>
    createProfile: (name: string) => Promise<ZernioProfile>
    /** Live accounts from Zernio, or the cached copy with the reason Zernio couldn't be read. Never rejects for Zernio failures. */
    sync: () => Promise<ZernioSyncResult>
    /** The last synced accounts, from disk (no network). */
    cachedOverview: () => Promise<ZernioOverview | null>
    /** A sign-in still waiting for the browser, e.g. after the window reloaded. */
    pendingConnect: () => Promise<ZernioPendingConnect | null>
    /**
     * Opens the platform's sign-in in the browser; the outcome arrives via onConnectResult when the
     * result is `pending`. `profileId` null uses the default profile (creating one if needed).
     */
    connect: (platform: ZernioPlatform, profileId: string | null, options?: ZernioConnectOptions) => Promise<ZernioConnectStart>
    cancelConnect: () => Promise<void>
    disconnect: (accountId: string) => Promise<void>
    onConnectResult: (callback: (result: ZernioConnectResult) => void) => () => void
    /** The Zernio key was added, replaced or removed; drop anything from the previous workspace. */
    onReset: (callback: (state: { configured: boolean }) => void) => () => void
    /** Posting clips. Uploads, post creation and links run in the main process. */
    posts: {
      probe: (clipPath: string, durationMs: number | null) => Promise<ClipMediaInfo>
      tiktokCreatorInfo: (accountId: string) => Promise<TikTokCreatorInfo>
      /** Whether the clip has a subtitle file to attach as YouTube captions. */
      subtitles: (clipPath: string) => Promise<ClipSubtitles>
      /** Opens a file dialog for a JPG or PNG cover; null when cancelled. */
      pickCoverImage: () => Promise<{ path: string; sizeBytes: number } | null>
      /** Uploads the clip and creates the post; progress arrives via onProgress. */
      publish: (request: PostClipRequest) => Promise<PostClipResult>
      cancelUpload: (attemptId: string) => Promise<void>
      onProgress: (callback: (progress: PostProgress) => void) => () => void
      list: () => Promise<PostRecord[]>
      /** Re-reads posts whose status can still change, a few per call. `force` includes ones refreshed recently. */
      refresh: (force: boolean) => Promise<PostsRefreshResult>
      /** Fetches views, likes and more from Zernio for published posts, a few at a time and rate-limited. */
      refreshStats: (force: boolean) => Promise<PostStatsRefreshResult>
      /** Average views by grade, hook look and caption style, from stats already fetched. */
      insights: () => Promise<PostInsights>
      cancel: (postId: string) => Promise<PostRecord[]>
      reschedule: (postId: string, scheduledFor: string, timezone: string) => Promise<PostRecord[]>
      retry: (postId: string) => Promise<PostRecord[]>
      dismiss: (postId: string) => Promise<PostRecord[]>
      open: (postId: string, targetIndex: number) => Promise<void>
      openTikTokLegal: (key: TikTokLegalLink) => Promise<void>
    }
  }
  job: {
    /** Queues a clipping run; it starts right away when a slot is free (`queued: false`). */
    start: (config: ClipJobRequest) => Promise<{ jobId?: string; queued?: boolean; job?: JobSnapshot; error?: string }>
    /** Queues one job per video (same settings, up to 10); a video that can't start doesn't stop the rest. */
    startMany: (configs: ClipJobRequest[]) => Promise<StartManyJobsResult>
    /** What "More clips from this video" would reuse for a finished Library run. */
    moreClipsInfo: (outputDir: string) => Promise<MoreClipsInfo>
    /** Starts More clips: the run's saved transcript is reused when it still matches the video. */
    moreClips: (outputDir: string, choices: MoreClipsChoices) => Promise<{ jobId?: string; queued?: boolean; job?: JobSnapshot; error?: string; note?: string }>
    cancel: (jobId: string) => Promise<boolean>
    /** Every job the main process knows about this session, newest first. */
    list: () => Promise<JobSnapshot[]>
    /** Forget a finished job for this session; its run folder stays in the library. */
    dismiss: (jobId: string) => Promise<boolean>
    /** A fresh snapshot each time any job changes. */
    onUpdate: (callback: (job: JobSnapshot) => void) => () => void
  }
  history: {
    setFavorite: (outputDir: string, favorite: boolean) => Promise<boolean>
    delete: (outputDir: string) => Promise<void>
    deleteClips: (outputDir: string, indices: number[]) => Promise<JobOutput>
    postingStatus: (outputDir: string) => Promise<LibraryClipPostingStatus[]>
    /** Posted counts for many runs at once, for the Library list. */
    postingSummary: (outputDirs: string[]) => Promise<LibraryRunPostingCounts[]>
    /** Not-posted clips from every Library run (Ready to post). */
    readyToPost: () => Promise<ReadyToPostResult>
    setPosted: (outputDir: string, clipIndex: number, posted: boolean) => Promise<boolean>
    metadataSource: (outputDir: string, clipIndex: number) => Promise<AutomationSourceContext | null>
    enhanceMetadata: (outputDir: string, clipIndex: number, options: LibraryEnhancementOptions) => Promise<MetadataEnhancement>
    list: () => Promise<HistoryEntry[]>
    getJob: (outputDir: string) => Promise<Record<string, unknown> | null>
  }
  thumbnails: {
    generate: (videoPath: string, seekSeconds?: number) => Promise<string | null>
  }
  shell: {
    /** Opens a local path with its default app, or an http(s) URL in the browser. */
    openPath: (path: string) => Promise<boolean>
    showItemInFolder: (path: string) => Promise<boolean>
  }
  dialog: {
    selectVideo: () => Promise<string | null>
    /** Several videos at once (up to 10); empty when cancelled. */
    selectVideos: () => Promise<string[]>
  }
  /** Avatar Studio: avatar library, scripts and video generation. */
  avatars: {
    list: () => Promise<AvatarSummary[]>
    /** Opens a file dialog in main; null when cancelled. */
    pickPhoto: () => Promise<{ draftId: string; path: string } | null>
    generateFaces: (description: string) => Promise<{ draftId: string; path: string }[]>
    /** "AI version of me": new pictures of the person in a chosen photo (a draft or an avatar's picture). */
    restyle: (source: { draftId: string } | { avatarId: string }, look: string, detail: string, consent: boolean) => Promise<{ draftId: string; path: string }[]>
    /** Generate the avatar's missing silent reaction clips (a few minutes); failed ones are named. */
    makeReactions: (id: string) => Promise<{ avatars: AvatarSummary[]; made: number; failed: string[]; error?: string }>
    /** Opens a file dialog in main; null when cancelled. */
    uploadReaction: (id: string, kind: string) => Promise<AvatarSummary[] | null>
    removeReaction: (id: string, kind: string) => Promise<AvatarSummary[]>
    /** Replace an avatar's picture with a chosen draft; its voice stays. */
    setPortrait: (id: string, draftId: string) => Promise<AvatarSummary[]>
    /** Switch to one of the avatar's saved pictures (its own photo or an AI version). */
    usePicture: (id: string, file: string) => Promise<AvatarSummary[]>
    removePicture: (id: string, file: string) => Promise<AvatarSummary[]>
    /** Opens a file dialog to add another photo of yourself; null when cancelled. */
    addPhoto: (id: string) => Promise<AvatarSummary[] | null>
    create: (input: { draftId: string; name: string; kind: 'self' | 'ai'; description: string; voice: unknown; consent: boolean; pictureSource?: 'photo' | 'ai'; keepPhotoDraftId?: string }) => Promise<AvatarSummary[]>
    update: (id: string, patch: { name?: string; voice?: unknown }) => Promise<AvatarSummary[]>
    remove: (id: string) => Promise<AvatarSummary[]>
    /** Opens a file dialog in main; null when cancelled. */
    cloneVoice: (id: string, consent: boolean) => Promise<AvatarSummary[] | null>
    writeScript: (request: { topic: string; niche: string; seconds: number; style: 'talking' | 'cinematic'; brandIdentityId?: string | null }) => Promise<AvatarScript>
    render: (request: unknown) => Promise<AvatarRenderStatus>
    /** Restage a video the user picked with dialog.selectVideo using an avatar. */
    recreate: (request: unknown) => Promise<AvatarRenderStatus>
    cancelRender: () => Promise<boolean>
    renderStatus: () => Promise<AvatarRenderStatus | null>
    onStatus: (callback: (status: AvatarRenderStatus) => void) => () => void
  }
  /** Short voice previews (MP3 bytes), cached after the first play. */
  voices: {
    sample: (request: { kind: 'avatar'; voice: unknown; avatarId?: string } | { kind: 'remix'; voice: string }) => Promise<Uint8Array>
  }
  /** Brand identities: what a brand believes, imported or pasted in; Remix writes takes from them. */
  brandIdentities: {
    list: () => Promise<BrandIdentity[]>
    save: (input: { id?: string; name: string; text: string; look?: BrandLook }) => Promise<BrandIdentity[]>
    remove: (id: string) => Promise<BrandIdentity[]>
    /** Opens a file dialog in main; null when cancelled. */
    importFile: () => Promise<{ name: string; text: string; truncated: boolean } | null>
    /** Opens an image dialog in main and stores the logo (saved with the brand); null when cancelled. */
    chooseLogo: () => Promise<{ logo: string; path: string } | null>
  }
  /** Remix: commentary videos built on someone else's viral moments. */
  remix: {
    /** Plans the remixes; the status moves to 'review' with drafts to approve. */
    start: (request: RemixRequest) => Promise<RemixStatus>
    /** Renders the approved drafts (with edits). */
    render: (edits: RemixEdit[]) => Promise<RemixStatus>
    /** Drops the plan waiting for review. */
    discard: () => Promise<boolean>
    cancel: () => Promise<boolean>
    status: () => Promise<RemixStatus | null>
    onStatus: (callback: (status: RemixStatus) => void) => () => void
    /** Me, on camera: ask for the camera and microphone (macOS asks once). */
    mediaAccess: () => Promise<{ camera: boolean; microphone: boolean }>
    /** The take's moment, to play while recording a reaction. */
    /** The take's moment (or screenshot), to show while recording. */
    moment: (draftId: number) => Promise<{ path: string; startSeconds: number; endSeconds: number; kind: 'video' | 'image' }>
    /** Write the headline and caption from the recorded take. Moment + my take: for these takes (all recorded ones when omitted). */
    write: (draftIds?: number[]) => Promise<RemixStatus>
    /** Moment + my take: the moment's own start and end (inside its range). */
    momentBounds: (draftId: number, startMs: number, endMs: number) => Promise<RemixDraft>
    /** Moment + my take: find another moment in this range (one small paid call). */
    anotherMoment: (draftId: number) => Promise<RemixDraft>
    /** Moment + my take: three talking points for the take (one small paid call). */
    talkingPoints: (draftId: number) => Promise<RemixDraft>
    /** Moment + my take: read the playback time from a screenshot of a player (one small paid call); null when none was read. */
    readTimecode: (bytes: Uint8Array) => Promise<TimecodeRead | null>
    /** Re-make a finished remix with new hook text, look, captions or box size (no AI cost). */
    recompose: (outputDir: string, clipIndex: number, edit: { headline: string; headlineLook: HeadlineLook; includeCaptions: boolean; captionPreset: string; split: number | null }) => Promise<{ output: JobOutput | null; note: string | null }>
    /** Choose a screenshot for an article-or-post remix. */
    selectImage: () => Promise<string | null>
    /** Library → "Remix this clip": that clip's video as the source file, and its creator when known. */
    libraryClip: (outputDir: string, clipIndex: number) => Promise<{ path: string; creator: string }>
    recordings: () => Promise<RemixRecordings>
    recordingBegin: (draftId: number, part: RecordingPart, mime: string) => Promise<string>
    recordingAppend: (token: string, chunk: Uint8Array) => Promise<void>
    /** offsetSeconds: where the moment started in the recording (reactions). Pause & react: the recorder's log of pauses and plays. */
    recordingFinish: (token: string, offsetSeconds: number | null, pause?: { events: PauseEvent[]; durationMs: number }) => Promise<RemixRecordings>
    /** Pause & react: the part of their video to react to (a phone recording's pauses are found again). */
    trim: (draftId: number, startMs: number, endMs: number) => Promise<{ draft: RemixDraft; view: PauseView | null }>
    /** Pause & react: the take's timeline and adjustments; null before anything is recorded. */
    pauseView: () => Promise<PauseView | null>
    /** Pause & react, phone recordings: nudge the start, ignore short pauses or plays, flip stretches. */
    pauseSettings: (settings: PauseSettings) => Promise<PauseView>
    recordingAbort: (token: string) => Promise<void>
    removeRecording: (draftId: number, part: RecordingPart) => Promise<RemixRecordings>
    /** Opens a file dialog; null when cancelled. */
    uploadRecording: (draftId: number, part: RecordingPart) => Promise<RemixRecordings | null>
  }
  /** Gameplay background library (file names only). */
  backgrounds: {
    list: () => Promise<string[]>
    add: () => Promise<string[]>
    remove: (name: string) => Promise<string[]>
  }
  clips: {
    bulkExport: (clips: { path: string; name: string }[]) => Promise<{ success: boolean; count: number; failedCount: number; destDir?: string }>
    /** The clips as one .zip, saved where the member picks (destDir is the .zip's path). */
    exportZip: (clips: { path: string; name: string }[], zipName: string) => Promise<{ success: boolean; count: number; failedCount: number; destDir?: string }>
    /** Add, switch (an id) or remove (null) the call to action at the end of one clip. */
    setCta: (outputDir: string, clipIndex: number, ctaId: string | null) => Promise<JobOutput>
  }
  /** Call-to-action library: short videos or images added to the end of clips. */
  ctas: {
    list: () => Promise<CtaSummary[]>
    /** Opens a file dialog; null when cancelled. */
    add: (name?: string) => Promise<CtaSummary[] | null>
    update: (id: string, patch: { name?: string; seconds?: number }) => Promise<CtaSummary[]>
    remove: (id: string) => Promise<CtaSummary[]>
  }
  system: {
    isPackaged: () => Promise<boolean>
    checkTools: () => Promise<ToolStatus>
  }
  diagnostics: {
    getLogPath: () => Promise<string>
    openLogFolder: () => Promise<boolean>
  }
  update: {
    getState: () => Promise<UpdateState>
    /** Every change to the update state, from background checks too. */
    onState: (cb: (state: UpdateState) => void) => () => void
    /** Help → Check for Updates… asks the window to show the Updates row. */
    onShow: (cb: () => void) => () => void
    /** Check now; resolves with the state once the check finishes. */
    check: () => Promise<UpdateState>
    /** Quit and install the downloaded update, then reopen CreatorClips. */
    install: () => Promise<boolean>
    /** macOS: move the app out of the disk image or Downloads so it can update. */
    moveToApplications: () => Promise<boolean>
    /** The GitHub release page for the new version (or this one). */
    openReleaseNotes: () => Promise<boolean>
  }
  changelog: {
    /** Help → Changelog asks the window to show the changelog. */
    onShow: (cb: () => void) => () => void
  }
  /** AI spending: the app's own ledger of what paid runs cost, the OpenRouter balance and the monthly limit. */
  spending: {
    overview: () => Promise<SpendOverview>
    /** null when no OpenRouter key is saved. Cached a few minutes unless `force`. */
    balance: (force?: boolean) => Promise<OpenRouterBalance | null>
    /** '' clears the limit. Resolves with the new overview. */
    setLimit: (value: string) => Promise<SpendOverview>
    onChange: (cb: () => void) => () => void
    /** A provider said the credit ran out. */
    onOutOfCredits: (cb: (provider: SpendProvider) => void) => () => void
    /**
     * Shows the spending check before a paid run starts (low balance, monthly limit).
     * Resolve true for "Start anyway" (offered for a low balance only).
     */
    setGateHandler: (handler: ((gate: SpendGate) => Promise<boolean>) | null) => void
  }
  storage: {
    /** Size on disk of each Library run (cached by main until the run changes). */
    runSizes: (outputDirs: string[]) => Promise<RunSize[]>
    cleanupPlan: (filters: CleanupFilters) => Promise<CleanupPlan>
    /** Removes the chosen groups; main rebuilds the plan itself. */
    cleanup: (groups: CleanupGroupId[], filters: CleanupFilters) => Promise<CleanupResult>
    freeSpace: () => Promise<FreeSpace>
    folderChangeInfo: () => Promise<FolderChangeInfo>
    previousFolders: () => Promise<PreviousFolder[]>
    moveFolder: (folder: string) => Promise<MoveResult>
    forgetFolder: (folder: string) => Promise<void>
    onMoveProgress: (callback: (progress: MoveProgress) => void) => () => void
  }
}

/** An earlier output folder whose runs the Library still shows. */
export interface PreviousFolder {
  folder: string
  exists: boolean
  runs: HistoryEntry[]
  /** Other CreatorClips folders there (unfinished runs, Avatar Studio) that a move also brings. */
  otherFolders: number
}

let gateHandler: ((gate: SpendGate) => Promise<boolean>) | null = null

/**
 * A call that starts paid work. When the main process stops it at the spending
 * check, the window is asked; "Start anyway" (low balance only) sends it again.
 */
async function paid<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (error) {
    const gate = decodeSpendGate((error as Error | null)?.message)
    if (!gate) throw error
    let proceed = false
    try { proceed = gateHandler ? await gateHandler(gate) === true : false } catch { proceed = false }
    if (!proceed || !gate.canOverride) {
      throw new Error(gate.reason === 'limit' ? 'Not started: this would go over your monthly AI spending limit (Settings → Spending).' : 'Not started: your OpenRouter balance is low. Add credits, or choose Start anyway.')
    }
    await ipcRenderer.invoke('spend:allowOnce', channel)
    return ipcRenderer.invoke(channel, ...args)
  }
}

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T): void => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: BridgeClipAPI = {
  source: { youtubePreview: (url, details = false) => ipcRenderer.invoke('source:youtubePreview', url, details) },
  assistant: {
    status: (fresh = false) => ipcRenderer.invoke('assistant:status', fresh),
    onStatus: (callback) => subscribe('assistant:status', callback),
    preferences: () => ipcRenderer.invoke('assistant:preferences'),
    savePreferences: (preferences) => ipcRenderer.invoke('assistant:savePreferences', preferences),
    conversations: () => ipcRenderer.invoke('assistant:conversations'),
    conversation: (id) => ipcRenderer.invoke('assistant:conversation', id),
    deleteConversation: (id) => ipcRenderer.invoke('assistant:deleteConversation', id),
    running: () => ipcRenderer.invoke('assistant:running'),
    send: (message) => ipcRenderer.invoke('assistant:send', message),
    stop: (conversationId) => ipcRenderer.invoke('assistant:stop', conversationId),
    approve: (requestId, allowed) => ipcRenderer.invoke('assistant:approve', requestId, allowed),
    copyCommand: (provider, which) => ipcRenderer.invoke('assistant:copyCommand', provider, which),
    onEvent: (callback) => subscribe('assistant:event', callback),
    signIn: {
      start: (provider) => ipcRenderer.invoke('assistant:signIn:start', provider),
      state: (provider) => ipcRenderer.invoke('assistant:signIn:state', provider),
      submitCode: (provider, code) => ipcRenderer.invoke('assistant:signIn:code', provider, code),
      cancel: (provider) => ipcRenderer.invoke('assistant:signIn:cancel', provider),
      openPage: (provider) => ipcRenderer.invoke('assistant:signIn:open', provider),
      onState: (callback) => subscribe('assistant:signIn', callback)
    }
  },
  app: {
    onDataChanged: (callback) => subscribe('app:dataChanged', callback),
    onNavigate: (callback) => subscribe('app:navigate', callback),
    onOpenPage: (callback) => subscribe('app:openPage', callback),
    mediaAccessStatus: () => ipcRenderer.invoke('app:mediaAccessStatus')
  },
  prefs: {
    load: () => ipcRenderer.invoke('prefs:load'),
    saveLast: (kind, style) => ipcRenderer.invoke('prefs:saveLast', kind, style),
    savePreset: (kind, name, style) => ipcRenderer.invoke('prefs:savePreset', kind, name, style),
    renamePreset: (kind, id, name) => ipcRenderer.invoke('prefs:renamePreset', kind, id, name),
    deletePreset: (kind, id) => ipcRenderer.invoke('prefs:deletePreset', kind, id),
    saveApp: (update) => ipcRenderer.invoke('prefs:saveApp', update),
    saveProfile: (update) => ipcRenderer.invoke('prefs:saveProfile', update)
  },
  support: {
    report: (jobId, open) => ipcRenderer.invoke('support:report', jobId, open)
  },
  editor: {
    open: (path) => ipcRenderer.invoke('editor:open', path),
    save: (path, revision, edits) => ipcRenderer.invoke('editor:save', path, revision, edits),
    run: (path, revision, id, action) => ipcRenderer.invoke('editor:run', path, revision, id, action),
    cancel: (path) => ipcRenderer.invoke('editor:cancel', path),
    replaceSource: (path, revision, replacement) => ipcRenderer.invoke('editor:replaceSource', path, revision, replacement),
    progress: (path) => ipcRenderer.invoke('editor:progress', path),
    freeMedia: (path, revision) => ipcRenderer.invoke('editor:freeMedia', path, revision),
    addCandidate: (path, revision, candidate, sourceId) => ipcRenderer.invoke('editor:addCandidate', path, revision, candidate, sourceId),
    suggestHooks: (path, revision, id) => ipcRenderer.invoke('editor:suggestHooks', path, revision, id),
    onSaveBeforeClose: (callback) => subscribe<void>('editor:saveBeforeClose', () => callback()),
    closeReady: (saved) => ipcRenderer.invoke('editor:closeReady', saved),
    automaticInfo: (path) => ipcRenderer.invoke('editor:automaticInfo', path),
    prepareAutomatic: (path, localFile) => ipcRenderer.invoke('editor:prepareAutomatic', path, localFile),
    operationStatus: (path) => ipcRenderer.invoke('editor:operationStatus', path)
  },
  edits: { inspect: (outputDir) => ipcRenderer.invoke('edits:inspect', outputDir) },
  models: { list: (refresh = false) => ipcRenderer.invoke('models:list', refresh) },
  automations: {
    reviewContent: (id, contentId, returnToQueue) => ipcRenderer.invoke('automations:reviewContent', id, contentId, returnToQueue),
    acknowledgeWarnings: (id, contentId) => ipcRenderer.invoke('automations:acknowledgeWarnings', id, contentId),
    dismissMetadataError: (id, contentId) => ipcRenderer.invoke('automations:dismissMetadataError', id, contentId),
    libraryClip: (id, contentId) => ipcRenderer.invoke('automations:libraryClip', id, contentId),
    showInFolder: (id, contentId) => ipcRenderer.invoke('automations:showInFolder', id, contentId),
    reorder: (id, contentId, beforeId) => ipcRenderer.invoke('automations:reorder', id, contentId, beforeId),
    enhancementGroups: (id) => ipcRenderer.invoke('automations:enhancementGroups', id),
    enhanceBatch: (id, contentIds, key, guidance) => ipcRenderer.invoke('automations:enhanceBatch', id, contentIds, key, guidance),
    source: (id, contentId) => ipcRenderer.invoke('automations:source', id, contentId),
    enhance: (id, contentId, options) => ipcRenderer.invoke('automations:enhance', id, contentId, options),
    resolveDraft: (id, contentId, draftId, apply) => ipcRenderer.invoke('automations:resolveDraft', id, contentId, draftId, apply),
    list: () => ipcRenderer.invoke('automations:list'),
    create: (name) => ipcRenderer.invoke('automations:create', name),
    update: (id, update) => ipcRenderer.invoke('automations:update', id, update),
    delete: (id) => ipcRenderer.invoke('automations:delete', id),
    retryContent: (id, contentId) => ipcRenderer.invoke('automations:retryContent', id, contentId),
    run: (id) => ipcRenderer.invoke('automations:run', id),
    unscheduleContent: (id, contentId) => ipcRenderer.invoke('automations:unscheduleContent', id, contentId),
    addContent: (id) => ipcRenderer.invoke('automations:addContent', id),
    addLibraryClips: (id, outputDir, clipIndices) => ipcRenderer.invoke('automations:addLibraryClips', id, outputDir, clipIndices),
    updateContent: (id, contentId, update) => ipcRenderer.invoke('automations:updateContent', id, contentId, update),
    prepareTikTokReview: (id, contentId) => ipcRenderer.invoke('automations:prepareTikTokReview', id, contentId),
    approveTikTokReview: (id, contentId, update) => ipcRenderer.invoke('automations:approveTikTokReview', id, contentId, update),
    removeContent: (id, contentId) => ipcRenderer.invoke('automations:removeContent', id, contentId)
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    storageUsage: (fresh) => ipcRenderer.invoke('settings:storageUsage', fresh === true),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    replaceApiKey: (key, value) => ipcRenderer.invoke('settings:replaceApiKey', key, value),
    selectOutputDir: () => ipcRenderer.invoke('settings:selectOutputDir')
  },
  zernio: {
    checkStatus: () => ipcRenderer.invoke('zernio:checkStatus'),
    overview: () => ipcRenderer.invoke('zernio:overview'),
    createProfile: (name) => ipcRenderer.invoke('zernio:profiles:create', name),
    sync: () => ipcRenderer.invoke('zernio:sync'),
    cachedOverview: () => ipcRenderer.invoke('zernio:cachedOverview'),
    pendingConnect: () => ipcRenderer.invoke('zernio:pendingConnect'),
    connect: (platform, profileId, options) => ipcRenderer.invoke('zernio:connect', platform, profileId, options),
    cancelConnect: () => ipcRenderer.invoke('zernio:cancelConnect'),
    disconnect: (accountId) => ipcRenderer.invoke('zernio:disconnect', accountId),
    onConnectResult: (callback) => subscribe('zernio:connectResult', callback),
    onReset: (callback) => subscribe('zernio:reset', callback),
    posts: {
      probe: (clipPath, durationMs) => ipcRenderer.invoke('zernio:posts:probe', clipPath, durationMs),
      tiktokCreatorInfo: (accountId) => ipcRenderer.invoke('zernio:posts:tiktokCreatorInfo', accountId),
      subtitles: (clipPath) => ipcRenderer.invoke('zernio:posts:subtitles', clipPath),
      pickCoverImage: () => ipcRenderer.invoke('zernio:posts:pickCoverImage'),
      publish: (request) => ipcRenderer.invoke('zernio:posts:publish', request),
      cancelUpload: (attemptId) => ipcRenderer.invoke('zernio:posts:cancelUpload', attemptId),
      onProgress: (callback) => subscribe('zernio:postProgress', callback),
      list: () => ipcRenderer.invoke('zernio:posts:list'),
      refresh: (force) => ipcRenderer.invoke('zernio:posts:refresh', force),
      refreshStats: (force) => ipcRenderer.invoke('zernio:posts:refreshStats', force),
      insights: () => ipcRenderer.invoke('zernio:posts:insights'),
      cancel: (postId) => ipcRenderer.invoke('zernio:posts:cancel', postId),
      reschedule: (postId, scheduledFor, timezone) => ipcRenderer.invoke('zernio:posts:reschedule', postId, scheduledFor, timezone),
      retry: (postId) => ipcRenderer.invoke('zernio:posts:retry', postId),
      dismiss: (postId) => ipcRenderer.invoke('zernio:posts:dismiss', postId),
      open: (postId, targetIndex) => ipcRenderer.invoke('zernio:posts:open', postId, targetIndex),
      openTikTokLegal: (key) => ipcRenderer.invoke('zernio:posts:openTikTokLegal', key)
    }
  },
  job: {
    start: (config) => paid('job:start', config),
    startMany: (configs) => paid('job:startMany', configs),
    moreClipsInfo: (outputDir) => ipcRenderer.invoke('job:moreClipsInfo', outputDir),
    moreClips: (outputDir, choices) => paid('job:moreClips', outputDir, choices),
    cancel: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
    list: () => ipcRenderer.invoke('jobs:list'),
    dismiss: (jobId) => ipcRenderer.invoke('jobs:dismiss', jobId),
    onUpdate: (callback) => subscribe('jobs:update', callback)
  },
  history: {
    setFavorite: (outputDir, favorite) => ipcRenderer.invoke('history:setFavorite', outputDir, favorite),
    delete: (outputDir) => ipcRenderer.invoke('history:delete', outputDir),
    deleteClips: (outputDir, indices) => ipcRenderer.invoke('history:deleteClips', outputDir, indices),
    postingStatus: (outputDir) => ipcRenderer.invoke('history:postingStatus', outputDir),
    postingSummary: (outputDirs) => ipcRenderer.invoke('history:postingSummary', outputDirs),
    readyToPost: () => ipcRenderer.invoke('history:readyToPost'),
    setPosted: (outputDir, clipIndex, posted) => ipcRenderer.invoke('history:setPosted', outputDir, clipIndex, posted),
    metadataSource: (outputDir, clipIndex) => ipcRenderer.invoke('history:metadataSource', outputDir, clipIndex),
    enhanceMetadata: (outputDir, clipIndex, options) => ipcRenderer.invoke('history:enhanceMetadata', outputDir, clipIndex, options),
    list: () => ipcRenderer.invoke('history:list'),
    getJob: (outputDir) => ipcRenderer.invoke('history:getJob', outputDir)
  },
  thumbnails: {
    generate: (videoPath, seekSeconds) => ipcRenderer.invoke('thumbnails:generate', videoPath, seekSeconds)
  },
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    showItemInFolder: (path) => ipcRenderer.invoke('shell:showItemInFolder', path)
  },
  dialog: {
    selectVideo: () => ipcRenderer.invoke('dialog:selectVideo'),
    selectVideos: () => ipcRenderer.invoke('dialog:selectVideos')
  },
  avatars: {
    list: () => ipcRenderer.invoke('avatars:list'),
    pickPhoto: () => ipcRenderer.invoke('avatars:pickPhoto'),
    generateFaces: (description) => paid('avatars:generateFaces', description),
    restyle: (source, look, detail, consent) => paid('avatars:restyle', source, look, detail, consent),
    setPortrait: (id, draftId) => ipcRenderer.invoke('avatars:setPortrait', id, draftId),
    usePicture: (id, file) => ipcRenderer.invoke('avatars:usePicture', id, file),
    removePicture: (id, file) => ipcRenderer.invoke('avatars:removePicture', id, file),
    addPhoto: (id) => ipcRenderer.invoke('avatars:addPhoto', id),
    makeReactions: (id) => paid('avatars:makeReactions', id),
    uploadReaction: (id, kind) => ipcRenderer.invoke('avatars:uploadReaction', id, kind),
    removeReaction: (id, kind) => ipcRenderer.invoke('avatars:removeReaction', id, kind),
    create: (input) => ipcRenderer.invoke('avatars:create', input),
    update: (id, patch) => ipcRenderer.invoke('avatars:update', id, patch),
    remove: (id) => ipcRenderer.invoke('avatars:remove', id),
    cloneVoice: (id, consent) => paid('avatars:cloneVoice', id, consent),
    writeScript: (request) => ipcRenderer.invoke('avatars:writeScript', request),
    render: (request) => paid('avatars:render', request),
    recreate: (request) => paid('avatars:recreate', request),
    cancelRender: () => ipcRenderer.invoke('avatars:cancelRender'),
    renderStatus: () => ipcRenderer.invoke('avatars:renderStatus'),
    onStatus: (callback) => subscribe('avatars:status', callback)
  },
  voices: {
    sample: (request) => ipcRenderer.invoke('voices:sample', request)
  },
  brandIdentities: {
    list: () => ipcRenderer.invoke('brandIdentities:list'),
    save: (input) => ipcRenderer.invoke('brandIdentities:save', input),
    remove: (id) => ipcRenderer.invoke('brandIdentities:remove', id),
    importFile: () => ipcRenderer.invoke('brandIdentities:importFile'),
    chooseLogo: () => ipcRenderer.invoke('brandIdentities:chooseLogo')
  },
  remix: {
    start: (request) => paid('remix:start', request),
    render: (edits) => paid('remix:render', edits),
    discard: () => ipcRenderer.invoke('remix:discard'),
    cancel: () => ipcRenderer.invoke('remix:cancel'),
    status: () => ipcRenderer.invoke('remix:status'),
    onStatus: (callback) => subscribe('remix:status', callback),
    mediaAccess: () => ipcRenderer.invoke('remix:mediaAccess'),
    moment: (draftId) => ipcRenderer.invoke('remix:moment', draftId),
    write: (draftIds) => paid('remix:write', draftIds),
    momentBounds: (draftId, startMs, endMs) => ipcRenderer.invoke('remix:momentBounds', draftId, startMs, endMs),
    anotherMoment: (draftId) => paid('remix:anotherMoment', draftId),
    talkingPoints: (draftId) => paid('remix:talkingPoints', draftId),
    readTimecode: (bytes) => paid('remix:readTimecode', bytes),
    recompose: (outputDir, clipIndex, edit) => ipcRenderer.invoke('remix:recompose', outputDir, clipIndex, edit),
    selectImage: () => ipcRenderer.invoke('remix:selectImage'),
    libraryClip: (outputDir, clipIndex) => ipcRenderer.invoke('library:remixSource', outputDir, clipIndex),
    recordings: () => ipcRenderer.invoke('remix:recordings'),
    recordingBegin: (draftId, part, mime) => ipcRenderer.invoke('remix:recordingBegin', draftId, part, mime),
    recordingAppend: (token, chunk) => ipcRenderer.invoke('remix:recordingAppend', token, chunk),
    recordingFinish: (token, offsetSeconds, pause) => ipcRenderer.invoke('remix:recordingFinish', token, offsetSeconds, pause),
    trim: (draftId, startMs, endMs) => ipcRenderer.invoke('remix:trim', draftId, startMs, endMs),
    pauseView: () => ipcRenderer.invoke('remix:pauseView'),
    pauseSettings: (settings) => ipcRenderer.invoke('remix:pauseSettings', settings),
    recordingAbort: (token) => ipcRenderer.invoke('remix:recordingAbort', token),
    removeRecording: (draftId, part) => ipcRenderer.invoke('remix:removeRecording', draftId, part),
    uploadRecording: (draftId, part) => ipcRenderer.invoke('remix:uploadRecording', draftId, part)
  },
  backgrounds: {
    list: () => ipcRenderer.invoke('backgrounds:list'),
    add: () => ipcRenderer.invoke('backgrounds:add'),
    remove: (name) => ipcRenderer.invoke('backgrounds:remove', name)
  },
  clips: {
    bulkExport: (clips) => ipcRenderer.invoke('clips:bulkExport', clips),
    exportZip: (clips, zipName) => ipcRenderer.invoke('clips:exportZip', clips, zipName),
    setCta: (outputDir, clipIndex, ctaId) => ipcRenderer.invoke('clips:setCta', outputDir, clipIndex, ctaId)
  },
  ctas: {
    list: () => ipcRenderer.invoke('ctas:list'),
    add: (name) => ipcRenderer.invoke('ctas:add', name),
    update: (id, patch) => ipcRenderer.invoke('ctas:update', id, patch),
    remove: (id) => ipcRenderer.invoke('ctas:remove', id)
  },
  system: {
    isPackaged: () => ipcRenderer.invoke('system:isPackaged'),
    checkTools: () => ipcRenderer.invoke('system:checkTools')
  },
  diagnostics: {
    getLogPath: () => ipcRenderer.invoke('diagnostics:getLogPath'),
    openLogFolder: () => ipcRenderer.invoke('diagnostics:openLogFolder')
  },
  update: {
    getState: () => ipcRenderer.invoke('update:getState'),
    onState: (callback) => subscribe('update:state', callback),
    onShow: (callback) => subscribe('update:show', () => callback()),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    moveToApplications: () => ipcRenderer.invoke('update:moveToApplications'),
    openReleaseNotes: () => ipcRenderer.invoke('update:openReleaseNotes')
  },
  changelog: {
    onShow: (callback) => subscribe('changelog:show', () => callback())
  },
  spending: {
    overview: () => ipcRenderer.invoke('spend:overview'),
    balance: (force) => ipcRenderer.invoke('spend:balance', force === true),
    setLimit: (value) => ipcRenderer.invoke('spend:setLimit', value),
    onChange: (callback) => subscribe('spend:changed', () => callback()),
    onOutOfCredits: (callback) => subscribe('spend:outOfCredits', callback),
    setGateHandler: (handler) => { gateHandler = typeof handler === 'function' ? handler : null }
  },
  storage: {
    runSizes: (outputDirs) => ipcRenderer.invoke('storage:runSizes', outputDirs),
    cleanupPlan: (filters) => ipcRenderer.invoke('storage:cleanupPlan', filters),
    cleanup: (groups, filters) => ipcRenderer.invoke('storage:cleanup', groups, filters),
    freeSpace: () => ipcRenderer.invoke('storage:freeSpace'),
    folderChangeInfo: () => ipcRenderer.invoke('storage:folderChangeInfo'),
    previousFolders: () => ipcRenderer.invoke('storage:previousFolders'),
    moveFolder: (folder) => ipcRenderer.invoke('storage:moveFolder', folder),
    forgetFolder: (folder) => ipcRenderer.invoke('storage:forgetFolder', folder),
    onMoveProgress: (callback) => subscribe('storage:moveProgress', callback)
  }
}

contextBridge.exposeInMainWorld('bridgeclip', api)
