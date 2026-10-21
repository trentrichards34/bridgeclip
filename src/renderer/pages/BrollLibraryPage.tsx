import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clapperboard, Eye, FilePlus2, Film, FolderPlus, Image as ImageIcon, Search, Sparkles, Square, Tag, Trash2, UserRound, Wand2 } from 'lucide-react'
import {
  aiShotEstimateUsd, autoIndexAllowed, indexEstimateUsd, parseTagInput, searchLibrary, type BrollLibraryEntry
} from '../../shared/broll-library'
import { getApi } from '../lib/ipc'
import { cn, errorMessage, localFileUrl } from '../lib/utils'
import { useBrollLibrary } from '../store/use-broll-library-store'
import { useSettingsStore } from '../store/use-settings-store'
import { BrollAiSettingsPanel } from '../components/BrollSourcePicker'
import { Page as PageColumn } from '../components/ui/Page'
import { PageHeader } from '../components/ui/PageHeader'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Callout'
import { EmptyState } from '../components/ui/EmptyState'
import { TextArea, TextInput } from '../components/ui/Field'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Badge } from '../components/ui/Badge'
import { Switch } from '../components/ui/Switch'
import { IconTile } from '../components/ui/IconTile'
import { ConfirmDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog'
import type { Page } from '../components/Sidebar'

/**
 * My B-roll library: the member's own clips and pictures (and AI shots), looked at once by a vision model so
 * Create and Remix can pick the right shot for what is said. Originals stay where they are.
 */
export function BrollLibraryPage({ onNavigate }: { onNavigate: (page: Page) => void }): React.JSX.Element {
  const { view, error: loadError, progress, load } = useBrollLibrary()
  const openrouter = useSettingsStore((s) => s.openrouterConfigured)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<'' | 'add' | 'index' | 'ai'>('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const depth = useRef(0)
  const autoIndexed = useRef(false)

  useEffect(() => { void load() }, [load])

  const items = useMemo(() => view?.items ?? [], [view])
  const shown = useMemo(() => searchLibrary(items, query), [items, query])
  const indexing = progress?.phase === 'looking' || progress?.phase === 'preparing'
  const pending = view?.pendingShots ?? 0

  const look = async (): Promise<void> => {
    setBusy('index'); setError(null); setNote(null)
    try {
      const result = await getApi().brollLibrary.index()
      if (result.message) setNote(result.message)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(''); void load() }
  }

  const add = async (mode: 'files' | 'folder'): Promise<void> => {
    setBusy('add'); setError(null); setNote(null)
    try {
      const result = await getApi().brollLibrary.add(mode)
      if (!result) return
      useBrollLibrary.getState().setView(result.view)
      setNote(result.added ? `Added ${result.added} file${result.added === 1 ? '' : 's'}${result.skipped ? ` (${result.skipped} already in the library or not a video or picture)` : ''}. They’re being prepared now.` : 'Nothing new was added: those files are already in your library, or aren’t videos or pictures.')
      autoIndexed.current = false
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy('') }
  }

  // A small batch of new clips is looked at as soon as it's prepared (the spending check runs first); a bigger one
  // waits for "Look at new clips", which shows its price.
  useEffect(() => {
    if (!view || !openrouter || autoIndexed.current || busy || indexing || view.preparing > 0 || !autoIndexAllowed(view.pendingShots)) return
    if (!items.some((item) => Date.now() - Date.parse(item.addedAt) < 10 * 60_000)) return
    autoIndexed.current = true
    void look()
  }, [view, openrouter, busy, indexing])

  return (
    <PageColumn width="wide">
      <PageHeader eyebrow="Studio" title="B-roll library"
        description="Your own clips and pictures. The AI looks at each one once, then Create and Remix use the shots that match what you say. Your files stay where they are."
        actions={<>
          <Button variant="secondary" icon={<FolderPlus className="h-4 w-4" />} loading={busy === 'add'} disabled={Boolean(busy)} onClick={() => void add('folder')}>Add a folder</Button>
          <Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} disabled={Boolean(busy)} onClick={() => void add('files')}>Add clips or pictures</Button>
          <Button variant="secondary" icon={<Clapperboard className="h-4 w-4" />} disabled={!view?.usableShots} onClick={() => onNavigate('brollvideo')}
            tooltip={view?.usableShots ? 'Your voiceover or script covered with these clips.' : 'Add clips and let the AI look at them first.'}>Make a b-roll video</Button>
        </>} />

      <div className="mt-4 space-y-4">
        {(error || loadError) && <Callout tone="danger" onDismiss={error ? () => setError(null) : undefined}>{error ?? loadError}</Callout>}
        {note && <Callout tone="info" onDismiss={() => setNote(null)}>{note}</Callout>}

        <div onDragEnter={(e) => { e.preventDefault(); depth.current++; setDragging(true) }}
          onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false) }}
          onDragOver={(e) => e.preventDefault()}
          // A dropped file can't grant access to itself: the file dialog opens (in main), as everywhere else in the app.
          onDrop={(e) => { e.preventDefault(); depth.current = 0; setDragging(false); if (!busy && e.dataTransfer.files?.length) void add('files') }}
          className={cn('rounded-3xl transition-shadow', dragging && 'shadow-[0_0_0_2px_rgb(var(--accent)/0.7)]')} data-testid="broll-library-drop">
          <Panel>
            <PanelHeader icon={<IconTile><Eye /></IconTile>} title="What the AI has looked at"
              description={view ? `${items.length} item${items.length === 1 ? '' : 's'} · ${view.usableShots} shot${view.usableShots === 1 ? '' : 's'} ready to use${view.preparing ? ` · ${view.preparing} being prepared` : ''}${pending ? ` · ${pending} not looked at yet` : ''}` : 'Loading…'}
              action={indexing
                ? <Button size="sm" variant="secondary" icon={<Square className="h-3.5 w-3.5" />} onClick={() => void getApi().brollLibrary.cancelIndex()}>Stop</Button>
                : pending > 0 && <Button size="sm" variant="primary" loading={busy === 'index'} disabled={Boolean(busy) || !openrouter} onClick={() => void look()}
                  tooltip={openrouter ? undefined : 'Add your OpenRouter key in Settings → API keys first.'}>Look at new clips (about ${indexEstimateUsd(pending).toFixed(2)})</Button>} />
            {progress && progress.phase !== 'done' && progress.phase !== 'cancelled' && progress.phase !== 'failed' && (
              <div className="mt-3 space-y-1" data-testid="broll-index-progress">
                <ProgressBar value={progress.total ? (100 * progress.done) / progress.total : 5} />
                <p className="text-2xs text-ink-subtle">{progress.phase === 'preparing' ? 'Preparing new clips…' : `Looked at ${progress.done} of ${progress.total} shots · $${progress.costUsd.toFixed(3)} so far`}</p>
              </div>
            )}
            {progress && (progress.phase === 'done' || progress.phase === 'failed' || progress.phase === 'cancelled') && (
              <p className={cn('mt-3 text-2xs', progress.phase === 'failed' ? 'text-danger' : 'text-ink-subtle')} data-testid="broll-index-result">
                {progress.phase === 'done' ? `Looked at ${progress.done} shot${progress.done === 1 ? '' : 's'} for $${progress.costUsd.toFixed(3)}.` : progress.message}
                {progress.phase === 'done' && progress.message ? ` ${progress.message}` : ''}
              </p>
            )}
            {!openrouter && <p className="mt-3 text-2xs text-warning">The AI looks at your clips with your OpenRouter key. <button type="button" className="text-accent underline" onClick={() => onNavigate('settings')}>Add it in Settings → API keys</button></p>}
            <p className="mt-3 text-2xs text-ink-subtle">Drop videos or pictures here, or use the buttons above. Long videos are split into shots at scene changes. Only new or changed files are looked at.</p>
          </Panel>
        </div>

        {items.length === 0 && view ? (
          <EmptyState icon={<Film />} title="Your B-roll library is empty"
            description="Add the clips and pictures you film for your videos: your desk, your product, your routine. Then turn on B-roll in Create or Remix."
            action={<Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => void add('files')}>Add clips or pictures</Button>} />
        ) : (
          <section aria-label="Your b-roll" className="space-y-3">
            <TextInput leading={<Search className="h-3.5 w-3.5" />} placeholder="Search your b-roll: “coffee”, “laptop”, “me”, “ai”…" aria-label="Search your b-roll"
              value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" />
            {query && <p className="text-2xs text-ink-subtle">{shown.length} of {items.length} match.</p>}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-label="B-roll items">
              {shown.map((item) => <LibraryCard key={item.id} item={item} onError={setError}
                onRemove={() => setConfirm({ title: `Remove “${item.name}”?`, confirmLabel: 'Remove',
                  body: item.origin === 'ai' ? 'This AI shot is deleted from your library.' : 'It leaves your B-roll library. Your original file stays where it is.',
                  onConfirm: () => { void getApi().brollLibrary.remove([item.id]).then((next) => useBrollLibrary.getState().setView(next)).catch((failure) => setError(errorMessage(failure))) } })} />)}
            </ul>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <AiShotPanel busy={busy} setBusy={setBusy} onError={setError} />
          <Panel>
            <PanelHeader icon={<IconTile><Sparkles /></IconTile>} title="AI b-roll settings" description="Used here and when Create or Remix fill gaps with AI. Also in Settings → AI b-roll." />
            <div className="mt-3"><BrollAiSettingsPanel /></div>
          </Panel>
        </div>
      </div>
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </PageColumn>
  )
}

