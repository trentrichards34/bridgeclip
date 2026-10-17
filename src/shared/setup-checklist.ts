/**
 * The "Get set up" checklist: each item is checked off from real state (keys
 * saved, the tools check, Zernio accounts, the member's brand identities,
 * call-to-action clips, avatars and Library runs), never from a click.
 */

export type SetupItemId = 'openrouter' | 'tools' | 'posting' | 'brand' | 'cta' | 'avatar' | 'first-clip'

export interface SetupFacts {
  openrouter: boolean
  /** null while the tools check runs. */
  toolsOk: boolean | null
  zernioKey: boolean
  /** Postable accounts connected in Zernio (any profile). */
  postingAccounts: number
  brandIdentities: number
  ctas: number
  avatars: number
  /** Finished Library runs. */
  runs: number
}

export interface SetupItem {
  id: SetupItemId
  title: string
  detail: string
  done: boolean
  optional?: boolean
}

export function setupItems(facts: SetupFacts): SetupItem[] {
  return [
    { id: 'openrouter', title: 'Add your OpenRouter key', detail: 'One key covers transcription and picking the best moments.', done: facts.openrouter },
    {
      id: 'tools', title: 'Pass the system check', done: facts.toolsOk === true,
      detail: facts.toolsOk === null ? 'Checking the tools CreatorClips needs…' : facts.toolsOk ? 'All the tools to download, transcribe and cut video are installed.' : 'Some tools are missing. Settings shows which ones.'
    },
    {
      id: 'posting', title: 'Connect a posting account', done: facts.zernioKey && facts.postingAccounts > 0,
      detail: !facts.zernioKey ? 'Add your Zernio key, then connect TikTok, Instagram or YouTube.' : facts.postingAccounts > 0 ? 'You can post and schedule from CreatorClips.' : 'Your Zernio key is saved. Now connect an account to post to.'
    },
    { id: 'brand', title: 'Set up a brand identity', detail: 'What your brand believes, so Remix and Avatar Studio write in your voice.', done: facts.brandIdentities > 0 },
    { id: 'cta', title: 'Add a call-to-action clip', detail: 'A short video or image added to the end of your clips.', done: facts.ctas > 0 },
    { id: 'avatar', title: 'Make an avatar', detail: 'For Avatar Studio videos and Remix takes with an AI presenter.', done: facts.avatars > 0, optional: true },
    { id: 'first-clip', title: 'Make your first clip', detail: 'Paste a video link on Create and start a run.', done: facts.runs > 0 }
  ]
}

/** Required items left (optional ones never block "all set"). */
export function remainingSetup(items: SetupItem[]): number {
  return items.filter((item) => !item.optional && !item.done).length
}
