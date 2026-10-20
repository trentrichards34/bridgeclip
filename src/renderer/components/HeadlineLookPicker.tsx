import { cn } from '../lib/utils'
import {
  DEFAULT_BRAND_COLOR, HEADLINE_FONTS, HEADLINE_LOOKS, headlineBarColor, headlineTextColor, isHexColor,
  type HeadlineLook
} from '../../shared/headline-look'
import { onRadioKeyDown, Segmented } from './ui/Segmented'

const SAMPLE = 'He tried to humble the whole room'

/** A small 9:16 frame showing the hook text in this look. */
function LookPreview({ look }: { look: HeadlineLook }): React.JSX.Element {
  const bar = headlineBarColor(look)
  const font = HEADLINE_FONTS.find((item) => item.id === look.font) ?? HEADLINE_FONTS[0]
  const text = font.upper ? SAMPLE.toUpperCase() : SAMPLE
  const color = headlineTextColor(look)
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[84px] overflow-hidden rounded-md bg-gradient-to-b from-slate-500 via-slate-700 to-slate-900" aria-hidden>
      <div className="absolute inset-x-0 bottom-0 top-[30%] bg-[radial-gradient(circle_at_50%_40%,rgb(255_255_255/0.28),transparent_55%)]" />
      <div
        className={cn('relative px-1.5 pb-1.5 pt-2.5 text-center leading-[1.15]', !bar && 'pt-3')}
        style={{
          background: bar ?? 'transparent',
          color,
          fontFamily: font.family,
          fontSize: font.upper ? 8 : 7.5,
          fontWeight: 800,
          textShadow: bar ? undefined : '0 0 2px #000, 0 1px 3px rgb(0 0 0 / 0.8)'
        }}
      >
        {look.look === 'none' ? '' : text}
      </div>
    </div>
  )
}

/** Choose how the hook text at the top looks: bar color or floating, and font. */
/** `compact`: for narrow side panels (the clip editor's inspector): three tiles per row and fonts that wrap, never wider than the panel. */
export function HeadlineLookPicker({ value, onChange, compact = false }: { value: HeadlineLook; onChange: (look: HeadlineLook) => void; compact?: boolean }): React.JSX.Element {
  return (
    <div className="space-y-2.5">
      <div className={cn('grid grid-cols-3 gap-2', !compact && 'sm:grid-cols-5')} role="radiogroup" aria-label="Hook text look">
        {HEADLINE_LOOKS.map((option) => {
          const selected = value.look === option.id
          const look: HeadlineLook = { ...value, look: option.id, color: option.id === 'brand' && value.look !== 'brand' && value.color === '#FFFFFF' ? DEFAULT_BRAND_COLOR : value.color }
          return (
            <button key={option.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
              title={option.hint}
              onClick={() => onChange(look)}
              className={cn('glass-tile glass-tile-hover flex flex-col gap-1.5 rounded-xl p-2 text-center', selected ? 'glass-selected text-ink' : 'text-ink-muted hover:text-ink')}>
              <LookPreview look={look} />
              <span className="block text-2xs font-medium">{option.label}</span>
            </button>
          )
        })}
      </div>
      <p className="text-2xs text-ink-subtle">{HEADLINE_LOOKS.find((item) => item.id === value.look)?.hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        {value.look !== 'none' && compact && (
          <div className="flex min-w-0 flex-wrap gap-1.5" role="radiogroup" aria-label="Hook text font">
            {HEADLINE_FONTS.map((font) => {
              const selected = value.font === font.id
              return (
                <button key={font.id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onKeyDown={onRadioKeyDown}
                  onClick={() => onChange({ ...value, font: font.id })}
                  className={cn('rounded-lg px-2.5 py-1 text-xs', selected ? 'bg-white/15 text-ink' : 'bg-white/[0.04] text-ink-muted hover:text-ink')}
                  style={{ fontFamily: font.family }}>{font.label}</button>
              )
            })}
          </div>
        )}
        {value.look !== 'none' && !compact && <Segmented
          label="Hook text font"
          size="sm"
          value={value.font}
          options={HEADLINE_FONTS.map((font) => ({ value: font.id, label: <span style={{ fontFamily: font.family }}>{font.label}</span> }))}
          onChange={(font) => onChange({ ...value, font })}
        />}
        {value.look === 'brand' && (
          <label className="flex items-center gap-2 text-2xs text-ink-muted">
            Bar color
            <input
              type="color"
              aria-label="Bar color"
              value={isHexColor(value.color) ? value.color.toLowerCase() : DEFAULT_BRAND_COLOR.toLowerCase()}
              onChange={(event) => { if (isHexColor(event.target.value)) onChange({ ...value, color: event.target.value.toUpperCase() }) }}
              className="h-7 w-10 cursor-pointer rounded-md border border-white/15 bg-transparent p-0.5"
            />
            <span className="font-mono text-ink-subtle">{value.color.toUpperCase()}</span>
          </label>
        )}
      </div>
    </div>
  )
}
