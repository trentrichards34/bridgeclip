import { useCallback, useEffect, useState } from 'react'
import { FolderClock, FolderOpen, FolderInput } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { errorMessage, formatRelativeDate } from '../lib/utils'
import { formatBytes } from '../../shared/library-storage'
import type { HistoryEntry, PreviousFolder } from '../../preload/index'
import { useRunSizes } from '../hooks/use-run-sizes'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { ConfirmDialog, type ConfirmRequest } from './ui/ConfirmDialog'
import { MoveStatus, useFolderMove } from './OutputFolderChange'

/**
 * Runs left in earlier output folders. They stay watchable from here; to edit,
 * delete or change them, the member moves them into the current folder.
 */
export function PreviousFolders({ onOpen, onMoved, revision = 0 }: { onOpen: (entry: HistoryEntry) => void; onMoved: () => void; revision?: number }): React.JSX.Element | null {
  const [folders, setFolders] = useState<PreviousFolder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [movingFolder, setMovingFolder] = useState<string | null>(null)
  const closeConfirm = useCallback(() => setConfirm(null), [])
  const { move, progress, result, error: moveError, moving } = useFolderMove()

  const load = useCallback(async () => {
    if (typeof getApi().storage?.previousFolders !== 'function') return
    try { setFolders(await getApi().storage.previousFolders()) } catch (err) { setError(errorMessage(err, 'Could not read earlier output folders.')) }
  }, [])
  useEffect(() => { void load() }, [load, revision])
  const sizes = useRunSizes(folders.flatMap((folder) => folder.runs.map((run) => run.outputDir)), revision)

  if (!folders.length && !error) return null
  const moveAll = async (folder: string): Promise<void> => {
    setMovingFolder(folder)
    await move(folder)
    await load()
    onMoved()
  }

  return (
    <section aria-label="Earlier output folders" className="mt-10" data-testid="previous-folders">
      <div className="flex items-center gap-2">
        <FolderClock size={15} className="text-ink-muted" aria-hidden />
        <h2 className="text-sm font-medium text-ink">Earlier output folders</h2>
      </div>
      <p className="mt-1 text-xs text-ink-muted">Runs saved before you changed the output folder. Open them to watch or export. To edit them, delete them or mark them posted, move them into your current folder.</p>
      {error && <Callout tone="danger" className="mt-3" onDismiss={() => setError(null)}>{error}</Callout>}
      {folders.map((folder) => (
        <div key={folder.folder} className="glass mt-3 rounded-2xl p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-all font-mono text-xs text-ink-muted">{folder.folder}</p>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="primary" icon={<FolderInput className="h-3.5 w-3.5" />} disabled={!folder.exists || moving || (!folder.runs.length && !folder.otherFolders)}
                tooltip="Move these runs into your current output folder. Runs in use are skipped."
                onClick={() => { void moveAll(folder.folder) }}>Move to current folder</Button>
              <Button size="sm" variant="ghost" disabled={moving} onClick={() => setConfirm({
                title: 'Stop showing this folder?',
                body: <>Its runs will no longer show in the Library. Nothing is deleted: the files stay in this folder, and choosing it again as your output folder brings them back.<span className="mt-3 block break-all text-xs text-ink-subtle">{folder.folder}</span></>,
                confirmLabel: 'Stop showing',
                onConfirm: () => { void getApi().storage.forgetFolder(folder.folder).then(load).catch((err) => setError(errorMessage(err, 'Could not update the list.'))) }
              })}>Stop showing</Button>
            </div>
          </div>
          {movingFolder === folder.folder && (moving || result || moveError) && <div className="mt-3"><MoveStatus progress={progress} result={result} error={moveError} moving={moving} /></div>}
          {!folder.exists ? (
            <p className="mt-2 text-xs text-warning">This folder can’t be found. If it is on an external drive, connect it and refresh.</p>
          ) : folder.runs.length === 0 ? (
            <p className="mt-2 text-xs text-ink-subtle">{folder.otherFolders ? `No finished runs here, but ${folder.otherFolders} other CreatorClips ${folder.otherFolders === 1 ? 'folder' : 'folders'} can be moved.` : 'No Library runs left here.'}</p>
          ) : (
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {folder.runs.map((entry) => (
                <li key={entry.outputDir} className="flex items-center gap-3 py-2" data-testid="previous-run">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(entry)} aria-label={`Open ${entry.videoTitle}`}>
                    <p className="truncate text-sm text-ink" title={entry.videoTitle}>{entry.videoTitle}</p>
                    <p className="text-xs text-ink-subtle">
                      {formatRelativeDate(entry.date)} · {entry.clipCount} {entry.clipCount === 1 ? 'clip' : 'clips'}
                      {typeof sizes[entry.outputDir] === 'number' && <> · <span className="tabular-nums">{formatBytes(sizes[entry.outputDir] as number)}</span></>}
                    </p>
                  </button>
                  <Button size="sm" variant="ghost" iconOnly aria-label={`Open the folder of ${entry.videoTitle}`} tooltip="Show this run’s folder"
                    icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => { void getApi().shell.openPath(entry.outputDir).catch(() => setError('This run folder is no longer available.')) }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {confirm && <ConfirmDialog request={confirm} onClose={closeConfirm} />}
    </section>
  )
}
