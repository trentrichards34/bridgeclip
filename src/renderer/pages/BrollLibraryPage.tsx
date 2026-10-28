import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clapperboard, Eye, FilePlus2, Film, FolderPlus, Image as ImageIcon, Search, Sparkles, Square, Tag, Trash2, Wand2 } from 'lucide-react'
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
import { SettingRow } from '../components/ui/SettingRow'
import { Skeleton } from '../components/ui/Skeleton'
import { onRadioKeyDown } from '../components/ui/Segmented'
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
  const [filter, setFilter] = useState<'all' | 'member' | 'ai'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  const counts = { all: items.length, member: items.filter((item) => item.origin !== 'ai').length, ai: items.filter((item) => item.origin === 'ai').length }
  const filtered = filter === 'all' ? shown : shown.filter((item) => filter === 'ai' ? item.origin === 'ai' : item.origin !== 'ai')
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null
  const remove = (item: BrollLibraryEntry): void => setConfirm({ title: `Remove “${item.name}”?`, confirmLabel: 'Remove',
    body: item.origin === 'ai' ? 'This AI shot is deleted from your library.' : 'It leaves your B-roll library. Your original file stays where it is.',
    onConfirm: () => { void getApi().brollLibrary.remove([item.id]).then((next) => useBrollLibrary.getState().setView(next)).catch((failure) => setError(errorMessage(failure))) } })
  const generate = (): void => {
    const box = document.getElementById('broll-ai-shot')
    box?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    box?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
  }

  return (
    <PageColumn width="wide">
      <PageHeader eyebrow="Studio" title={<>Footage the editor cuts to <Badge tone="warning" className="ml-1 align-middle">Beta</Badge></>}
        description="Your own clips and pictures. The AI looks at each one once, then Create and Remix use the shots that match what you say. Your files stay where they are."
        actions={<>
          <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={generate}>Generate</Button>
          <Button variant="secondary" icon={<FolderPlus className="h-4 w-4" />} loading={busy === 'add'} disabled={Boolean(busy)} onClick={() => void add('folder')}>Add a folder</Button>
          <Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} disabled={Boolean(busy)} onClick={() => void add('files')}>Add clips or pictures</Button>
        </>} />

      <div className="mt-5 space-y-4">
        {(error || loadError) && <Callout tone="danger" onDismiss={error ? () => setError(null) : undefined}>{error ?? loadError}</Callout>}
        {note && <Callout tone="info" onDismiss={() => setNote(null)}>{note}</Callout>}

        <div onDragEnter={(e) => { e.preventDefault(); depth.current++; setDragging(true) }}
          onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false) }}
          onDragOver={(e) => e.preventDefault()}
          // A dropped file can't grant access to itself: the file dialog opens (in main), as everywhere else in the app.
          onDrop={(e) => { e.preventDefault(); depth.current = 0; setDragging(false); if (!busy && e.dataTransfer.files?.length) void add('files') }}
          className={cn('space-y-4 rounded-3xl transition-shadow', dragging && 'shadow-[0_0_0_2px_rgb(var(--tool)/0.7)]')} data-testid="broll-library-drop">
          <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3">
            <IconTile tone="accent"><Eye /></IconTile>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">What the AI has looked at</p>
              <p className="font-mono text-2xs tabular text-ink-subtle">{view ? `${items.length} item${items.length === 1 ? '' : 's'} · ${view.usableShots} shot${view.usableShots === 1 ? '' : 's'} ready to use${view.preparing ? ` · ${view.preparing} being prepared` : ''}${pending ? ` · ${pending} not looked at yet` : ''}` : 'Loading…'}</p>
            </div>
            <Button size="sm" variant="secondary" icon={<Clapperboard className="h-3.5 w-3.5" />} disabled={!view?.usableShots} onClick={() => onNavigate('brollvideo')}
              tooltip={view?.usableShots ? 'Your voiceover or script covered with these clips.' : 'Add clips and let the AI look at them first.'}>Make a b-roll video</Button>
            {indexing
              ? <Button size="sm" variant="secondary" icon={<Square className="h-3.5 w-3.5" />} onClick={() => void getApi().brollLibrary.cancelIndex()}>Stop</Button>
              : pending > 0 && <Button size="sm" variant="primary" loading={busy === 'index'} disabled={Boolean(busy) || !openrouter} onClick={() => void look()}
                tooltip={openrouter ? undefined : 'Add your OpenRouter key in Settings → API keys first.'}>Look at new clips (about ${indexEstimateUsd(pending).toFixed(2)})</Button>}
            {progress && progress.phase !== 'done' && progress.phase !== 'cancelled' && progress.phase !== 'failed' && (
              <div className="w-full space-y-1" data-testid="broll-index-progress">
                <ProgressBar value={progress.total ? (100 * progress.done) / progress.total : 5} />
                <p className="text-2xs text-ink-subtle">{progress.phase === 'preparing' ? 'Preparing new clips…' : `Looked at ${progress.done} of ${progress.total} shots · $${progress.costUsd.toFixed(3)} so far`}</p>
              </div>
            )}
            {progress && (progress.phase === 'done' || progress.phase === 'failed' || progress.phase === 'cancelled') && (
              <p className={cn('w-full text-2xs', progress.phase === 'failed' ? 'text-danger' : 'text-ink-subtle')} data-testid="broll-index-result">
                {progress.phase === 'done' ? `Looked at ${progress.done} shot${progress.done === 1 ? '' : 's'} for $${progress.costUsd.toFixed(3)}.` : progress.message}
                {progress.phase === 'done' && progress.message ? ` ${progress.message}` : ''}
              </p>
            )}
            {!openrouter && <p className="w-full text-2xs text-warning">The AI looks at your clips with your OpenRouter key. <button type="button" className="text-tool underline" onClick={() => onNavigate('settings')}>Add it in Settings → API keys</button></p>}
            <p className="w-full text-2xs text-ink-subtle">{dragging ? 'Drop to choose these files in the file picker.' : 'Drop videos or pictures here, or use the buttons above. Long videos are split into shots at scene changes. Only new or changed files are looked at.'}</p>
          </div>

          {items.length === 0 && view ? (
            <EmptyState icon={<Film />} title="Your B-roll library is empty"
              description="Add the clips and pictures you film for your videos: your desk, your product, your routine. Then turn on B-roll in Create or Remix."
              action={<Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => void add('files')}>Add clips or pictures</Button>} />
          ) : !view ? (
            <div aria-busy="true" aria-label="Loading your b-roll" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-video rounded-2xl" />)}
            </div>
          ) : (
            <section aria-label="Your b-roll" className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-0.5 rounded-xl bg-sidebar/80 p-[3px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]" role="radiogroup" aria-label="Show">
                    {([['all', 'All'], ['member', 'Yours'], ['ai', 'Generated']] as const).map(([id, label]) => (
                      <button key={id} type="button" role="radio" aria-checked={filter === id} tabIndex={filter === id ? 0 : -1} onKeyDown={onRadioKeyDown} onClick={() => setFilter(id)}
                        className={cn('flex h-7 items-center gap-1.5 rounded-[9px] px-3 text-xs font-medium transition-colors', filter === id ? 'bg-tool/[0.16] text-tool shadow-[inset_0_0_0_1px_rgb(var(--tool)/0.35)]' : 'text-ink-muted hover:text-ink')}>
                        {label}<span className="font-mono text-[10px] tabular opacity-70">{counts[id]}</span>
                      </button>
                    ))}
                  </div>
                  <TextInput leading={<Search className="h-3.5 w-3.5" />} placeholder="Search by what’s in the shot: “coffee”, “laptop”, “me”…" aria-label="Search your b-roll"
                    value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-[220px] max-w-md flex-1" />
                </div>
                {query && <p className="text-2xs text-ink-subtle">{shown.length} of {items.length} match.</p>}
                {filtered.length === 0 && <p className="glass-tile rounded-xl px-3 py-6 text-center text-xs text-ink-muted">{query ? 'Nothing here matches your search.' : filter === 'ai' ? 'No AI shots yet. Generate one below.' : 'None of your own clips yet.'}</p>}
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="B-roll items">
                  {filtered.map((item) => <LibraryCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />)}
                </ul>
              </div>
              {selected && <ShotDetail key={selected.id} item={selected} onError={setError} onRemove={() => remove(selected)} />}
            </section>
          )}
        </div>

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