function seconds(item: BrollLibraryEntry): string {
  if (item.kind === 'image') return 'Picture'
  const total = Math.round(item.durationS)
  return total >= 60 ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : `${total}s`
}

function LibraryCard({ item, onRemove, onError }: { item: BrollLibraryEntry; onRemove: () => void; onError: (message: string) => void }): React.JSX.Element {
  const [playing, setPlaying] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(item.name)
  const [tagging, setTagging] = useState(false)
  const [tags, setTags] = useState(item.tags.join(', '))
  const update = async (patch: { name?: string; tags?: string[]; me?: boolean }): Promise<void> => {
    try { useBrollLibrary.getState().setView(await getApi().brollLibrary.update(item.id, patch)) }
    catch (failure) { onError(errorMessage(failure)) }
  }
  const first = item.shots.find((shot) => shot.analysis)?.analysis ?? null
  const looked = item.shots.filter((shot) => shot.analysis).length
  const preview = item.proxyPath ?? item.originalPath
  return (
    <li className="glass-tile flex flex-col overflow-hidden rounded-2xl" data-testid="broll-item" aria-label={item.name}>
      <div className="relative aspect-video bg-black/40">
        {playing && preview && item.kind === 'video'
          ? <video src={localFileUrl(preview)} className="h-full w-full object-contain" autoPlay muted controls onEnded={() => setPlaying(false)} />
          : item.posterPath
            ? <button type="button" className="h-full w-full" aria-label={item.kind === 'video' ? `Play ${item.name}` : item.name} onClick={() => setPlaying(item.kind === 'video')}>
              <img src={localFileUrl(item.posterPath)} alt="" className="h-full w-full object-cover" />
            </button>
            : <div className="flex h-full w-full items-center justify-center text-2xs text-ink-subtle">{item.status === 'failed' ? 'Couldn’t be read' : 'Preparing…'}</div>}
        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-2xs text-white">{item.kind === 'image' ? <ImageIcon className="inline h-3 w-3" /> : seconds(item)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {naming ? (
          <form onSubmit={(e) => { e.preventDefault(); setNaming(false); if (name.trim() && name.trim() !== item.name) void update({ name }) }}>
            <TextInput inputSize="sm" autoFocus aria-label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { setNaming(false); if (name.trim() && name.trim() !== item.name) void update({ name }) }} />
          </form>
        ) : (
          <button type="button" className="truncate text-left text-sm font-medium text-ink hover:underline" title="Rename" onClick={() => { setName(item.name); setNaming(true) }}>{item.name}</button>
        )}
        <div className="flex flex-wrap gap-1">
          {item.origin === 'ai' && <Badge tone="accent">AI</Badge>}
          {item.me && <Badge tone="success" icon={<UserRound className="h-3 w-3" />}>This is me</Badge>}
          {item.status === 'failed' && <Badge tone="danger">Couldn’t be read</Badge>}
          {item.status === 'new' && <Badge>Preparing</Badge>}
          {item.status === 'ready' && looked < item.shots.length && <Badge tone="warning">{looked ? `${item.shots.length - looked} not looked at yet` : 'Not looked at yet'}</Badge>}
          {item.shots.length > 1 && <Badge>{item.shots.length} shots</Badge>}
        </div>
        {item.missing && (
          <p className="flex items-start gap-1 text-2xs text-warning" data-testid="broll-missing"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />The original file was moved or deleted. Its 720p copy is used instead.</p>
        )}
        {item.error && <p className="text-2xs text-danger">{item.error}</p>}
        {first && <p className="text-xs text-ink-muted" data-testid="broll-description">{first.description}</p>}
        {first && first.tags.length > 0 && <p className="text-2xs text-ink-subtle">{first.tags.slice(0, 8).join(' · ')}</p>}
        {tagging ? (
          <form onSubmit={(e) => { e.preventDefault(); setTagging(false); void update({ tags: parseTagInput(tags) }) }}>
            <TextInput inputSize="sm" autoFocus aria-label="Your tags, separated by commas" placeholder="kitchen, morning, coffee" value={tags} onChange={(e) => setTags(e.target.value)}
              onBlur={() => { setTagging(false); void update({ tags: parseTagInput(tags) }) }} />
          </form>
        ) : item.tags.length > 0 && <p className="text-2xs text-accent">Your tags: {item.tags.join(', ')}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <label className="flex items-center gap-2 text-2xs text-ink-muted">
            <Switch label={`This is me: ${item.name}`} checked={item.me} onChange={(me) => void update({ me })} />This is me
          </label>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={<Tag className="h-3.5 w-3.5" />} onClick={() => { setTags(item.tags.join(', ')); setTagging(true) }} aria-label={`Tags for ${item.name}`}>Tags</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove} aria-label={`Remove ${item.name}`}>Remove</Button>
          </div>
        </div>
      </div>
    </li>
  )
}

