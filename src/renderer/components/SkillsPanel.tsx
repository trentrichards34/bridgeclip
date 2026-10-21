import { useEffect, useState, type ReactNode } from 'react'
import { Music2, Wand2 } from 'lucide-react'
import { MUSIC_TRACKS, musicTrackLabel, OWN_MUSIC_PREFIX } from '../../shared/music'
import { MusicPicker } from './MusicPicker'
import type { SkillId, SkillRow } from '../../shared/skills'
import { cn } from '../lib/utils'
import { getApi } from '../lib/ipc'
import { Badge } from './ui/Badge'
import { Switch } from './ui/Switch'

/**
 * A pick in the Skills music picker as ONE update: None (or the member's own track removed elsewhere) switches
 * Music off; a track picks it. Two updates in a row would each start from the same stale settings, and the
 * second would undo the first.
 */
export function pickSkillsMusic(track: string | null, onToggle: (id: SkillId, on: boolean) => void, onChange: (track: string) => void): void {
  if (track === null) onToggle('music', false)
  else onChange(track)
}

/** The chosen track is one of the member's own that no longer exists (null until their music is loaded). */
export function musicTrackMissing(track: string | null, own: readonly { id: string }[] | null): boolean {
  return Boolean(track && own && track.startsWith(OWN_MUSIC_PREFIX) && !own.some((item) => item.id === track))
}

/**
 * Skills: one on/off list over settings that already exist (see shared/skills.ts). Each switch writes the same
 * field as the detailed control; "More options" opens that control right under the skill, or takes the member to it.
 */
export function SkillsPanel({ rows, onToggle, onMore, expand, intro, className, music }: {
  rows: SkillRow[]
  onToggle: (id: SkillId, on: boolean) => void
  /** Where a skill's detailed control is ("More options"); undefined for skills with nothing more to set. */
  onMore?: (id: SkillId) => (() => void) | undefined
  /** A skill's detailed control, opened in place by "More options" (used before onMore). */
  expand?: (id: SkillId) => ReactNode | undefined
  intro?: string
  className?: string
  /** The music track, shown (and changeable) under the list while Music is on. */
  music?: { track: string | null; onChange: (track: string | null) => void }
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const [open, setOpen] = useState<SkillId | null>(null)
  const musicOn = rows.some((row) => row.id === 'music' && row.on)
  const ownTrack = Boolean(music?.track?.startsWith(OWN_MUSIC_PREFIX))
  // The member's own tracks, to tell when the chosen one was removed (Settings → My music).
  const [own, setOwn] = useState<{ id: string }[] | null>(null)
  useEffect(() => {
    if (!musicOn || !ownTrack) return
    let live = true
    getApi().music.list().then((list) => { if (live) setOwn(list.own) }).catch(() => { /* shown as chosen */ })
    return () => { live = false }
  }, [musicOn, ownTrack, picking])
  const missing = musicTrackMissing(music?.track ?? null, own)
  return (
    <section aria-labelledby="skills-title" className={cn('glass-tile rounded-2xl p-3', className)} data-testid="skills-panel">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id="skills-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Wand2 className="h-4 w-4 text-accent" aria-hidden />Skills</h3>
        <p className="text-2xs text-ink-subtle">{intro ?? 'Turn each part on or off. The detailed settings stay below.'}</p>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Skills">
        {rows.map((skill) => {
          const detail = expand?.(skill.id)
          const more = detail ? () => setOpen(open === skill.id ? null : skill.id) : onMore?.(skill.id)
          const expanded = Boolean(detail) && open === skill.id
          return (
            <li key={skill.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2" data-skill={skill.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                  {skill.label}
                  {skill.beta && <Badge tone="warning" className="h-4 px-1.5 text-[10px]">Beta</Badge>}
                </p>
                <p className="mt-0.5 text-2xs leading-snug text-ink-subtle">{skill.disabledReason ?? skill.note ?? skill.detail}</p>
                {more && (
                  <button type="button" onClick={more} aria-expanded={detail ? expanded : undefined} aria-controls={detail ? `skill-more-${skill.id}` : undefined}
                    className="mt-0.5 rounded text-2xs font-medium text-accent hover:underline focus-visible:underline">
                    {expanded ? 'Fewer options' : 'More options'}
                  </button>
                )}
                {expanded && <div id={`skill-more-${skill.id}`} className="mt-1.5 animate-fade-in">{detail}</div>}
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
              Music: <span className="truncate font-medium text-ink">{missing ? 'Your track was removed. Choose another.' : musicTrackLabel(music.track ?? MUSIC_TRACKS[0].id)}</span></p>
            <button type="button" aria-expanded={picking} onClick={() => setPicking(!picking)} className="rounded text-2xs font-medium text-accent hover:underline focus-visible:underline">
              {picking ? 'Done' : missing ? 'Choose music' : 'Change music'}
            </button>
          </div>
          {picking && <MusicPicker className="mt-2" value={missing ? null : music.track ?? MUSIC_TRACKS[0].id}
            onChange={(track) => { pickSkillsMusic(track, onToggle, music.onChange); if (track === null) setPicking(false) }} />}
        </div>
      )}
    </section>
  )
}
