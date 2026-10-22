import { JevSettings } from '../components/JevSettings'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookA, Check, ChevronDown, Cpu, FolderOpen, Github, History, Images, Info, KeyRound, ListChecks, Loader2, Music, RefreshCw, ScrollText, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { useSettingsStore } from '../store/use-settings-store'
import { useChangelogStore } from '../store/use-changelog-store'
import { useApiKeyDrafts } from '../hooks/use-api-key-drafts'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { APP_NAME, APP_VERSION, BRIDGEMIND_URL, LICENSE_NAME, PROVIDER_LINKS, REPO_URL } from '../config/brand'
import { SupportSettings } from '../components/SupportReport'
import type { ClipSettings, ToolStatus } from '../../preload/index'
import { ApiKeyInput } from '../components/ApiKeyInput'
import { HeygenKeyCheck } from '../components/HeygenKeyCheck'
import { BridgeClipLogo } from '../components/brand/BridgeClipLogo'
import { Page } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Field, TextArea, TextInput } from '../components/ui/Field'
import { Badge, StatusDot } from '../components/ui/Badge'
import { Select } from '../components/ui/Select'
import { IconTile } from '../components/ui/IconTile'
import { Callout } from '../components/ui/Callout'
import { SettingRow } from '../components/ui/SettingRow'
import { Switch } from '../components/ui/Switch'
import { UpdatesRow } from '../components/Updates'
import { OutputStorage } from '../components/OutputStorage'
import { useOutputFolderChange } from '../components/OutputFolderChange'
import { AssistantSettings } from '../components/assistant/AssistantSettings'
import { useAssistantStore } from '../store/use-assistant-store'
import { takeSettingsSection } from '../lib/settings-focus'
import { SpendingSettings } from '../components/spending/SpendingSettings'
import { SetupChecklist } from '../components/SetupChecklist'
import { MusicSettingsPanel } from '../components/MusicPicker'
import { BrollAiSettingsPanel } from '../components/BrollSourcePicker'
import type { Page as AppPage } from '../components/Sidebar'

type SectionId = 'setup' | 'keys' | 'spending' | 'assistant' | 'jev' | 'vocabulary' | 'music' | 'broll' | 'output' | 'system' | 'about'
type SectionTone = 'success' | 'warning' | 'danger' | 'idle'
type SectionGroup = 'Set up' | 'Your clips' | 'This computer'