function AiShotPanel({ busy, setBusy, onError }: { busy: string; setBusy: (busy: '' | 'ai') => void; onError: (message: string) => void }): React.JSX.Element {
  const view = useBrollLibrary((state) => state.view)
  const openrouter = useSettingsStore((s) => s.openrouterConfigured)
  const [prompt, setPrompt] = useState('')
  const estimate = view ? aiShotEstimateUsd(view.ai) : null
  const make = async (): Promise<void> => {
    setBusy('ai')
    try { useBrollLibrary.getState().setView(await getApi().brollLibrary.makeAiShot(prompt)); setPrompt('') }
    catch (failure) { onError(errorMessage(failure)) }
    finally { setBusy('') }
  }
  return (
    <Panel>
      <PanelHeader icon={<IconTile><Wand2 /></IconTile>} title="Make a shot with AI"
        description="Describe a shot you don’t have. It’s made on OpenRouter with your key and added to your library." />
      <div className="mt-3 space-y-2">
        <TextArea aria-label="Describe the shot" rows={3} maxLength={400} placeholder="Steam rising from a coffee cup on a sunny kitchen counter, close up" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={busy === 'ai'} disabled={Boolean(busy) || prompt.trim().length < 3 || !openrouter} onClick={() => void make()}
            tooltip={openrouter ? undefined : 'Add your OpenRouter key in Settings → API keys first.'}>Make this shot</Button>
          <span className="text-2xs text-ink-subtle">{estimate === null ? 'This model’s price is on OpenRouter.' : `About $${estimate.toFixed(2)}.`} No text, logos or real people are drawn. A video can take a few minutes.</span>
        </div>
      </div>
    </Panel>
  )
}
