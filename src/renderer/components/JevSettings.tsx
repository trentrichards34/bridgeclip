import { useEffect, useState } from 'react'
import { ArrowUpRight, ChevronRight, ShieldCheck } from 'lucide-react'
import { JEV_DEFAULTS, JEV_DOCS_URL, JEV_CONFIDENCE_URL, type JevThresholdKey } from '../../shared/jev-settings'
import { useSettingsStore } from '../store/use-settings-store'
import { getApi } from '../lib/ipc'
import { cn, errorMessage } from '../lib/utils'
import { Panel, PanelHeader } from './ui/Panel'
import { IconTile } from './ui/IconTile'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Switch } from './ui/Switch'
import { Callout } from './ui/Callout'

const controls: { key: JevThresholdKey; label: string; description: string }[] = [
  { key: 'jevThreshold', label: 'Clip quality', description: 'The clip opens with context, ends cleanly and flows. Each part must pass.' },
  { key: 'jevSelfContainedThreshold', label: 'Makes sense on its own', description: 'A viewer can follow the main point without the rest of the video.' },
  { key: 'jevFaithfulToSourceThreshold', label: 'True to the original', description: 'The edit keeps the meaning of what was said.' },
  { key: 'jevTitleSupportedThreshold', label: 'Honest title', description: 'What is said backs up the title, with nothing made up or overstated.' },
  { key: 'jevSponsorThreshold', label: 'No sponsor reads', description: 'The clip has no ads, paid promotions or affiliate pitches.' },
  { key: 'jevEvidenceThreshold', label: 'Enough to judge', description: 'There is enough of the transcript to judge a clip or a cut.' },
  { key: 'jevCutThreshold', label: 'Safe cuts', description: 'A removed section leaves the meaning intact and the join makes sense. Both must pass.' }
]
type Draft = Record<JevThresholdKey, string>
const toPercent = (value: string): string => String(Math.round(Number(value) * 10000) / 100)
const defaults = Object.fromEntries(controls.map(({ key }) => [key, toPercent(JEV_DEFAULTS[key])])) as Draft
const valid = (value: string): boolean => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100

