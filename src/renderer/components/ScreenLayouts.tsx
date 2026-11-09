import { SCREEN_KINDS, SCREEN_KIND_HINTS, SCREEN_KIND_LABELS, SCREEN_SPLIT, type ScreenKind } from '../../shared/screen-pair'
import { cn } from '../lib/utils'

/** A small drawing of a camera + screen layout: S is the screen, the round or square part is you. */
export function ScreenLayoutGlyph({ kind }: { kind: ScreenKind }): React.JSX.Element {
  const screen = 'rounded-[1px] bg-accent/70'
  const face = 'rounded-[1px] bg-ink/70'
  return (
    <span aria-hidden className="relative flex h-7 w-4 flex-col gap-[2px] overflow-hidden rounded-[3px] border border-white/25 p-[2px]">
      {kind === 'screen_top' && <><span className={cn('flex-[45]', screen)} /><span className={cn('flex-[55]', face)} /></>}
      {kind === 'face_top' && <><span className={cn('flex-[55]', face)} /><span className={cn('flex-[45]', screen)} /></>}
      {kind === 'face' && <span className={cn('flex-1', face)} />}
      {kind === 'screen' && <span className={cn('my-auto h-[7px]', screen)} />}
      {kind === 'bubble' && <><span className={cn('my-auto h-[7px]', screen)} /><span className="absolute bottom-[5px] right-[2px] h-[6px] w-[6px] rounded-full bg-ink/80" /></>}
    </span>
  )
}

/**
 * The clip editor's "Screen layout" row for a camera + screen clip: what this part of the clip shows. Each choice
 * replaces the layout of the part under the playhead; a split also gets the screen's size.
 */
export function ScreenLayoutRow({ value, share, onChoose, onShare, disabled }: {
  value: ScreenKind | null
  share: number
  onChoose: (kind: ScreenKind) => void
  onShare: (share: number) => void
  disabled?: boolean
}): React.JSX.Element {
  const split = value === 'screen_top' || value === 'face_top'
  return (
    <div className="space-y-2" data-testid="screen-layouts">
      <p className="editor-label">Screen layout</p>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Screen layout">
        {SCREEN_KINDS.map((kind) => (
          <button key={kind} type="button" role="radio" aria-checked={value === kind} disabled={disabled} title={SCREEN_KIND_HINTS[kind]}
            onClick={() => onChoose(kind)}
            className={cn('glass-tile glass-tile-hover flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs', value === kind ? 'glass-selected text-ink' : 'text-ink-muted')}>
            <ScreenLayoutGlyph kind={kind} />{SCREEN_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      {value === null && <p className="text-2xs text-ink-subtle">This part has a crop you set yourself. Pick a layout to reset it.</p>}
      {split && (
        <label className="editor-label block">Screen size <span className="float-right">{Math.round(share * 100)}% of the height</span>
          <input aria-label="Screen size" type="range" min={SCREEN_SPLIT.min * 100} max={SCREEN_SPLIT.max * 100} step={1} value={Math.round(share * 100)} disabled={disabled}
            onChange={(e) => onShare(Number(e.target.value) / 100)} />
        </label>
      )}
      <p className="text-2xs text-ink-subtle">Changes the part of the clip under the playhead. Use “New layout here” below to switch partway through.</p>
    </div>
  )
}
