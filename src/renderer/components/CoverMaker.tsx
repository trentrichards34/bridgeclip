import { useEffect, useRef, useState } from 'react'
import { Check, ImageIcon } from 'lucide-react'
import { COVER_SIZE, MAX_COVER_TEXT, type CoverExtension, type CoverSuggestions, type SavedCover } from '../../shared/covers'
import { getApi } from '../lib/ipc'
import { coverBytes, coverFontsReady, drawCover, frameBitmap } from '../lib/cover-draw'
import { cn } from '../lib/utils'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { Dialog, DialogFooter } from './ui/Dialog'
import { Field, TextArea } from './ui/Field'
import { Segmented } from './ui/Segmented'
import { Skeleton } from './ui/Skeleton'

const errorText = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
  return message || fallback
}

/**
 * Make my cover: three covers from the speaker's best frames of a finished reel or YouTube video, with words from the
 * video in its one look. The member picks one, can change the words, and saves it next to the video as JPG or PNG;
 * posting from CreatorClips then uses it as the cover.
 */
export function CoverMaker({ videoPath, onClose, onSaved }: { videoPath: string; onClose: () => void; onSaved?: (cover: SavedCover) => void }): React.JSX.Element {
  const [found, setFound] = useState<CoverSuggestions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  const [text, setText] = useState('')
  const [ext, setExt] = useState<CoverExtension>('jpg')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<SavedCover | null>(null)
  const [bitmaps, setBitmaps] = useState<ImageBitmap[]>([])
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    ref.current?.focus()
    getApi().covers.suggest(videoPath).then(async (result) => {
      await coverFontsReady(result.look)
      const images = await Promise.all(result.frames.map((f) => f.data ? frameBitmap(f.data) : Promise.reject(new Error('missing'))))
      if (!live) return
      setFound(result); setText(result.text); setBitmaps(images)
    }).catch((err) => { if (live) setError(errorText(err, 'Couldn’t look through the video for cover frames.')) })
    return () => { live = false; void getApi().covers.cancel(videoPath).catch(() => undefined) }
  }, [videoPath])

  // Redraw every choice with the words (a short pause while typing).
  useEffect(() => {
    if (!found) return
    const timer = setTimeout(() => {
      found.frames.forEach((frame, i) => {
        const canvas = canvases.current[i], bitmap = bitmaps[i]
        if (canvas && bitmap) drawCover(canvas, found.format, bitmap, frame, text, found.look)
      })
    }, 120)
    return () => clearTimeout(timer)
  }, [found, bitmaps, text])

  const save = async (): Promise<void> => {
    const canvas = canvases.current[picked]
    if (!found || !canvas || !bitmaps[picked]) return
    setSaving(true); setError(null)
    try {
      drawCover(canvas, found.format, bitmaps[picked], found.frames[picked], text, found.look)
      const cover = await getApi().covers.save(videoPath, await coverBytes(canvas, ext), ext)
      setSaved(cover); onSaved?.(cover)
    } catch (err) {
      setError(errorText(err, 'Couldn’t save the cover.'))
    } finally { setSaving(false) }
  }

  const format = found?.format ?? 'reel'
  const size = COVER_SIZE[format]
  const vertical = format === 'reel'
  return (
    <Dialog ref={ref} aria-label="Make my cover" onBackdropMouseDown={saving ? undefined : onClose} panelClassName="max-w-[860px]"
      onKeyDown={(e) => { if (e.key === 'Escape' && !saving) onClose() }}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-base font-semibold text-ink">Make my cover</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {vertical
              ? 'Three covers from your best frames: eyes open, face sharp and in the middle. The hook sits where Instagram and TikTok leave the picture clear.'
              : 'Three thumbnails from your best frames, with a few big words you said and your face on the other side.'}
          </p>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        {!found && !error && (
          <div className="space-y-2" data-testid="cover-loading">
            <p className="text-xs text-ink-muted">Looking through your video for your best frames…</p>
            <div className="flex gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className={vertical ? 'h-[300px] w-[169px]' : 'h-[135px] w-[240px]'} />)}</div>
          </div>
        )}
        {found && found.frames.length === 0 && (
          <Callout tone="warning">No clear frame of your face was found in this video, so there is no cover to make. You can still pick a frame as the cover when you post.</Callout>
        )}
        {found && found.frames.length > 0 && (
          <>
            <div role="radiogroup" aria-label="Covers" className="flex flex-wrap gap-3">
              {found.frames.map((frame, i) => (
                <button key={frame.atMs} type="button" role="radio" aria-checked={picked === i} aria-label={`Cover ${i + 1}`}
                  onClick={() => setPicked(i)}
                  className={cn('overflow-hidden rounded-xl ring-2 transition', picked === i ? 'ring-accent' : 'ring-transparent hover:ring-white/20')}>
                  <canvas ref={(el) => { canvases.current[i] = el }} width={size.width} height={size.height} data-testid={`cover-canvas-${i}`}
                    className={cn('block bg-black', vertical ? 'h-[300px] w-[169px]' : 'h-[135px] w-[240px]')} />
                </button>
              ))}
            </div>
            <Field label={vertical ? 'Hook on the cover' : 'Words on the thumbnail'}
              hint={vertical ? 'Your hook text. The last words go on the color box.' : 'Three to five words you said, picked from your video. Short reads best.'}>
              <TextArea rows={2} value={text} maxLength={MAX_COVER_TEXT} onChange={(e) => { setText(e.target.value); setSaved(null) }} aria-label="Cover words" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented<CoverExtension> label="File type" value={ext} onChange={(v) => { setExt(v); setSaved(null) }}
                options={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
              <span className="text-2xs text-ink-muted">{size.width} × {size.height}. Saved next to your video.</span>
            </div>
            {saved && (
              <Callout tone="success" title="Cover saved">
                Saved as {saved.path.split(/[\\/]/).pop()}. When you post this video from CreatorClips, it’s used as the cover.
              </Callout>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={saving} onClick={onClose}>{saved ? 'Done' : 'Cancel'}</Button>
        <Button variant="primary" icon={saved ? <Check className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />} loading={saving}
          disabled={saving || !found || found.frames.length === 0 || !text.trim()} onClick={() => void save()} data-testid="cover-save">
          {saved ? 'Save again' : 'Save cover'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
