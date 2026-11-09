/**
 * The Zooms row on the clip editor's timeline: one block per screen zoom (screen-zoom.ts) at its source time. Click
 * one to go to it; the bar under the row turns it on or off and makes it gentler or stronger, or turns every zoom
 * on or off. The output preview shows them live; Bake makes them exactly.
 */
import { useState } from 'react'
import { Segmented } from './ui/Segmented'
import { Switch } from './ui/Switch'
import { cn } from '../lib/utils'
import { patchZoom, setAllZooms, zoomsOn, type ZoomMove } from '../../shared/screen-zoom'

type Strength = 'gentle' | 'normal' | 'strong'
const STRENGTH: Record<Strength, number> = { gentle: .6, normal: 1, strong: 1.4 }
function strengthOf(m: ZoomMove): Strength {
  const k = m.intensity ?? 1
  return k < .8 ? 'gentle' : k > 1.2 ? 'strong' : 'normal'
}

export function ZoomsTrack({ zooms, viewStart, viewEnd, time, disabled, clock, onChange, seek }: {
  zooms: readonly ZoomMove[]; viewStart: number; viewEnd: number; time: number; disabled: boolean
  clock: (ms: number) => string; onChange: (zooms: ZoomMove[]) => void; seek: (ms: number) => void
}): React.JSX.Element {
  const [picked, setPicked] = useState<number | null>(null)
  const span = Math.max(1, viewEnd - viewStart)
  // The zoom the controls change: the one picked, else the one at the playhead.
  const current = zooms.find((m) => m.at_ms === picked) ?? zooms.find((m) => time >= m.at_ms && time < m.end_ms) ?? null
  const on = zoomsOn(zooms)
  return <>
    <div className="editor-lane"><span className="editor-lane-label" aria-hidden>Zooms</span>
      <div className="editor-zooms-track" aria-label="Screen zooms">{zooms.map((m) => {
        if (m.end_ms <= viewStart || m.at_ms >= viewEnd) return null
        const from = Math.max(m.at_ms, viewStart), to = Math.min(m.end_ms, viewEnd)
        const label = `${m.glow ? 'Zoom and box' : 'Zoom'} ${clock(m.at_ms)} to ${clock(m.end_ms)}${m.on === false ? ' (off)' : ''}`
        return <button key={m.at_ms} type="button" tabIndex={-1} title={`${label} · Click to go to it`} aria-label={label}
          className={cn('editor-zoom-block', m.on === false && 'off', current?.at_ms === m.at_ms && 'selected', m.glow && 'glow')}
          style={{ left: `${(from - viewStart) / span * 100}%`, width: `${(to - from) / span * 100}%` }}
          onClick={() => { setPicked(m.at_ms); seek(m.at_ms + Math.min(900, (m.end_ms - m.at_ms) / 2)) }} />
      })}</div></div>
    <div className="editor-zoom-bar" role="group" aria-label="Zoom settings">
      <span className="editor-zoom-name">All zooms</span>
      <Switch label="All zooms" checked={on > 0} disabled={disabled} onChange={(value) => onChange(setAllZooms(zooms, value))} />
      <span className="text-2xs text-ink-subtle">{on} of {zooms.length} on</span>
      {current ? <>
        <span className="editor-zoom-at">{current.glow ? 'Zoom and box' : 'Zoom'} at {clock(current.at_ms)}</span>
        <Switch label="This zoom" checked={current.on !== false} disabled={disabled} onChange={(value) => onChange(patchZoom(zooms, current.at_ms, { on: value }))} />
        <Segmented size="sm" label="How far it zooms" value={strengthOf(current)} onChange={(value) => { if (!disabled) onChange(patchZoom(zooms, current.at_ms, { intensity: STRENGTH[value] })) }}
          options={[{ value: 'gentle', label: 'Gentle' }, { value: 'normal', label: 'Normal' }, { value: 'strong', label: 'Strong', ...(current.max !== undefined && current.max <= 1.3 ? { disabled: 'Your recording isn’t sharp enough to zoom further.' } : {}) }]} />
      </> : <span className="text-2xs text-ink-subtle">Click a zoom to change it. The preview is close; Bake makes it exact.</span>}
    </div>
  </>
}
