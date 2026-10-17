import { twitchSourceError, twitchVodId, youtubeSourceUrl } from '../../shared/video-source'
import { MAX_CREATE_SOURCES, isValidSourceLink, mergeSources, parseSourceText, sourceCountLabel } from '../../shared/create-sources'
import { useCallback, useRef, useState } from 'react'
import { FileVideo, FolderOpen, Link2, Plus, UploadCloud, X, Youtube, Twitch } from 'lucide-react'
import { basename, cn, formatTimecode, isUrl, localFileUrl, sourceLabel, youtubeId } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { TextInput } from './ui/Field'
import { Badge } from './ui/Badge'
import { IconTile } from './ui/IconTile'
import { YouTubeSourcePreview } from './YouTubeSourcePreview'

export { isValidSourceLink }

interface SourcePickerProps {
  value: string
  onChange: (source: string) => void
  /**
   * Several videos, each clipped as its own job with the same settings. When
   * set, pasted text can hold several links, Browse can pick several files,
   * and `sources` lists every chosen video (the first is `value`).
   */
  sources?: string[]
  onSourcesChange?: (sources: string[]) => void
  disabled?: boolean
}

function displaySourceLink(value: string): string {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return 'Video link'
  }
}

/** Why some of the added videos were left out, or null. */
function addNotice(invalid: string[], overLimit: number, duplicates: number): string | null {
  const parts: string[] = []
  if (invalid.length) parts.push(invalid.length === 1 ? (twitchSourceError(invalid[0]) ?? 'One link isn’t a valid HTTP(S) video link, so it was left out.') : `${invalid.length} links aren’t valid HTTP(S) video links, so they were left out.`)
  if (overLimit) parts.push(`Up to ${MAX_CREATE_SOURCES} videos at a time: ${overLimit} ${overLimit === 1 ? 'was' : 'were'} left out.`)
  if (duplicates) parts.push(`${duplicates} ${duplicates === 1 ? 'video was' : 'videos were'} already in the list.`)
  return parts.length ? parts.join(' ') : null
}

export function SourcePicker({ value, onChange, sources, onSourcesChange, disabled }: SourcePickerProps): React.JSX.Element {
  const [pickerError, setPickerError] = useState<string | null>(null)
  const multi = Boolean(onSourcesChange)
  const list = multi && sources && sources.length > 1 && sources[0] === value ? sources : value ? [value] : []

  /** Add videos to the list (multi) or use the first one (single). Returns a notice for what was left out. */
  const add = useCallback((added: string[], invalid: string[] = []): string | null => {
    if (!multi) {
      if (added[0]) onChange(added[0])
      return added[0] ? null : addNotice(invalid, 0, 0)
    }
    const merged = mergeSources(list, added)
    if (merged.sources.length !== list.length) onSourcesChange!(merged.sources)
    return addNotice(invalid, merged.overLimit, merged.duplicates)
  }, [multi, list, onChange, onSourcesChange])

  const browse = useCallback(async () => {
    try {
      if (multi) {
        const files = await getApi().dialog.selectVideos()
        if (files.length) setPickerError(add(files))
        return
      }
      const file = await getApi().dialog.selectVideo()
      if (file) {
        setPickerError(null)
        onChange(file)
      }
    } catch {
      setPickerError('Could not open the file picker. Please try again.')
    }
  }, [multi, add, onChange])

  const replace = useCallback(async () => {
    try {
      const file = await getApi().dialog.selectVideo()
      if (file) {
        setPickerError(null)
        onChange(file)
        if (multi) onSourcesChange!([file])
      }
    } catch {
      setPickerError('Could not open the file picker. Please try again.')
    }
  }, [multi, onChange, onSourcesChange])

  const error = pickerError && <p role="alert" className="mt-2.5 px-1 text-xs text-danger">{pickerError}</p>

  if (list.length > 1) {
    return <>
      <SourceList sources={list} disabled={disabled} onRemove={(source) => { setPickerError(null); onSourcesChange!(list.filter((item) => item !== source)) }}
        onAdd={(added, invalid) => { setPickerError(add(added, invalid)); return null }} onBrowse={browse} />
      {error}
    </>
  }
  if (list.length === 1) {
    return <>
      <SourcePreview key={value} source={value} onClear={() => { setPickerError(null); onChange(''); if (multi) onSourcesChange!([]) }} onReplace={replace} disabled={disabled} />
      {multi && !disabled && <AddMoreSources count={1} onAdd={(added, invalid) => { setPickerError(add(added, invalid)); return null }} onBrowse={browse} />}
      {error}
    </>
  }
  return <>
    <DropZone multi={multi} onAdd={(added, invalid) => { setPickerError(add(added, invalid)); return null }} onBrowse={browse} disabled={disabled} />
    {error}
  </>
}