/** `showUpdates` changes each time Help → Check for Updates… asks for the Updates row. */
/** Safari and the macOS prompts only exist on a Mac. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

export function SettingsPage({ showUpdates = 0, onNavigate }: { showUpdates?: number; onNavigate?: (page: AppPage) => void }): React.JSX.Element {
  const { outputDirectory, pythonPath, customVocabulary, openrouterConfigured, zernioConfigured, pexelsConfigured, falConfigured, heygenConfigured, sourceContextWebResearch, downloadLoginBrowser, saving, save, toolStatus, toolError, checkTools, checkingTools } =
    useSettingsStore()
  const keys = useApiKeyDrafts()
  const [isPackaged, setIsPackaged] = useState(true)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    getApi().system.isPackaged().then(setIsPackaged).catch(() => {})
  }, [])

  const commit = async (patch: Partial<ClipSettings>, recheck = false): Promise<void> => {
    try {
      await save(patch)
      setSaveError(null)
      setSavedAt(Date.now())
      if (recheck) checkTools()
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save settings'))
    }
  }

  // A new output folder asks what to do with the Library runs in the current one.
  const folderChange = useOutputFolderChange((dir) => commit({ outputDirectory: dir }))
  const lastSaved = Math.max(savedAt ?? 0, keys.savedAt ?? 0)
  const error = saveError ?? keys.error
  const tools = toolRows(toolStatus)
  const toolsChecked = tools.every((row) => row.ok != null)
  const toolsMissing = tools.filter((row) => !row.optional && row.ok === false).length
  const keysMissing = Number(!openrouterConfigured)
  const vocabularyTerms = customVocabulary.split('\n').filter((line) => line.trim()).length
  const assistantConnected = useAssistantStore((state) => Object.values(state.statuses).some((status) => status?.state === 'connected'))

  const sections: { id: SectionId; label: string; icon: ReactNode; tone: SectionTone; group: SectionGroup }[] = [
    ...(onNavigate ? [{ id: 'setup' as const, label: 'Get set up', icon: <ListChecks />, tone: 'idle' as const, group: 'Set up' as const }] : []),
    { id: 'keys', label: 'API keys', icon: <KeyRound />, tone: keysMissing ? 'warning' : 'success', group: 'Set up' },
    { id: 'spending', label: 'Spending', icon: <Wallet />, tone: 'idle', group: 'Set up' },
    { id: 'assistant', label: 'Assistant', icon: <Sparkles />, tone: assistantConnected ? 'success' : 'idle', group: 'Set up' },
    { id: 'jev', label: 'Quality check', icon: <ShieldCheck />, tone: 'idle', group: 'Your clips' },
    { id: 'vocabulary', label: 'Vocabulary', icon: <BookA />, tone: 'idle', group: 'Your clips' },
    { id: 'music', label: 'My music', icon: <Music />, tone: 'idle', group: 'Your clips' },
    { id: 'broll', label: 'AI b-roll', icon: <Images />, tone: 'idle', group: 'Your clips' },
    { id: 'output', label: 'Output', icon: <FolderOpen />, tone: 'idle', group: 'Your clips' },
    { id: 'system', label: 'System check', icon: <Cpu />, tone: !toolsChecked ? 'idle' : toolsMissing ? 'danger' : 'success', group: 'This computer' },
    { id: 'about', label: 'About', icon: <Info />, tone: 'idle', group: 'This computer' }
  ]
  const groups = sections.reduce<{ group: SectionGroup; items: typeof sections }[]>((acc, section) => {
    const last = acc[acc.length - 1]
    if (last?.group === section.group) last.items.push(section)
    else acc.push({ group: section.group, items: [section] })
    return acc
  }, [])
  const [active, jump] = useActiveSection(sections.map((section) => section.id))
  useEffect(() => {
    if (!showUpdates) return
    // After App's scroll-to-top for a page change, which runs after this effect.
    const frame = requestAnimationFrame(() => jump('about'))
    return () => cancelAnimationFrame(frame)
    // Only a new request scrolls; jump is recreated on every render.
  }, [showUpdates])
  useEffect(() => {
    const section = takeSettingsSection()
    if (!section) return
    const frame = requestAnimationFrame(() => jump(section))
    return () => cancelAnimationFrame(frame)
  }, [])

  const checks: { label: string; ok: boolean | null; detail: string; section: SectionId; optional?: boolean; tone?: 'danger' }[] = [
    { label: 'OpenRouter', ok: openrouterConfigured, detail: openrouterConfigured ? 'Key saved' : 'Needed to transcribe and pick clips', section: 'keys' },
    { label: 'Tools', ok: toolsChecked ? toolsMissing === 0 : null, detail: !toolsChecked ? (checkingTools ? 'Checking…' : 'Not checked') : toolsMissing ? `${toolsMissing} missing` : 'All installed', section: 'system', tone: 'danger' },
    { label: 'Zernio', ok: zernioConfigured, detail: zernioConfigured ? 'Posting on' : 'Optional, for posting', section: 'keys', optional: true }
  ]
  const blocking = checks.filter((check) => !check.optional && check.ok === false).length

  return (
    <Page width="default" className="max-w-[1080px]">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Changes save as you make them."
        actions={<SaveIndicator saving={saving} savedAt={lastSaved || null} error={error} />}
      />

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[200px_minmax(0,1fr)] xl:gap-5">
        <nav aria-label="Settings sections" className="glass hidden rounded-2xl p-2 lg:sticky lg:top-3 lg:block">
          {groups.map(({ group, items }, index) => (
            <div key={group} className={cn(index > 0 && 'mt-2 border-t border-line pt-2')}>
              <p className="eyebrow px-2.5 pb-1 pt-1">{group}</p>
              {items.map((section) => {
                const current = active === section.id
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => jump(section.id)}
                    aria-current={current ? 'true' : undefined}
                    className={cn(
                      'relative flex h-9 w-full items-center gap-2.5 rounded-[10px] pl-1.5 pr-2.5 text-left text-sm transition-colors duration-150',
                      current ? 'bg-white/[0.07] text-ink' : 'text-ink-muted hover:bg-white/[0.04] hover:text-ink'
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 [&_svg]:h-3.5 [&_svg]:w-3.5',
                        current ? 'bg-tool text-canvas' : 'bg-white/[0.05] text-ink-subtle'
                      )}
                    >
                      {section.icon}
                    </span>
                    <span className="flex-1 truncate">{section.label}</span>
                    {section.tone !== 'idle' && <StatusDot tone={section.tone} />}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <IconTile tone={blocking ? 'warning' : 'success'} size="lg">{blocking ? <KeyRound /> : <Check strokeWidth={3} />}</IconTile>
                <div>
                  <h2 className="text-sm font-semibold text-ink">{blocking ? `${blocking} thing${blocking === 1 ? '' : 's'} to set up before clipping` : 'Ready to clip'}</h2>
                  <p className="mt-0.5 text-xs text-ink-muted">{APP_NAME} runs on this computer. One OpenRouter key covers transcription and clip selection.</p>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {checks.map((check) => (
                <button
                  key={check.label}
                  type="button"
                  onClick={() => jump(check.section)}
                  className="glass-tile glass-tile-hover flex items-start gap-2.5 rounded-xl px-3 py-2 text-left"
                >
                  <StatusDot className="mt-1.5" tone={check.ok == null || check.optional && !check.ok ? 'idle' : check.ok ? 'success' : check.tone ?? 'warning'} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{check.label}</span>
                    <span className={cn('block truncate text-2xs', check.ok === false && !check.optional ? (check.tone === 'danger' ? 'text-danger' : 'text-warning') : 'text-ink-subtle')}>{check.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <GroupLabel>Set up</GroupLabel>
          {onNavigate && <Section id="setup">
            <PanelHeader icon={<IconTile><ListChecks /></IconTile>} title="Get set up" description="The steps to go from a fresh install to your first posted clip." />
            <SetupChecklist inSettings onNavigate={onNavigate} className="mt-1" />
          </Section>}

          <Section id="keys">
            <PanelHeader
              icon={<IconTile tone="accent"><KeyRound /></IconTile>}
              title="API keys"
              description="Encrypted with your system keychain. CreatorClips has no account and no server of its own."
            />
            <div className="mt-4 space-y-2">
              <KeyRow>
                <ApiKeyInput
                  label="OpenRouter"
                  value={keys.drafts.openrouterApiKey}
                  configured={openrouterConfigured}
                  onChange={(v) => keys.setDraft('openrouterApiKey', v)}
                  onRemove={() => void keys.remove('openrouterApiKey')}
                  onBlur={() => void keys.persist()}
                  placeholder="sk-or-…"
                  description="Transcribes with MAI Transcribe 2 and picks the moments worth clipping."
                  getKeyUrl={PROVIDER_LINKS.openrouter}
                />
              </KeyRow>
              <SettingRow
                className="items-start"
                title={<>Research the source before clipping <Badge tone="warning" className="ml-1 align-middle">Beta</Badge></>}
                description="Off by default. When on, the video’s title, description and channel go to OpenRouter web search (up to two searches) and Gemini builds a channel and video overview before transcription. Uses extra OpenRouter credit and adds time. Only YouTube and Twitch sources are researched; local files never are. View the brief and sources in the transcript inspector."
                control={<Switch className="mt-0.5" label="Research the source before clipping" checked={sourceContextWebResearch === 'on'}
                  onChange={(on) => void commit({ sourceContextWebResearch: on ? 'on' : 'off' })} />}
              />
              <div className="glass-tile flex items-start gap-3 rounded-xl px-3 py-2.5">
                <span className="flex-1 text-sm font-medium text-ink">Instagram, TikTok, X and Facebook links
                  <span className="mt-0.5 block text-2xs font-normal leading-relaxed text-ink-subtle">These sites often only share a video with someone logged in. Choose the browser you’re logged in with and CreatorClips downloads with that login (it reads the browser’s cookies on this computer, nothing is sent anywhere else). {IS_MAC ? 'For Chrome, Edge or Brave your Mac asks once to allow it; Safari needs Full Disk Access for CreatorClips in System Settings → Privacy & Security.' : 'Close the browser first if it can’t be read while open.'}</span>
                </span>
                <Select aria-label="Browser login for social links" size="sm" className="mt-0.5 w-44 shrink-0" value={downloadLoginBrowser ?? ''}
                  onChange={(value) => void commit({ downloadLoginBrowser: value })}
                  options={[
                    { value: '', label: 'Don’t use a login' },
                    { value: 'chrome', label: 'Chrome' },
                    ...(IS_MAC ? [{ value: 'safari', label: 'Safari' }] : []),
                    { value: 'firefox', label: 'Firefox' },
                    { value: 'edge', label: 'Edge' },
                    { value: 'brave', label: 'Brave' }
                  ]} />
              </div>
              <p className="eyebrow px-1 pb-0.5 pt-3">Optional keys</p>
              <KeyRow>
                <ApiKeyInput
                  label="Zernio (optional)"
                  value={keys.drafts.zernioApiKey}
                  configured={zernioConfigured}
                  onChange={(v) => keys.setDraft('zernioApiKey', v)}
                  onRemove={() => void keys.remove('zernioApiKey')}
                  onBlur={() => void keys.persist()}
                  placeholder="sk_…"
                  description="Connects your social accounts so you can post and schedule clips. Manage them under Accounts."
                  getKeyUrl={PROVIDER_LINKS.zernio}
                />
              </KeyRow>
              <KeyRow>
                <ApiKeyInput
                  label="Pexels (optional)"
                  value={keys.drafts.pexelsApiKey}
                  configured={pexelsConfigured}
                  onChange={(v) => keys.setDraft('pexelsApiKey', v)}
                  onRemove={() => void keys.remove('pexelsApiKey')}
                  onBlur={() => void keys.persist()}
                  placeholder="Your Pexels API key"
                  description="Free stock video for B-roll mode. CreatorClips searches Pexels for footage that matches each beat of a clip."
                  getKeyUrl={PROVIDER_LINKS.pexels}
                />
              </KeyRow>
              <KeyRow>
                <ApiKeyInput
                  label="fal.ai (optional)"
                  value={keys.drafts.falApiKey}
                  configured={falConfigured}
                  onChange={(v) => keys.setDraft('falApiKey', v)}
                  onRemove={() => void keys.remove('falApiKey')}
                  onBlur={() => void keys.persist()}
                  placeholder="Your fal.ai API key"
                  description="Only for Avatar Studio’s Recreate (your avatar takes over someone in a video). Everything else in Avatar Studio runs on your OpenRouter key."
                  getKeyUrl={PROVIDER_LINKS.fal}
                />
              </KeyRow>
              <KeyRow>
                <ApiKeyInput
                  label="HeyGen (optional, Beta)"
                  value={keys.drafts.heygenApiKey}
                  configured={heygenConfigured}
                  onChange={(v) => keys.setDraft('heygenApiKey', v)}
                  onRemove={() => void keys.remove('heygenApiKey')}
                  onBlur={() => void keys.persist()}
                  placeholder="Your HeyGen API key"
                  description="For realistic, lip-synced talking avatars in Avatar Studio: made from a short video or a photo of you, or one of HeyGen’s stock AI people. HeyGen bills your own account."
                  getKeyUrl={PROVIDER_LINKS.heygen}
                />
                <HeygenKeyCheck configured={heygenConfigured} />
              </KeyRow>
            </div>
          </Section>

          <Section id="spending">
            <SpendingSettings />
          </Section>

          <Section id="assistant">
            <AssistantSettings />
          </Section>

          <GroupLabel>Your clips</GroupLabel>
          <JevSettings />

          <Section id="vocabulary">
            <PanelHeader
              icon={<IconTile><BookA /></IconTile>}
              title="Custom vocabulary"
              description="Words captions should spell exactly, one per line: your name, your course, your offer, and any terms you use. Used for captions and post text."
              action={vocabularyTerms > 0 && <Badge className="font-mono tabular">{vocabularyTerms} term{vocabularyTerms === 1 ? '' : 's'}</Badge>}
            />
            <VocabularyField value={customVocabulary} onCommit={(value) => commit({ customVocabulary: value })} />
          </Section>

          <Section id="music">
            <PanelHeader
              icon={<IconTile><Music /></IconTile>}
              title="My music"
              description="Your own tracks for background music, and how loud music sits under your voice. Pick music in Create, Edit my recording and Remix."
            />
            <MusicSettingsPanel />
          </Section>

          <Section id="broll">
            <PanelHeader
              icon={<IconTile><Images /></IconTile>}
              title="AI b-roll"
              description="When Create or Remix fill b-roll with AI, or you make a shot in your B-roll library: what AI makes, the model, and the most AI shots per clip."
              action={onNavigate && <Button size="sm" variant="ghost" onClick={() => onNavigate('broll')}>Open my B-roll library</Button>}
            />
            <div className="mt-3"><BrollAiSettingsPanel /></div>
          </Section>

          <Section id="output">
            <PanelHeader
              icon={<IconTile><FolderOpen /></IconTile>}
              title="Output"
              description="Every run gets its own folder of clips, transcript and plan."
            />
            <OutputFolder value={outputDirectory} onCommit={(dir) => { void folderChange.change(dir) }} />
            {folderChange.dialog}
          </Section>

          <GroupLabel>This computer</GroupLabel>
          <Section id="system">
            <PanelHeader
              icon={<IconTile tone={toolsChecked && toolsMissing ? 'danger' : 'neutral'}><Cpu /></IconTile>}
              title="System check"
              description="Tools CreatorClips needs to download, transcribe and cut video."
              action={
                <Button
                  size="sm"
                  onClick={checkTools}
                  disabled={checkingTools}
                  icon={<RefreshCw className={cn('h-3.5 w-3.5', checkingTools && 'animate-spin')} />}
                >
                  Re-check
                </Button>
              }
            />
            <ToolList rows={tools} checking={checkingTools} />
            {toolError && <Callout tone="danger" className="mt-3">{toolError}</Callout>}
            {!isPackaged && (
              <div className="mt-4 grid gap-4 border-t border-white/[0.06] pt-4">
                <DevPathField
                  label="Python path"
                  value={pythonPath}
                  placeholder="python3"
                  onCommit={(v) => commit({ pythonPath: v }, true)}
                />
              </div>
            )}
          </Section>

          <Section id="about" className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-4">
              <BridgeClipLogo variant="icon" className="-m-1 h-12" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">{APP_NAME}</h2>
                  <Badge className="font-mono tabular">v{APP_VERSION}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  Released under the {LICENSE_NAME} license. Built on BridgeClip by{' '}
                  <button
                    onClick={() => getApi().shell.openPath(BRIDGEMIND_URL)}
                    className="text-ink underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-ink"
                  >
                    BridgeMind
                  </button>
                  .
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" icon={<Github className="h-3.5 w-3.5" />} onClick={() => getApi().shell.openPath(REPO_URL)}>
                  GitHub
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<History className="h-3.5 w-3.5" />}
                  onClick={() => useChangelogStore.getState().setOpen(true)}
                >
                  Changelog
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ScrollText className="h-3.5 w-3.5" />}
                  onClick={() => getApi().diagnostics.openLogFolder()}
                >
                  Show logs
                </Button>
              </div>
            </div>
            <SupportSettings />
            <UpdatesRow />
            <OutputStorage outputDirectory={outputDirectory} />
          </Section>
        </div>
      </div>
    </Page>
  )
}

/** Mono uppercase label over a run of Settings cards; matches the group names in the side nav. */
function GroupLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="eyebrow px-1 pt-2 first:pt-0" aria-hidden>{children}</p>
}