/** A shot in the grid: its picture, where it's from, its length and what the AI saw. Choosing it shows its details. */
function LibraryCard({ item, selected, onSelect }: { item: BrollLibraryEntry; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const first = item.shots.find((shot) => shot.analysis)?.analysis ?? null
  const looked = item.shots.filter((shot) => shot.analysis).length
  return (
    <li className={cn('glass-tile glass-tile-hover flex flex-col overflow-hidden rounded-2xl p-[5px]', selected && 'glass-selected')} data-testid="broll-item" aria-label={item.name}>
      <button type="button" aria-pressed={selected} onClick={onSelect} className="flex flex-1 flex-col rounded-xl text-left">
        <span className="relative block aspect-video w-full overflow-hidden rounded-[10px] bg-black/40">
          {item.posterPath
            ? <img src={localFileUrl(item.posterPath)} alt="" className="h-full w-full object-cover" />
            : <span className="flex h-full w-full items-center justify-center text-2xs text-ink-subtle">{item.status === 'failed' ? 'Couldn’t be read' : 'Preparing…'}</span>}
          <span className="absolute left-1.5 top-1.5 flex gap-1">
            <span className={cn('rounded px-1.5 py-px text-[10px] font-medium', item.origin === 'ai' ? 'bg-[rgb(var(--tool-avatar)/0.85)] text-canvas' : 'bg-canvas/75 text-tool')}>{item.origin === 'ai' ? 'Generated' : 'Yours'}</span>
            {item.me && <span className="rounded bg-canvas/75 px-1.5 py-px text-[10px] font-medium text-success">You</span>}
          </span>
          <span className="absolute bottom-1.5 right-1.5 rounded bg-canvas/75 px-1.5 py-px font-mono text-[10px] tabular text-white">{item.kind === 'image' ? <ImageIcon aria-label="Picture" className="inline h-3 w-3" /> : seconds(item)}</span>
        </span>
        <span className="block px-1.5 pt-2 text-sm font-medium text-ink">
          <span className="block truncate">{item.name}</span>
        </span>
        {first && first.tags.length > 0 && <span className="block truncate px-1.5 font-mono text-[10px] text-ink-subtle">{first.tags.slice(0, 3).join(' · ')}</span>}
        {first && <span className="line-clamp-2 px-1.5 pt-1 text-2xs text-ink-muted" data-testid="broll-description">{first.description}</span>}
        <span className="flex flex-wrap gap-1 px-1.5 pb-1.5 pt-1.5">
          {item.status === 'failed' && <Badge tone="danger">Couldn’t be read</Badge>}
          {item.status === 'new' && <Badge>Preparing</Badge>}
          {item.status === 'ready' && looked < item.shots.length && <Badge tone="warning">{looked ? `${item.shots.length - looked} not looked at yet` : 'Not looked at yet'}</Badge>}
          {item.shots.length > 1 && <Badge>{item.shots.length} shots</Badge>}
          {item.missing && <Badge tone="warning">Original moved</Badge>}
        </span>
      </button>
    </li>
  )
}

/** The chosen shot: play it, rename it, its tags (the AI's and yours), "This is me", and remove. */
function ShotDetail({ item, onRemove, onError }: { item: BrollLibraryEntry; onRemove: () => void; onError: (message: string) => void }): React.JSX.Element {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(item.name)
  const [tagging, setTagging] = useState(false)
  const [tags, setTags] = useState(item.tags.join(', '))
  const update = async (patch: { name?: string; tags?: string[]; me?: boolean }): Promise<void> => {
    try { useBrollLibrary.getState().setView(await getApi().brollLibrary.update(item.id, patch)) }
    catch (failure) { onError(errorMessage(failure)) }
  }
  const analyses = item.shots.flatMap((shot) => shot.analysis ? [shot.analysis] : [])
  const aiTags = [...new Set(analyses.flatMap((analysis) => analysis.tags))].slice(0, 10)
  const preview = item.proxyPath ?? item.originalPath
  return (
    <aside className="glass space-y-4 rounded-[18px] p-3 lg:sticky lg:top-0" aria-label={`About ${item.name}`}>
      <div className="overflow-hidden rounded-xl bg-black/40">
        {item.kind === 'video' && preview
          ? <video key={preview} src={localFileUrl(preview)} poster={item.posterPath ? localFileUrl(item.posterPath) : undefined} controls muted playsInline preload="metadata" className="aspect-video w-full object-contain" aria-label={`Play ${item.name}`} />
          : item.posterPath ? <img src={localFileUrl(item.posterPath)} alt={item.name} className="aspect-video w-full object-contain" />
            : <div className="flex aspect-video items-center justify-center text-2xs text-ink-subtle">{item.status === 'failed' ? 'Couldn’t be read' : 'Preparing…'}</div>}
      </div>
      <div className="px-1">
        {naming ? (
          <form onSubmit={(e) => { e.preventDefault(); setNaming(false); if (name.trim() && name.trim() !== item.name) void update({ name }) }}>
            <TextInput inputSize="sm" autoFocus aria-label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { setNaming(false); if (name.trim() && name.trim() !== item.name) void update({ name }) }} />
          </form>
        ) : (
          <button type="button" className="block max-w-full truncate text-left font-display text-[17px] font-semibold text-ink hover:underline" title="Rename" onClick={() => { setName(item.name); setNaming(true) }}>{item.name}</button>
        )}
        <p className="mt-0.5 font-mono text-[11px] tabular text-ink-subtle">{item.origin === 'ai' ? 'Generated' : 'Yours'} · {seconds(item)}{item.shots.length > 1 ? ` · ${item.shots.length} shots` : ''}</p>
        {analyses[0] && <p className="mt-2 text-xs text-ink-muted">{analyses[0].description}</p>}
      </div>
      {item.missing && (
        <p className="flex items-start gap-1 px-1 text-2xs text-warning" data-testid="broll-missing"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />The original file was moved or deleted. Its 720p copy is used instead.</p>
      )}
      {item.error && <p className="px-1 text-2xs text-danger">{item.error}</p>}
      {(aiTags.length > 0 || item.tags.length > 0) && (
        <div className="space-y-2 px-1">
          <p className="eyebrow">Matched to what you say by</p>
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => <span key={`y-${tag}`} className="rounded-full border border-tool/50 bg-tool/[0.08] px-2.5 py-0.5 text-2xs text-tool">{tag}</span>)}
            {aiTags.map((tag) => <span key={`a-${tag}`} className="rounded-full border border-line-strong px-2.5 py-0.5 text-2xs text-ink-muted">{tag}</span>)}
          </div>
          {item.tags.length > 0 && <p className="text-[10px] text-ink-subtle">Colored: your tags. The rest: what the AI saw.</p>}
        </div>
      )}
      {tagging ? (
        <form className="px-1" onSubmit={(e) => { e.preventDefault(); setTagging(false); void update({ tags: parseTagInput(tags) }) }}>
          <TextInput inputSize="sm" autoFocus aria-label="Your tags, separated by commas" placeholder="kitchen, morning, coffee" value={tags} onChange={(e) => setTags(e.target.value)}
            onBlur={() => { setTagging(false); void update({ tags: parseTagInput(tags) }) }} />
        </form>
      ) : null}
      <SettingRow title="This is me" description="Tells the AI you’re in this shot when it picks b-roll."
        control={<Switch label={`This is me: ${item.name}`} checked={item.me} onChange={(me) => void update({ me })} />} />
      <div className="flex flex-wrap gap-2 px-1 pb-1">
        <Button variant="secondary" icon={<Tag className="h-3.5 w-3.5" />} onClick={() => { setTags(item.tags.join(', ')); setTagging(true) }} aria-label={`Tags for ${item.name}`}>Your tags</Button>
        <Button variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove} aria-label={`Remove ${item.name}`}>Remove</Button>
      </div>
    </aside>
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
    <Panel id="broll-ai-shot" className="scroll-mt-4">
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