type AddSources = (sources: string[], invalid: string[]) => string | null

/** A link field shared by the drop zone and the "add another video" row. */
function useLinkEntry(onAdd: AddSources): {
  draft: string
  error: string | null
  setDraft: (value: string) => void
  submit: (text: string) => boolean
} {
  const [draft, setDraftState] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (text: string): boolean => {
    if (!text.trim()) return false
    const { links, invalid } = parseSourceText(text)
    if (!links.length) {
      setError(twitchSourceError(invalid[0] ?? text) ?? 'Paste a valid HTTP(S) link without a username or password.')
      return false
    }
    setError(onAdd(links, invalid))
    setDraftState('')
    return true
  }
  return { draft, error, setDraft: (value) => { setDraftState(value); if (error) setError(null) }, submit }
}

function DropZone({
  multi,
  onAdd,
  onBrowse,
  disabled
}: {
  multi: boolean
  onAdd: AddSources
  onBrowse: () => void
  disabled?: boolean
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const entry = useLinkEntry(onAdd)
  const error = dropError ?? entry.error
  // dragenter/dragleave fire for every child; count them to know when the
  // pointer has really left the zone.
  const depth = useRef(0)

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    if (disabled) return

    if (e.dataTransfer.files?.length) {
      try {
        // A renderer-supplied path cannot grant file access. Let Electron's
        // native picker make the local selection in the main process.
        if (multi) {
          const paths = await getApi().dialog.selectVideos()
          if (paths.length) setDropError(onAdd(paths, []))
          return
        }
        const path = await getApi().dialog.selectVideo()
        if (!path) return
        setDropError(null)
        onAdd([path], [])
      } catch {
        setDropError('Could not open that video. Try another file or use Browse.')
      }
      return
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    setDropError(null)
    if (text) entry.submit(multi ? text : text.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('#')) ?? '')
  }

  // A compact drop target: a headline row, then the link field and Browse. The
  // whole card accepts a dropped file.
  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current += 1
        if (!disabled) setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
      className={cn(
        'glass relative rounded-2xl p-3.5 transition-[box-shadow,background-color] duration-200 ease-out',
        dragging && 'bg-accent/[0.08] shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.75),0_0_0_4px_rgb(var(--accent)/0.12)]',
        disabled && 'pointer-events-none opacity-50'
      )}
    >
      {/* Dashed inner guide: marks the card as a drop target. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-1.5 rounded-xl border border-dashed transition-colors duration-200',
          dragging ? 'border-accent/60' : 'border-white/[0.08]'
        )}
      />

      <div className="relative flex items-center gap-3">
        <IconTile tone="accent">
          <UploadCloud strokeWidth={1.75} />
        </IconTile>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">
            {dragging ? 'Choose this video in the file picker' : multi ? 'Add one or more long videos' : 'Add a long video'}
          </h2>
          <p className="text-xs text-ink-subtle">
            {multi ? `Drop a video file or link here, or paste links below. Up to ${MAX_CREATE_SOURCES} videos, one job each.` : 'Drop a video file or link here, or paste a link below.'}
          </p>
          <div role="group" aria-label="Supported video links" className="mt-2 flex flex-wrap items-center gap-2">
            <Badge icon={<Youtube aria-hidden className="h-3.5 w-3.5 text-[#ff0033]" />}>YouTube</Badge>
            <Badge icon={<Twitch aria-hidden className="h-3.5 w-3.5 text-[#a970ff]" />}>Twitch VODs</Badge>
          </div>
        </div>
      </div>

      <div className="relative mt-3 flex items-center gap-2">
        <LinkField entry={entry} size="lg" disabled={disabled} multi={multi} primary />
        <span className="text-xs text-ink-faint max-sm:hidden">or</span>
        <Button size="lg" variant="secondary" icon={<FolderOpen className="h-4 w-4" />} onClick={onBrowse} disabled={disabled}>
          Browse
        </Button>
      </div>
      {error && <p id="source-link-error" role="alert" className="relative mt-2 px-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

function LinkField({ entry, size, disabled, multi, primary = false }: { entry: ReturnType<typeof useLinkEntry>; size: 'md' | 'lg'; disabled?: boolean; multi: boolean; primary?: boolean }): React.JSX.Element {
  return (
    <TextInput
      inputSize={size}
      className="min-w-0 flex-1"
      value={entry.draft}
      placeholder={primary ? 'YouTube, Twitch VOD or direct video link' : 'Add another video link'}
      aria-label={primary ? 'Video link' : 'Another video link'}
      leading={<Link2 className="h-4 w-4" />}
      onChange={(e) => entry.setDraft(e.target.value)}
      aria-invalid={Boolean(entry.error)}
      aria-describedby={entry.error ? 'source-link-error' : undefined}
      disabled={disabled}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text')
        // A pasted link (or several, one per line) is used right away.
        const { links } = parseSourceText(text)
        if (links.length || twitchSourceError(text.trim())) {
          e.preventDefault()
          entry.submit(multi ? text : links[0] ?? text)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') entry.submit(entry.draft)
      }}
      trailing={
        entry.draft.trim() ? (
          <Button size="sm" variant="primary" className="mr-0.5 animate-fade-in" onClick={() => entry.submit(entry.draft)} disabled={disabled}>
            {primary ? 'Use link' : 'Add'}
          </Button>
        ) : undefined
      }
    />
  )
}

/** Under a single chosen video: add more, each clipped as its own job. */
function AddMoreSources({ count, onAdd, onBrowse }: { count: number; onAdd: AddSources; onBrowse: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const entry = useLinkEntry(onAdd)
  if (!open) {
    return (
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
          Add more videos
        </Button>
      </div>
    )
  }
  return (
    <div className="mt-2 animate-fade-in">
      <div className="flex items-center gap-2">
        <LinkField entry={entry} size="md" multi />
        <Button variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={onBrowse}>Browse</Button>
      </div>
      <p className={cn('mt-1.5 px-1 text-2xs', entry.error ? 'text-danger' : 'text-ink-subtle')} role={entry.error ? 'alert' : undefined}>
        {entry.error ?? `Each video becomes its own job with the same settings. Up to ${MAX_CREATE_SOURCES} (${count} added).`}
      </p>
    </div>
  )
}

/** Several chosen videos: one row each, with the count and a way to add more. */
function SourceList({ sources, disabled, onRemove, onAdd, onBrowse }: {
  sources: string[]
  disabled?: boolean
  onRemove: (source: string) => void
  onAdd: AddSources
  onBrowse: () => void
}): React.JSX.Element {
  const entry = useLinkEntry(onAdd)
  const full = sources.length >= MAX_CREATE_SOURCES
  return (
    <div className="glass rounded-2xl p-3 animate-fade-in" aria-label="Videos to clip" role="group">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-sm font-semibold text-ink" data-testid="source-count">{sourceCountLabel(sources.length)}</h3>
        <span className="text-2xs text-ink-subtle">Same settings for each · one job per video</span>
      </div>
      <ul className="mt-2 divide-y divide-white/[0.05] overflow-hidden rounded-xl glass-well">
        {sources.map((source, index) => {
          const twitch = twitchVodId(source)
          const youtube = youtubeSourceUrl(source)
          const link = isUrl(source)
          return (
            <li key={source} className="flex items-center gap-2.5 py-1.5 pl-2.5 pr-1">
              <span className="w-4 shrink-0 text-right font-mono text-2xs tabular text-ink-faint">{index + 1}</span>
              <span className="shrink-0 text-ink-subtle">
                {twitch ? <Twitch className="h-3.5 w-3.5" /> : youtube ? <Youtube className="h-3.5 w-3.5" /> : link ? <Link2 className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={source} data-selectable>{sourceLabel(source)}</span>
              <Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${sourceLabel(source)}`} disabled={disabled}
                icon={<X className="h-3.5 w-3.5" />} onClick={() => onRemove(source)} />
            </li>
          )
        })}
      </ul>
      {!full && !disabled && (
        <div className="mt-2 flex items-center gap-2">
          <LinkField entry={entry} size="md" multi />
          <Button variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={onBrowse}>Browse</Button>
        </div>
      )}
      <p className={cn('mt-1.5 px-1 text-2xs', entry.error ? 'text-danger' : 'text-ink-subtle')} role={entry.error ? 'alert' : undefined}>
        {entry.error ?? (full ? `That’s the most for one go (${MAX_CREATE_SOURCES}). Remove one to add another.` : `Add up to ${MAX_CREATE_SOURCES - sources.length} more.`)}
      </p>
    </div>
  )
}

export function SourcePreview({
  source,
  onClear,
  onReplace,
  disabled,
  readOnly = false
}: {
  source: string
  onClear?: () => void
  onReplace?: () => void
  disabled?: boolean
  readOnly?: boolean
}): React.JSX.Element {
  const link = isUrl(source)
  const ytId = link ? youtubeId(source) : null
  const twitchId = link ? twitchVodId(source) : null
  const displaySource = link ? displaySourceLink(source) : basename(source)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [mediaFailed, setMediaFailed] = useState(false)
  const youtubeUrl = youtubeSourceUrl(source)

  if (youtubeUrl) return <YouTubeSourcePreview readOnly={readOnly} url={youtubeUrl} onClear={onClear} onReplace={onReplace} disabled={disabled} />

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center sm:gap-4 animate-fade-in">
      <div className="relative aspect-video w-full sm:w-44 xl:w-52 shrink-0 overflow-hidden rounded-xl bg-black/40 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
        {!mediaFailed && ytId && (
          <img
            src={`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setMediaFailed(true)}
            draggable={false}
          />
        )}
        {!mediaFailed && !link && (
          <video
            src={localFileUrl(source)}
            preload="metadata"
            muted
            className="h-full w-full object-cover"
            onLoadedMetadata={(e) => {
              const seconds = e.currentTarget.duration
              if (Number.isFinite(seconds)) {
                setDurationMs(seconds * 1000)
                // Seek past a black first frame for a representative still. Not a
                // #t= fragment: the local-file protocol would treat it as part of the path.
                e.currentTarget.currentTime = Math.min(2, seconds / 2)
              }
            }}
            onError={() => setMediaFailed(true)}
          />
        )}
        {(mediaFailed || (link && !ytId)) && (
          <div className="flex h-full w-full items-center justify-center bg-accent/10 text-ink-subtle">
            {twitchId ? <Twitch className="h-5 w-5" /> : link ? <Link2 className="h-5 w-5" /> : <FileVideo className="h-5 w-5" />}
          </div>
        )}
        {durationMs != null && (
          <span className="glass-chip absolute bottom-1 right-1 rounded-full px-1.5 font-mono text-[10px] tabular text-white">
            {formatTimecode(durationMs)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-ink" title={displaySource} data-selectable>
          {displaySource}
        </p>
        <div className="mt-1.5 flex min-w-0 items-center gap-2">
          <Badge
            icon={twitchId ? <Twitch className="h-3 w-3" /> : ytId ? <Youtube className="h-3 w-3" /> : link ? <Link2 className="h-3 w-3" /> : <FileVideo className="h-3 w-3" />}
          >
            {twitchId ? 'Twitch VOD' : ytId ? 'YouTube' : link ? 'Link' : 'Local file'}
          </Badge>
          <span className="truncate text-2xs text-ink-subtle">{readOnly ? 'Source video' : twitchId ? 'Public, completed videos only' : 'Ready to clip'}</span>
        </div>
      </div>

      {!readOnly && <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={onReplace} disabled={disabled}>
          Replace
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Remove video"
          onClick={onClear}
          disabled={disabled}
          icon={<X className="h-3.5 w-3.5" />}
        />
      </div>}
    </div>
  )
}