/** Settings → Jev: TypeSafe's optional AI review of each clip, with its thresholds folded under Advanced. */
export function JevSettings(): React.JSX.Element {
  const settings = useSettingsStore()
  const signature = JSON.stringify(controls.map(({ key }) => settings[key]))
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(controls.map(({ key }) => [key, toPercent(settings[key])])) as Draft)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const values = JSON.parse(signature) as string[]
    setDraft(Object.fromEntries(controls.map(({ key }, index) => [key, toPercent(values[index])])) as Draft)
  }, [signature])
  const enabled = settings.jevEnabled === 'on'
  const busy = settings.saving || !settings.loaded
  const dirty = controls.some(({ key }) => Number(draft[key]) !== Number(toPercent(settings[key])) || draft[key] === '')
  const invalid = controls.some(({ key }) => !valid(draft[key]))
  const customized = controls.filter(({ key }) => Number(draft[key]) !== Number(defaults[key])).length
  const change = (key: JevThresholdKey, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }
  const save = async (patch: Parameters<typeof settings.save>[0]): Promise<void> => {
    setError(null)
    setSaved(false)
    try { await settings.save(patch); setSaved(true) }
    catch (err) { setError(errorMessage(err, 'Could not save Jev settings. Your changes are still here.')) }
  }
  const apply = (): void => {
    if (invalid || busy) return
    void save(Object.fromEntries(controls.map(({ key }) => [key, String(Math.round(Number(draft[key]) * 100) / 10000)])))
  }
  const open = (url: string): void => { void getApi().shell.openPath(url).catch((err) => setError(errorMessage(err, 'Could not open the page'))) }

  return (
    <section id="settings-jev" className="scroll-mt-4" aria-labelledby="jev-heading">
      <Panel>
        <PanelHeader
          icon={<IconTile><ShieldCheck /></IconTile>}
          title={<span id="jev-heading" className="inline-flex items-center gap-2">Jev <Badge tone="warning">Beta</Badge></span>}
          description="Quality check: an extra AI review of each clip before it’s kept."
          action={
            <Button size="sm" variant="ghost" trailingIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => open(JEV_DOCS_URL)} title="Jev is made by TypeSafe AI. Opens their docs.">
              By TypeSafe AI
            </Button>
          }
        />

        <div className="mt-4 flex items-start justify-between gap-4 rounded-2xl glass-well px-3 py-3">
          <div className="min-w-0">
            <p id="jev-enable-label" className="text-sm font-medium text-ink">Check automatic clips with Jev</p>
            <p id="jev-enable-description" className="mt-0.5 text-xs text-ink-muted">
              Off by default. When on, Jev must approve each automatic clip. It uses extra OpenRouter credit, and a run can end with fewer clips or none. Review &amp; edit always uses Jev.
            </p>
          </div>
          <Switch checked={enabled} disabled={busy} label="Check automatic clips with Jev" onChange={(on) => { void save({ jevEnabled: on ? 'on' : 'off' }) }} />
        </div>
        {!enabled && (
          <p role="status" className="mt-2 px-1 text-xs text-ink-subtle">
            Jev is off for automatic clips: they’re kept as the AI picked them. Review &amp; edit still uses Jev.
          </p>
        )}

        <details className="group mt-4 border-t border-white/[0.06] pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Advanced: how strict Jev is
            <span className="ml-auto text-2xs text-ink-subtle">{customized ? `${customized} changed` : 'Recommended settings'}</span>
          </summary>

          <p className="mt-3 text-xs text-ink-muted">
            Each check gives a score from 0 to 100%. A clip or cut is kept only if every score that applies is at or above its setting. Higher keeps fewer clips; lower lets more through. Most people never need to change these.
          </p>

          <fieldset disabled={busy} className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
            <legend className="sr-only">Jev settings for each check</legend>
            {controls.map(({ key, label, description }) => (
              <div key={key} className={cn('glass-well min-w-0 rounded-xl px-3 py-2.5', key === 'jevCutThreshold' && 'md:col-span-2')}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`${key}-number`} className="text-xs font-medium text-ink">{label}</label>
                  <span className="flex items-center gap-0.5 text-xs text-ink">
                    <input
                      id={`${key}-number`} type="number" min="0" max="100" step="0.01" inputMode="decimal"
                      value={draft[key]} aria-invalid={!valid(draft[key])} aria-describedby={`${key}-help`}
                      onChange={(e) => change(key, e.target.value)}
                      className={cn('w-14 rounded-md border bg-black/20 px-1.5 py-0.5 text-right font-mono tabular text-xs text-ink', valid(draft[key]) ? 'border-white/10' : 'border-danger/60')}
                    />
                    <span className="text-ink-subtle">%</span>
                  </span>
                </div>
                <p id={`${key}-help`} className="mt-1 text-2xs text-ink-subtle">{description}</p>
                <input
                  type="range" min="0" max="100" step="1" className="mt-1.5 block w-full"
                  aria-label={`${label} setting`} aria-describedby={`${key}-help`} aria-valuetext={`${draft[key]} percent`}
                  value={valid(draft[key]) ? draft[key] : 0} onChange={(e) => change(key, e.target.value)}
                />
                <div className="flex justify-between text-2xs text-ink-subtle"><span>Lets more through</span><span>Recommended {defaults[key]}%</span><span>Stricter</span></div>
              </div>
            ))}
          </fieldset>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="ghost" disabled={busy || !customized} onClick={() => { setDraft({ ...defaults }); setSaved(false); setError(null) }}>Back to recommended</Button>
            <div className="flex items-center gap-3">
              <span role="status" className="text-2xs text-ink-subtle">{busy ? 'Saving…' : invalid ? 'Enter a number from 0 to 100.' : dirty ? 'Not saved yet' : saved ? 'Saved' : 'Changes apply to new reviews'}</span>
              <Button size="sm" variant="primary" disabled={busy || !dirty || invalid} onClick={apply}>Apply</Button>
            </div>
          </div>

          <p className="mt-3 text-2xs text-ink-subtle">
            A score is how sure Jev is, not a promise the clip is right. Reviews you already ran keep the settings they used, so try a change on a few clips before you rely on it.{' '}
            <button type="button" className="text-ink-muted underline decoration-white/25 underline-offset-2 hover:text-ink" onClick={() => open(JEV_CONFIDENCE_URL)}>How Jev scores clips ↗</button>
          </p>

          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <label className="flex items-start gap-2.5 text-xs text-ink">
              <input type="checkbox" className="mt-0.5" checked={settings.jevVisualContext === 'on'} disabled={busy} onChange={(e) => { void save({ jevVisualContext: e.target.checked ? 'on' : 'off' }) }} />
              <span>
                Let Jev look at video frames for reaction clips
                <span className="mt-0.5 block text-2xs text-ink-subtle">When the words alone aren’t enough, still frames go to your OpenRouter vision model: up to 8 requests per run and 12 frames each, billed to your key. Applies wherever Jev runs, including Review &amp; edit.</span>
              </span>
            </label>
            <p className="mt-2 text-2xs text-ink-subtle">What Jev sees: transcript excerpts, titles and notes about the clip, sent through your OpenRouter key. No video or audio. Cuts Jev doesn’t approve are put back.</p>
          </div>
        </details>

        {error && <Callout tone="danger" className="mt-3"><span role="alert">{error}</span></Callout>}
      </Panel>
    </section>
  )
}