function Section({ id, className, children }: { id: SectionId; className?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section id={`settings-${id}`} className="scroll-mt-4">
      <Panel className={className}>{children}</Panel>
    </section>
  )
}

/** How far below the top of the scroll area a section counts as reached. */
const ACTIVE_OFFSET = 72

/** The section nearest the top of the scroll area, for the side nav, and a jump that selects it. */
function useActiveSection(ids: SectionId[]): [SectionId, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId>(ids[0])
  // A jumped-to section stays selected through its smooth scroll, even if it
  // can't reach the top, until the user scrolls on their own.
  const pinned = useRef(false)
  const key = ids.join(',')
  useEffect(() => {
    const root = document.getElementById('page-scroll')
    if (!root) return
    const update = (): void => {
      if (pinned.current) return
      // Sections near the end can't scroll up to the offset line, so over the
      // last stretch the line slides down to the bottom edge. Every section
      // takes its turn, and the last is selected at the bottom.
      const max = root.scrollHeight - root.clientHeight
      const tail = Math.min(max, root.clientHeight - ACTIVE_OFFSET)
      const progress = tail > 0 ? Math.min(1, Math.max(0, root.scrollTop - (max - tail)) / tail) : 0
      const line = root.getBoundingClientRect().top + ACTIVE_OFFSET + progress * (root.clientHeight - ACTIVE_OFFSET)
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(`settings-${id}`)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      setActive(current)
    }
    const release = (): void => { pinned.current = false }
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    update()
    root.addEventListener('scroll', update, { passive: true })
    for (const type of inputs) window.addEventListener(type, release, { passive: true })
    return () => {
      root.removeEventListener('scroll', update)
      for (const type of inputs) window.removeEventListener(type, release)
    }
  }, [key])
  const jump = (id: SectionId): void => {
    pinned.current = true
    setActive(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return [active, jump]
}

function KeyRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="glass-tile rounded-xl px-3 py-2.5">{children}</div>
}

function SaveIndicator({ saving, savedAt, error }: { saving: boolean; savedAt: number | null; error: string | null }): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!savedAt) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2200)
    return () => clearTimeout(t)
  }, [savedAt])

  if (error) return <Badge tone="danger">{error}</Badge>
  if (saving) {
    return (
      <Badge icon={<Loader2 className="h-3 w-3 animate-spin" />}>
        Saving…
      </Badge>
    )
  }
  return (
    <span
      className={cn('transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0')}
      aria-live="polite"
    >
      <Badge tone="success" icon={<Check className="h-3 w-3" strokeWidth={3} />}>
        Saved
      </Badge>
    </span>
  )
}

