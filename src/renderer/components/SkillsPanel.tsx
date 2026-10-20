import { useState } from 'react'
import { Music2, Wand2 } from 'lucide-react'
import { MUSIC_TRACKS, musicTrackLabel } from '../../shared/music'
import { MusicPicker } from './MusicPicker'
import type { SkillId, SkillRow } from '../../shared/skills'
import { cn } from '../lib/utils'
import { Badge } from './ui/Badge'
import { Switch } from './ui/Switch'

/**
 * Skills: one on/off list over settings that already exist (see shared/skills.ts). Each switch writes the same
 * field as the detailed control; "More options" takes the member to that control.
 */
export function SkillsPanel({ rows, onToggle, onMore, intro, className, music }: {
  rows: SkillRow[]
  onToggle: (id: SkillId, on: boolean) => void
  /** Where a skill's detailed control is ("More options"); undefined for skills with nothing more to set. */
  onMore?: (id: SkillId) => (() => void) | undefined
  intro?: string
  className?: string
  /** The music track, shown (and changeable) under the list while Music is on. */
  music?: { track: string | null; onChange: (track: string | null) => void }
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const musicOn = rows.some((row) => row.id === 'music' && row.on)
  return (
    <section aria-labelledby="skills-title" className={cn('glass-tile rounded-2xl p-3', className)} data-testid="skills-panel">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id="skills-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Wand2 className="h-4 w-4 text-accent" aria-hidden />Skills</h3>
        <p className="text-2xs text-ink-subtle">{intro ?? 'Turn each part on or off. The detailed settings stay below.'}</p>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Skills">
        {rows.map((skill) => {
          const more = onMore?.(skill.id)
          return (
            <li key={skill.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2" data-skill={skill.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                  {skill.label}
                  {skill.beta && <Badge tone="warning" className="h-4 px-1.5 text-[10px]">Beta</Badge>}
                </p>
                <p className="mt-0.5 text-2xs leading-snug text-ink-subtle">{skill.disabledReason ?? skill.note ?? skill.detail}</p>
                {more && (
                  <button type="button" onClick={more} className="mt-0.5 rounded text-2xs font-medium text-accent hover:underline focus-visible:underline">
                    More options
                  </button>
                )}
              </div>
              <Switch label={skill.label} checked={skill.on} disabled={skill.disabledReason !== null && !skill.on} onChange={(on) => onToggle(skill.id, on)} />
            </li>
          )
        })}
      </ul>
      {music && musicOn && (
        <div className="mt-2 rounded-xl bg-white/[0.03] px-3 py-2" data-testid="skills-music">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-muted"><Music2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Music: <span className="truncate font-medium text-ink">{musicTrackLabel(music.track ?? MUSIC_TRACKS[0].id)}</span></p>
            <button type="button" aria-expanded={picking} onClick={() => setPicking(!picking)} className="rounded text-2xs font-medium text-accent hover:underline focus-visible:underline">
              {picking ? 'Done' : 'Change music'}
            </button>
          </div>
          {picking && <MusicPicker className="mt-2" value={music.track ?? MUSIC_TRACKS[0].id}
            onChange={(track) => { if (track === null) onToggle('music', false); music.onChange(track); if (track === null) setPicking(false) }} />}
        </div>
      )}
    </section>
  )
}
