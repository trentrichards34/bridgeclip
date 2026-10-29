import { useEffect, useRef, useState } from 'react'
import { FileVideo, Scissors } from 'lucide-react'
import type { AutomaticEditInfo, EditorProgress } from '../../shared/clip-editor'
import { formatBytes } from '../../shared/library-storage'
import { errorMessage } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { Dialog, DialogFooter } from './ui/Dialog'
import { ProgressBar } from './ui/ProgressBar'

/** What opening this run in the editor does, in plain words. */
export function automaticEditSummary(info: AutomaticEditInfo): string[] {
  const lines: string[] = []
  if (info.remix) {
    const videos = info.clipCount === 1 ? 'Your video opens in the editor exactly as it looks' : `Your ${info.clipCount} videos open in the editor exactly as they look`
    if (info.state === 'convert') lines.push(`${videos} now: the layout, captions, hook text and graphics stay. Add graphics and effects on top. No AI is used.`)
    else lines.push('The editor’s copy of these videos was removed to save space. Opening makes it again from the videos in your Library, with everything you baked. Changes you didn’t bake aren’t kept.')
    lines.push('Baking a video replaces it in your Library, with its call to action. Videos you don’t bake stay exactly as they are.')
    lines.push('Uses the finished videos in this run, so nothing is downloaded.')
    return lines
  }
  if (info.state === 'convert') {
    lines.push(`Your ${info.clipCount === 1 ? 'clip opens' : `${info.clipCount} clips open`} in the editor with the same moments and headlines. No AI is used.`)
    if (info.estimatedCuts) lines.push('This run didn’t save its exact cuts, so they are worked out again and may differ slightly from your clips. Check them before baking.')
    lines.push('Baking a clip replaces it in your Library. Clips you don’t bake stay exactly as they are.')
  } else {
    lines.push('The video for this run’s editor was removed to save space. Get it again to keep editing.')
  }
  if (info.source === 'kept') lines.push('Uses the copy of the video kept with this run, so nothing is downloaded.')
  else if (info.source === 'original') lines.push(`Copies the original video file into this run${info.copyBytes ? ` (${formatBytes(info.copyBytes)})` : ''}, so later changes to that file don’t affect your edits.`)
  else if (info.source === 'download') lines.push('Downloads the video again from its link. Nothing is transcribed again.')
  else lines.push('The original video file is no longer on this computer. Choose the same video file to continue.')
  return lines
}

const phaseLabel: Record<EditorProgress['phase'], string> = {
  copy: 'Copying the video', download: 'Downloading the video', preview: 'Preparing the editor preview', scan: 'Preparing'
}

/**
 * Opens an Automatic run (or a project made from one whose video was freed) in
 * the editor: explains what happens, runs it with progress, and offers to
 * choose the video file when the link can't be downloaded.
 */
export function EditAutomaticDialog({ outputDir, info, onClose, onReady }: {
  outputDir: string
  info: AutomaticEditInfo
  onClose: () => void
  onReady: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<EditorProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => {
    if (!working) return
    let pending = false
    const timer = window.setInterval(() => {
      if (pending) return
      pending = true
      void getApi().editor.operationStatus(outputDir).then((status) => setProgress(status.progress ?? null)).catch(() => {}).finally(() => { pending = false })
    }, 700)
    return () => window.clearInterval(timer)
  }, [working, outputDir])

  const start = async (localFile?: string): Promise<void> => {
    setWorking(true); setError(null); setProgress(null)
    try {
      const result = await getApi().editor.prepareAutomatic(outputDir, localFile)
      if (result.state === 'ready') onReady()
      else setError('The editor is not ready yet. Try again.')
    } catch (err) {
      setError(errorMessage(err, 'Could not open this run in the editor. Your clips are unchanged.'))
    } finally { setWorking(false) }
  }
  // A kept copy needs no choice: start right away.
  useEffect(() => {
    if (info.source === 'kept' && !started.current) { started.current = true; void start() }
  }, [])
  const chooseFile = async (): Promise<void> => {
    try {
      const file = await getApi().dialog.selectVideo()
      if (file) await start(file)
    } catch (err) { setError(errorMessage(err)) }
  }
  const missing = info.source === 'missing'
  const title = info.state === 'restore' ? 'Get this run’s video again' : info.remix ? 'Edit videos in the editor' : 'Edit clips in the editor'

  return (
    <Dialog ref={ref} aria-labelledby="edit-automatic-title" onBackdropMouseDown={working ? undefined : onClose} panelClassName="max-w-[560px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !working) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <h2 id="edit-automatic-title" className="flex items-center gap-2 text-base font-semibold text-ink"><Scissors className="h-4 w-4" />{title}</h2>
        <ul className="glass-well space-y-1 rounded-xl px-3 py-2.5 text-xs text-ink-muted" aria-label="What happens">
          {automaticEditSummary(info).map((line) => <li key={line}>{line}</li>)}
        </ul>
        {info.source === 'download' && <p className="truncate text-2xs text-ink-subtle" title={info.videoLabel}>{info.videoLabel}</p>}
        {working && <div role="status" className="space-y-1.5">
          <p className="text-xs text-ink-muted">{progress ? `${phaseLabel[progress.phase]}… ${progress.percent}%` : 'Getting ready…'}</p>
          <ProgressBar value={progress?.percent ?? 0} />
        </div>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      <DialogFooter>
        {working
          ? <Button variant="ghost" onClick={() => { void getApi().editor.cancel(outputDir) }}>Cancel</Button>
          : <Button variant="ghost" onClick={onClose}>Close</Button>}
        {!working && (missing || error || info.source === 'download') && <Button icon={<FileVideo className="h-3.5 w-3.5" />} onClick={() => void chooseFile()}
          title="Use a video file on this computer. It must be the same video the clips were made from.">Choose video file…</Button>}
        {!missing && <Button variant="primary" icon={<Scissors className="h-4 w-4" />} loading={working} disabled={working} onClick={() => void start()}>
          {working ? 'Opening…' : info.source === 'download' ? 'Download and open' : 'Open editor'}
        </Button>}
      </DialogFooter>
    </Dialog>
  )
}