function OutputFolder({ value, onCommit }: { value: string; onCommit: (dir: string) => void }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)

  const choose = async (): Promise<void> => {
    try {
      const dir = await getApi().settings.selectOutputDir()
      if (dir) {
        setError(null)
        onCommit(dir)
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not choose an output folder'))
    }
  }

  const open = async (): Promise<void> => {
    try {
      if (!(await getApi().shell.openPath(value))) setError('Could not open the output folder')
      else setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not open the output folder'))
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <TextInput
          className="flex-1"
          mono
          value={value}
          readOnly
          title="Use Change to select a folder"
          leading={<FolderOpen className="h-3.5 w-3.5" />}
          aria-label="Output folder"
        />
        <Button onClick={() => void choose()}>Change…</Button>
        <Button variant="ghost" onClick={() => void open()} disabled={!value}>
          Open
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

function VocabularyField({ value, onCommit }: { value: string; onCommit: (value: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="mt-4">
      <TextArea
        rows={4}
        value={draft}
        placeholder={'Jane Rivera\nProfit Path Academy\n90-Day Money Reset'}
        aria-label="Custom vocabulary"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
      />
      <p className="mt-2 px-1 text-xs text-ink-subtle">Up to five words per term. Applies to new transcriptions; generated metadata uses it right away.</p>
    </div>
  )
}

function DevPathField({
  label,
  value,
  placeholder,
  onCommit
}: {
  label: string
  value: string
  placeholder: string
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Field label={label} hint="Developer builds only">
      <TextInput
        mono
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </Field>
  )
}

interface ToolRow { name: string; ok: boolean | null; detail?: ReactNode; hint?: string | null; repairCommand?: string | null; failureLabel?: string; optional?: boolean }

function toolRows(status: ToolStatus | null): ToolRow[] {
  return [
    { name: 'Python', ok: status?.python ?? null, detail: status?.pythonPath },
    {
      name: 'Clipping dependencies and smart framing',
      ok: status?.pythonDeps ?? null,
      detail: status && !status.pythonDeps ? status.pythonError : 'Includes OpenCV and the smart framing model',
      hint: status && !status.pythonDeps ? status.pythonHint : null,
      repairCommand: status && !status.pythonDeps ? status.pythonRepairCommand : null,
      failureLabel: 'Needs attention'
    },
    { name: 'FFmpeg', ok: status?.ffmpeg ?? null },
    {
      name: 'FFmpeg captions',
      ok: status?.ffmpegCaptions ?? null,
      detail: 'Required when captions are enabled; FFmpeg must include the ass filter',
      optional: true
    },
    { name: 'FFprobe', ok: status?.ffprobe ?? null },
    { name: 'yt-dlp', ok: status?.ytdlp ?? null, detail: 'Downloads YouTube videos and Twitch VODs' },
    { name: 'CreatorClips clipping engine', ok: status?.engine ?? null, detail: status?.enginePath },
    { name: 'Bridge runner', ok: status?.bridgeRunner ?? null, detail: status?.bridgePath }
  ]
}

function ToolList({ rows, checking }: { rows: ToolRow[]; checking: boolean }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const required = rows.filter((row) => !row.optional)
  const missing = required.filter((row) => row.ok === false).length
  const checked = rows.every((row) => row.ok != null)

  return (
    <div className="mt-4">
      {checked && (
        <div className="mb-3 flex items-center gap-2 px-1 text-xs">
          <StatusDot tone={missing > 0 ? 'danger' : 'success'} />
          <span className={cn('flex-1', missing > 0 ? 'text-danger' : 'text-ink-muted')}>
            {missing > 0 ? `${missing} required check${missing === 1 ? '' : 's'} need${missing === 1 ? 's' : ''} attention` : `Everything CreatorClips needs is installed (${rows.filter((row) => row.ok).length} tools)`}
          </span>
          {missing === 0 && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              trailingIcon={<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide details' : 'Show details'}
            </Button>
          )}
        </div>
      )}
      {(!checked || missing > 0 || expanded) && <div className="glass-well divide-y divide-white/[0.05] overflow-hidden rounded-2xl animate-fade-in">
        {rows.map((row) => {
          const tone = row.ok == null ? 'idle' : row.ok ? 'success' : row.optional ? 'warning' : 'danger'
          return (
            <div key={row.name} className="flex items-center gap-3 px-3 py-2">
              <StatusDot tone={tone} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{row.name}</p>
                {row.detail && (
                  <p className="mt-0.5 break-words font-mono text-2xs text-ink-subtle" data-selectable>
                    {row.detail}
                  </p>
                )}
                {row.hint && <p className="mt-2 text-xs leading-relaxed text-ink-muted">{row.hint}</p>}
                {row.repairCommand && (
                  <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-black/20 p-2 font-mono text-2xs text-ink" data-selectable>
                    <code>{row.repairCommand}</code>
                  </pre>
                )}
              </div>
              {row.ok == null ? (
                <span className="shrink-0 text-xs text-ink-subtle">{checking ? 'Checking…' : 'Not checked'}</span>
              ) : (
                <Badge tone={row.ok ? 'neutral' : row.optional ? 'warning' : 'danger'} className="shrink-0">
                  {row.ok ? 'Found' : row.optional ? 'Unavailable' : row.failureLabel ?? 'Missing'}
                </Badge>
              )}
            </div>
          )
        })}
      </div>}
    </div>
  )
}
