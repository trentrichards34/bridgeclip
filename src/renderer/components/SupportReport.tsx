import { useEffect, useId, useRef, useState } from 'react'
import { Bell, ClipboardCopy, Download, ExternalLink, LifeBuoy, X } from 'lucide-react'
import { MAX_SUPPORT_LINK, effectiveSupportTarget, supportTarget, type EffectiveSupportTarget } from '../../shared/member-prefs'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { Button } from './ui/Button'
import { Callout } from './ui/Callout'
import { Dialog, DialogFooter } from './ui/Dialog'
import { Field, TextArea, TextInput } from './ui/Field'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

/** Where the report would go, in plain words, for the Report an issue dialog. */
export function supportTargetCopy(target: Pick<EffectiveSupportTarget, 'kind' | 'url' | 'public'>): { open: string; note: string; tone: 'warning' | 'info' } {
  if (target.kind === 'email') {
    const address = target.url.replace(/^mailto:/i, '').replace(/\?.*$/, '')
    return { open: 'Write an email', tone: 'info', note: `Opens an email to ${address}. Paste the report into it, or attach the saved file.` }
  }
  if (target.public) {
    return {
      open: 'Open the public issues page', tone: 'warning',
      note: 'This page is public — remove anything private. Anyone can read what’s posted on the CreatorClips issues page on GitHub, and posting needs a GitHub account. To send the report privately, save it to a file and send it to your support contact instead.'
    }
  }
  let host = target.url
  try { host = new URL(target.url).hostname } catch { /* show the link as is */ }
  return { open: 'Open support page', tone: 'info', note: `Opens ${host}. Paste the report there, or attach the saved file. Remove anything you’d rather not share first.` }
}

/**
 * "Report an issue": shows the support report first (never the keys), with
 * Save report to a file, Copy report and the support page. The report is never
 * added to a page for the member: the default page is public.
 */
export function ReportDialog({ jobId = null, extra, onClose }: {
  jobId?: string | null
  /** Added at the end of the report, like what a crashed page showed. */
  extra?: string
  onClose: () => void
}): React.JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [report, setReport] = useState<string | null>(null)
  const [target, setTarget] = useState<EffectiveSupportTarget | null>(null)
  const [working, setWorking] = useState<'save' | 'copy' | 'open' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    getApi().support.prepare(jobId).then((result) => {
      if (!live) return
      setReport(extra ? `${result.report}\n\nWhat the app showed:\n${extra}` : result.report); setTarget(result.target)
    }, (err) => {
      if (!live) return
      // The page details alone are still worth sending.
      if (extra) setReport(extra)
      setMessage({ tone: 'error', text: errorMessage(err, 'The support report could not be made.') })
    })
    return () => { live = false }
  }, [jobId, extra])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus() }
  }, [onClose])

  const act = async (kind: 'save' | 'copy' | 'open'): Promise<void> => {
    if (report === null) return
    setWorking(kind); setMessage(null)
    try {
      if (kind === 'save') {
        const result = await getApi().support.save(report)
        if (result.saved) setMessage({ tone: 'ok', text: 'Report saved. Send the file to your support contact by email or direct message.' })
      } else if (kind === 'copy') {
        await getApi().support.copyText(report)
        setMessage({ tone: 'ok', text: 'Report copied.' })
      } else {
        await getApi().support.open()
      }
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, kind === 'save' ? 'The report could not be saved.' : kind === 'copy' ? 'The report could not be copied.' : 'The support page could not be opened.') })
    } finally { setWorking(null) }
  }

  const copy = target ? supportTargetCopy(target) : null
  return (
    <Dialog ref={panelRef} aria-labelledby={titleId} onBackdropMouseDown={onClose} panelClassName="max-h-[min(720px,90dvh)] max-w-[620px]">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] px-5 py-4">
        <LifeBuoy className="h-5 w-5 text-ink-muted" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold text-ink">Report an issue</h2>
          <p className="mt-0.5 text-xs text-ink-muted">Check the report, then save it to a file or copy it to send to support.</p>
        </div>
        <Button iconOnly variant="ghost" aria-label="Close" icon={<X className="h-4 w-4" />} onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {copy && <Callout tone={copy.tone} title={copy.tone === 'warning' ? 'This page is public — remove anything private' : undefined}>{copy.tone === 'warning' ? copy.note.replace(/^This page is public — remove anything private\. /, '') : copy.note}</Callout>}
        <p className="text-xs text-ink-subtle">It has your app version, system, system check, which keys are saved (never the keys), the last error and recent log lines, with keys and personal folders removed. You can edit it before you send it.</p>
        <TextArea aria-label="Support report" value={report ?? ''} placeholder={report === null ? 'Making the report…' : undefined} readOnly={report === null}
          onChange={(e) => setReport(e.target.value)} rows={12} spellCheck={false} className="font-mono text-2xs" />
        {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-xs text-danger' : 'text-xs text-success'}>{message.text}</p>}
      </div>
      <DialogFooter className="flex-wrap">
        <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} loading={working === 'save'} disabled={working !== null || !report} onClick={() => void act('save')}>Save report to a file</Button>
        <Button size="sm" variant="ghost" icon={<ClipboardCopy className="h-3.5 w-3.5" />} loading={working === 'copy'} disabled={working !== null || !report} onClick={() => void act('copy')}>Copy report</Button>
        {copy && <Button size="sm" variant={target?.public ? 'secondary' : 'primary'} trailingIcon={<ExternalLink className="h-3.5 w-3.5" />} loading={working === 'open'} disabled={working !== null} onClick={() => void act('open')}>{copy.open}</Button>}
      </DialogFooter>
    </Dialog>
  )
}

