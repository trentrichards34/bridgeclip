import { useEffect, useState } from 'react'
import { Check, Copy, FolderDown, FolderOpen, MessageSquare, Mic, Sparkles, Terminal, Timer } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { IconTile } from '../components/ui/IconTile'
import { Page as PageColumn } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { MakerAside, MakerLayout, MakerSection } from '../components/maker/Maker'

/** What to say in Claude Code the first time. */
export const SETUP_PROMPT = 'set up the AI video skill'

/** Ways to ask for a reel (from the skill's own START HERE). */
export const REEL_PROMPTS: readonly { prompt: string; note?: string }[] = [
  { prompt: 'Make a reel about 3 Notion templates every freelancer needs.' },
  { prompt: 'Use my script: <paste your script>', note: 'Claude uses your words as they are.' },
  { prompt: 'Make a 3D explainer: how wireless charging actually works.', note: 'Paper-and-ink is the default look; you can ask for others.' },
  { prompt: 'Make my presenter look like me', note: 'Send a photo or describe yourself.' }
]

/**
 * AI explainers: animated, voiced explainer reels made by a skill that runs in the member's own Claude (Claude Code).
 * This page explains why, lists what they need, and saves the skill folder to their computer; CreatorClips never runs it.
 */
export function AiVideoPage(): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void getApi().aiVideoSkill.info().then((info) => { if (live) setAvailable(info.available) }).catch(() => { if (live) setAvailable(false) })
    return () => { live = false }
  }, [])

  const save = async (): Promise<void> => {
    setError(null); setSaving(true)
    try {
      const path = await getApi().aiVideoSkill.save()
      if (path) setSaved(path)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }
  const reveal = async (): Promise<void> => {
    if (!saved) return
    const shown = await getApi().aiVideoSkill.reveal(saved).catch(() => false)
    if (!shown) setError('That folder has moved or was deleted. Save the skill again.')
  }

  const main = (<>
    {error && <Callout tone="danger" onDismiss={() => setError(null)}>{error}</Callout>}

    <Panel data-testid="ai-video-why">
      <PanelHeader icon={<IconTile tone="accent"><Sparkles /></IconTile>} title="Why it runs in your Claude"
        description="Your own Claude does the work, so each video costs nothing extra." />
      <div className="mt-3 space-y-2 text-sm text-ink-muted">
        <p>Each video is roughly 30-80 minutes of Claude at work: it writes the script, builds custom visuals scene by scene and reviews its own frames before the final render.</p>
        <p>Paid per use, that much AI work adds up fast. In your own Claude it's covered by the plan you already pay for. Making a lot of videos? A Claude Max plan gives you more room than Pro.</p>
        <p className="text-ink-subtle">A one-click version inside CreatorClips may come later.</p>
      </div>
    </Panel>

    <MakerSection number={1} title="Save the skill to my computer" aside="A folder named “AI Video”">
      <Panel>
        <p className="text-sm text-ink-muted">Pick where to keep it, like Documents. CreatorClips copies the skill into a new “AI Video” folder there and never changes a folder you already have.</p>
        {available === false && <Callout tone="warning" className="mt-3">The skill is missing from this copy of CreatorClips. Reinstall CreatorClips, then try again.</Callout>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<FolderDown className="h-4 w-4" />} loading={saving} disabled={available === false} onClick={() => void save()} data-testid="ai-video-save">
            {saved ? 'Save another copy' : 'Save the skill to my computer'}
          </Button>
          {saved && <Button variant="secondary" icon={<FolderOpen className="h-4 w-4" />} onClick={() => void reveal()}>Show in Finder</Button>}
        </div>
        {saved && (
          <Callout tone="success" className="mt-3" data-testid="ai-video-saved">
            Saved to <span className="break-all font-mono text-xs text-ink">{saved}</span>
          </Callout>
        )}
      </Panel>
    </MakerSection>

    <MakerSection number={2} title="Open that folder in Claude Code">
      <Panel className="space-y-2 text-sm text-ink-muted">
        <p>In the Claude desktop app, open the <span className="text-ink">Code</span> tab and choose the “AI Video” folder.</p>
        <p>Or in Terminal, go into the folder and run <code className="font-mono text-xs text-ink">claude</code>.</p>
        {saved && <CopyLine label="Terminal command" text={`cd ${shellQuote(saved)} && claude`} />}
      </Panel>
    </MakerSection>

    <MakerSection number={3} title="Say: set up the AI video skill" aside="About 10 minutes, once">
      <Panel className="space-y-3 text-sm text-ink-muted">
        <CopyLine label="What to say" text={SETUP_PROMPT} />
        <p>Claude checks your computer and walks you through anything missing, one step at a time: Node.js, ffmpeg, Python, a private browser for rendering, your ElevenLabs voice key and picking a voice.</p>
        <p className="text-ink-subtle">Don't paste your ElevenLabs key into the chat: Claude shows you the file to save it in.</p>
      </Panel>
    </MakerSection>

    <MakerSection number={4} title="Ask for a reel">
      <Panel className="space-y-2">
        {REEL_PROMPTS.map(({ prompt, note }) => <CopyLine key={prompt} text={prompt} note={note} />)}
      </Panel>
    </MakerSection>

    <MakerSection number={5} title="Post it">
      <Panel className="space-y-2 text-sm text-ink-muted">
        <p>Your video lands in the folder's <code className="font-mono text-xs text-ink">videos/&lt;topic&gt;/out/</code>, with a caption ready to paste. Post it from there.</p>
        <p>Each reel ends with “Comment KEYWORD”. Use that keyword in your DM automation so commenters get what you promised.</p>
      </Panel>
    </MakerSection>
  </>)

  const aside = (
    <MakerAside label="What you need">
      <ul className="mt-3 space-y-3 text-xs text-ink-muted" data-testid="ai-video-needs">
        <Need icon={<Terminal />} title="A paid Claude plan with Claude Code">The Code tab in the Claude desktop app, or <code className="font-mono text-ink">claude</code> in Terminal.</Need>
        <Need icon={<Mic />} title="An ElevenLabs account for the voice">A 45-second reel uses about 800 characters of voice credit.</Need>
        <Need icon={<Timer />} title="About 10 minutes, once">Claude installs Node.js, ffmpeg, Python and a private browser for you, step by step.</Need>
      </ul>
      <p className="mt-4 border-t border-white/[0.06] pt-3 text-2xs text-ink-subtle" data-testid="ai-video-license">
        The skill is for your own videos and your clients'. Please don't resell or share it: that's its license.
      </p>
    </MakerAside>
  )

  return (
    <PageColumn width="default">
      <PageHeader eyebrow="Studio" title="Animated explainer videos, made by your Claude"
        description="A cartoon presenter, paper-and-ink animation and a voiceover timed word by word: ready-to-post 1080×1920 reels from one prompt." />
      <MakerLayout className="mt-4" main={main} aside={aside} />
    </PageColumn>
  )
}

function Need({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <li className="flex items-start gap-2.5">
      <IconTile size="sm" tone="accent">{icon}</IconTile>
      <div className="min-w-0">
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </li>
  )
}

/** A line to paste into Claude (or Terminal) with a copy button. */
function CopyLine({ text, label, note }: { text: string; label?: string; note?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }
  return (
    <div className="glass-tile flex items-center gap-3 rounded-xl px-3 py-2">
      <MessageSquare aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      <div className="min-w-0 flex-1">
        {label && <p className="text-2xs text-ink-subtle">{label}</p>}
        <p className="break-words font-mono text-xs text-ink">{text}</p>
        {note && <p className="mt-0.5 text-2xs text-ink-subtle">{note}</p>}
      </div>
      <Button size="sm" variant="secondary" aria-label={`Copy “${text}”`} icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** A path quoted for a macOS/Linux shell. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}
