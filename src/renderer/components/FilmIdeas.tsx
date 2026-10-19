import { useState } from 'react'
import { ArrowRight, Camera, ChevronDown, Lightbulb } from 'lucide-react'
import { FILM_FORMATS, IDEAS_ESTIMATE_USD, MAX_IDEA_MATERIAL_CHARS, MAX_IDEA_TOPIC_CHARS, type FilmIdea } from '../../shared/edit-recording'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Field, TextArea, TextInput } from './ui/Field'
import { Panel } from './ui/Panel'

/**
 * "What should I film?": five ideas from the member's brand, their goals and
 * anything they paste (notes, an article, a podcast transcript). Each comes
 * with a hook line and three talking points; "Film this" opens the recorder
 * with them as a teleprompter.
 */
export function FilmIdeas({ brandIdentityId, brandName, onFilm, onOpenRemix, disabled }: {
  brandIdentityId: string | null
  brandName: string | null
  onFilm: (idea: FilmIdea) => void
  onOpenRemix: () => void
  disabled?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [material, setMaterial] = useState('')
  const [ideas, setIdeas] = useState<FilmIdea[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = Boolean(brandIdentityId || topic.trim() || material.trim())

  const ask = async (): Promise<void> => {
    setWorking(true); setError(null)
    try { setIdeas(await getApi().edit.ideas({ brandIdentityId, topic, material })) } catch (err) { setError(errorMessage(err, 'No ideas came back. Try again.')) } finally { setWorking(false) }
  }

  return (
    <Panel>
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={open} aria-controls="film-ideas" onClick={() => setOpen(!open)}>
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold leading-5 text-ink"><Lightbulb className="h-4 w-4 text-accent" />What should I film?</span>
          <span className="mt-0.5 block text-xs text-ink-muted">Five video ideas from your brand and goals, each with a hook and three talking points.</span>
        </span>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id="film-ideas" className="mt-4 space-y-3">
          <p className="text-2xs text-ink-subtle">
            {brandName ? `Uses your brand “${brandName}” and the goals in your profile.` : 'Pick your brand above so the ideas fit your offer and voice, or paste something to work from.'} The ideas only use facts and numbers from your brand and what you paste here: nothing is made up.
          </p>
          <Field label="Topic (optional)">
            <TextInput aria-label="Topic" value={topic} maxLength={MAX_IDEA_TOPIC_CHARS} placeholder="e.g. pricing your first offer" onChange={(e) => setTopic(e.target.value)} />
          </Field>
          <Field label="Paste notes, an article or a podcast transcript (optional)" hint="Links aren’t opened: paste the words themselves.">
            <TextArea aria-label="Material to work from" rows={4} value={material} maxLength={MAX_IDEA_MATERIAL_CHARS} onChange={(e) => setMaterial(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={<Lightbulb className="h-4 w-4" />} loading={working} disabled={working || disabled || !ready} onClick={() => void ask()}>
              {ideas.length ? 'Give me 5 more' : 'Give me 5 ideas'}
            </Button>
            <span className="text-2xs text-ink-subtle">One short AI call through your OpenRouter account, about ${IDEAS_ESTIMATE_USD.toFixed(2)}.</span>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          {ideas.length > 0 && (
            <ol className="space-y-2" aria-label="Video ideas">
              {ideas.map((idea, i) => {
                const format = FILM_FORMATS.find((item) => item.id === idea.format) ?? FILM_FORMATS[0]
                return (
                  <li key={`${i}-${idea.hook}`} className="glass-tile rounded-xl p-3" aria-label={`Idea ${i + 1}: ${idea.title}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{idea.title}</p>
                        <p className="mt-0.5 text-sm text-ink">“{idea.hook}”</p>
                      </div>
                      <Badge>{format.label}</Badge>
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-ink-muted">{idea.points.map((point, k) => <li key={k}>• {point}</li>)}</ul>
                    {idea.why && <p className="mt-1 text-2xs text-ink-subtle">{idea.why}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" icon={<Camera className="h-3.5 w-3.5" />} onClick={() => onFilm(idea)}>Film this</Button>
                      {idea.format !== 'camera' && (
                        <Button size="sm" variant="ghost" onClick={onOpenRemix}>{format.label} is in Remix<ArrowRight className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </Panel>
  )
}