/**
 * "Report an issue" shows the support report with Save to a file, Copy and the
 * support page (never pasting it anywhere). "Copy support report" only copies.
 */
export function ReportButtons({ jobId = null, size = 'md' }: { jobId?: string | null; size?: 'sm' | 'md' }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  useEffect(() => {
    if (message?.tone !== 'ok') return
    const timer = setTimeout(() => setMessage(null), 8000)
    return () => clearTimeout(timer)
  }, [message])
  const copy = async (): Promise<void> => {
    setWorking(true); setMessage(null)
    try {
      await getApi().support.report(jobId)
      setMessage({ tone: 'ok', text: 'Support report copied. Paste it in a private message to your support contact.' })
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'The support report could not be copied.') })
    } finally { setWorking(false) }
  }
  return (
    <>
      <Button size={size} variant="ghost" icon={<LifeBuoy className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />} disabled={working}
        tooltip="Shows the support report so you can check it, save it or copy it" onClick={() => setOpen(true)}>
        Report an issue
      </Button>
      <Button size={size} variant="ghost" icon={<ClipboardCopy className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />} loading={working} disabled={working}
        onClick={() => void copy()}>
        Copy support report
      </Button>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'basis-full text-xs text-danger' : 'basis-full text-xs text-success'}>{message.text}</p>}
      {open && <ReportDialog jobId={jobId} onClose={() => setOpen(false)} />}
    </>
  )
}

/** What an empty support link field means. */
function defaultSupportHint(): string {
  const fallback = effectiveSupportTarget('')
  return fallback.public
    ? 'Where Report an issue sends you, like your community’s support page or a support email. Empty: the public CreatorClips issues page on GitHub.'
    : 'Where Report an issue sends you, like your community’s support page or a support email. Empty: CreatorClips support.'
}

/** Settings → About: notifications, where "Report an issue" goes, and the report itself. */
export function SupportSettings(): React.JSX.Element {
  const { loaded, supportLink, notifyOnFinish, saveApp } = useMemberPrefsStore()
  const [draft, setDraft] = useState(supportLink)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setDraft(supportLink), [supportLink])
  const target = supportTarget(draft)
  const commit = async (): Promise<void> => {
    const value = draft.trim()
    if (value === supportLink) { setError(null); return }
    if (value && !target) { setError('Use an https:// link or an email address.'); return }
    try {
      await saveApp({ supportLink: value })
      setError(null); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) { setError(errorMessage(err, 'The support link could not be saved.')) }
  }
  return (
    <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
      <SettingRow
        title={<span className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5 text-ink-muted" />Notify me when a job finishes</span>}
        description="A desktop notification when clips, remixes or videos are ready (or fail) while you’re in another app."
        control={<Switch label="Notify me when a job finishes" checked={notifyOnFinish} disabled={!loaded}
          onChange={(value) => void saveApp({ notifyOnFinish: value }).catch((err) => setError(errorMessage(err)))} />} />
      <Field label="Support link or email (optional)"
        hint={error ? undefined : saved ? 'Saved.' : target ? `Report an issue shows the support report, then can open ${target.kind === 'email' ? 'an email to this address' : 'this link'}.` : defaultSupportHint()}>
        <TextInput aria-label="Support link or email" value={draft} maxLength={MAX_SUPPORT_LINK} placeholder="https://… or support@…" disabled={!loaded}
          onChange={(e) => { setDraft(e.target.value); setError(null) }} onBlur={() => void commit()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </Field>
      {error && <p role="alert" className="-mt-1 px-1 text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <ReportButtons size="sm" />
      </div>
      <p className="px-1 text-2xs text-ink-subtle">The report has your app version, system, system check, which keys are saved (never the keys), the last error and recent log lines with keys and personal folders removed.</p>
    </div>
  )
}
