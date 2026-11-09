import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { FolderInput } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { formatBytes, type MoveProgress, type MoveResult } from '../../shared/library-storage'
import { useSettingsStore } from '../store/use-settings-store'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { Dialog, DialogFooter } from './ui/Dialog'
import { ProgressBar } from './ui/ProgressBar'

/** Moves an earlier output folder's runs into the current one, showing progress and what was left. */
export function useFolderMove(): { move: (folder: string) => Promise<MoveResult | null>; progress: MoveProgress | null; result: MoveResult | null; error: string | null; moving: boolean; reset: () => void } {
  const [progress, setProgress] = useState<MoveProgress | null>(null)
  const [result, setResult] = useState<MoveResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const move = useCallback(async (folder: string): Promise<MoveResult | null> => {
    setMoving(true)
    setError(null)
    setResult(null)
    setProgress(null)
    const stop = getApi().storage.onMoveProgress((value) => { if (value.folder === folder || !value.folder) setProgress(value) })
    try {
      const value = await getApi().storage.moveFolder(folder)
      setResult(value)
      return value
    } catch (err) {
      setError(errorMessage(err, 'Could not move these runs. They are still in the earlier folder.'))
      return null
    } finally {
      stop()
      setMoving(false)
    }
  }, [])
  const reset = useCallback(() => { setProgress(null); setResult(null); setError(null) }, [])
  return { move, progress, result, error, moving, reset }
}

export function MoveStatus({ progress, result, error, moving }: { progress: MoveProgress | null; result: MoveResult | null; error: string | null; moving: boolean }): React.JSX.Element | null {
  if (error) return <Callout tone="danger">{error}</Callout>
  if (moving) {
    const percent = progress?.bytesTotal ? (100 * progress.bytesDone) / progress.bytesTotal : progress?.total ? (100 * progress.done) / progress.total : 0
    return (
      <div role="status" className="space-y-2" data-testid="move-progress">
        <ProgressBar value={percent} />
        <p className="text-xs text-ink-muted">
          {progress ? `Moving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${progress.current ? `: ${progress.current}` : ''}` : 'Getting ready…'}
          {progress?.bytesTotal ? ` · ${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}` : ''}
        </p>
      </div>
    )
  }
  if (!result) return null
  return (
    <div role="status" className="space-y-2 text-sm" data-testid="move-result">
      <p className="text-ink">{result.moved ? `Moved ${result.moved} ${result.moved === 1 ? 'run' : 'runs'} to your current output folder.` : 'No runs were moved.'}</p>
      {result.skipped.length > 0 && (
        <div className="text-xs text-ink-muted">
          <p>{result.skipped.length} {result.skipped.length === 1 ? 'run was' : 'runs were'} left in the earlier folder and still show in the Library:</p>
          <ul className="mt-1 space-y-0.5">{result.skipped.slice(0, 20).map((item) => <li key={item.outputDir}><span className="text-ink">{item.videoTitle}</span>: {item.reason}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

/**
 * Picking a new output folder when the current one has Library runs asks
 * whether to move them there or keep them where they are. Either way they stay
 * in the Library: kept runs show under "Earlier output folders".
 */
export function useOutputFolderChange(commit: (dir: string) => Promise<void>): { change: (dir: string) => Promise<void>; dialog: React.JSX.Element | null } {
  const [pending, setPending] = useState<{ dir: string; from: string; runCount: number } | null>(null)
  const change = useCallback(async (dir: string): Promise<void> => {
    let info: { outputDirectory: string; runCount: number } | null = null
    try { info = await getApi().storage.folderChangeInfo() } catch { /* Ask anyway: the main process keeps the old folder's runs listed. */ }
    if (info && (info.runCount === 0 || info.outputDirectory === dir)) { await commit(dir); return }
    setPending({ dir, from: info?.outputDirectory ?? useSettingsStore.getState().outputDirectory, runCount: info?.runCount ?? 0 })
  }, [commit])
  const dialog = pending ? <OutputFolderChangeDialog {...pending} commit={commit} onClose={() => setPending(null)} /> : null
  return { change, dialog }
}

function OutputFolderChangeDialog({ dir, from, runCount, commit, onClose }: { dir: string; from: string; runCount: number; commit: (dir: string) => Promise<void>; onClose: () => void }): React.JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const { move, progress, result, error, moving } = useFolderMove()
  const [stage, setStage] = useState<'ask' | 'moving' | 'kept' | 'moved'>('ask')
  const [saveError, setSaveError] = useState<string | null>(null)
  const busy = stage === 'moving' && moving

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus()
    return () => previousFocus?.focus()
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const choose = async (mode: 'move' | 'keep'): Promise<void> => {
    setSaveError(null)
    await commit(dir)
    if (useSettingsStore.getState().outputDirectory !== dir) { setSaveError('The output folder could not be changed. Your Library was not moved.'); return }
    if (mode === 'keep') { setStage('kept'); return }
    setStage('moving')
    await move(from)
    setStage('moved')
  }

  return (
    <Dialog ref={panelRef} role="alertdialog" aria-labelledby={titleId} onBackdropMouseDown={() => { if (!busy) onClose() }} panelClassName="max-w-[480px]" data-testid="output-folder-change">
      <div className="space-y-3 px-5 pb-5 pt-5 text-sm text-ink-muted">
        <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-ink"><FolderInput aria-hidden className="h-4 w-4 text-ink-muted" />Your Library is in the current folder</h2>
        {stage === 'ask' && (
          <>
            <p>The current output folder has {runCount} Library {runCount === 1 ? 'run' : 'runs'}. What should happen to {runCount === 1 ? 'it' : 'them'}?</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><span className="text-ink">Move my Library there</span> moves the runs into the new folder. Runs that are in use are skipped and stay listed.</li>
              <li><span className="text-ink">Keep it where it is</span> leaves the files alone. The Library still shows them under Earlier output folders, and you can move them later.</li>
            </ul>
            <p className="break-all text-xs text-ink-subtle">From {from}<br />To {dir}</p>
            {saveError && <Callout tone="danger">{saveError}</Callout>}
          </>
        )}
        {stage === 'kept' && <p role="status" className="text-ink">Your new runs go to the new folder. Earlier runs stay where they are and still show in the Library under Earlier output folders.</p>}
        {(stage === 'moving' || stage === 'moved') && <MoveStatus progress={progress} result={result} error={error} moving={moving} />}
      </div>
      <DialogFooter>
        {stage === 'ask' ? (
          <>
            <Button data-autofocus onClick={onClose}>Cancel</Button>
            <Button onClick={() => { void choose('keep') }}>Keep it where it is</Button>
            <Button variant="primary" onClick={() => { void choose('move') }}>Move my Library there</Button>
          </>
        ) : (
          <Button variant="primary" disabled={busy} data-autofocus onClick={onClose}>Done</Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
