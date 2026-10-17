import { useEffect, useState } from 'react'
import { Bell, ClipboardCopy, LifeBuoy } from 'lucide-react'
import { MAX_SUPPORT_LINK, supportTarget } from '../../shared/member-prefs'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { Button } from './ui/Button'
import { Field, TextInput } from './ui/Field'
import { SettingRow } from './ui/SettingRow'
import { Switch } from './ui/Switch'

/** What to tell the member after the report is on the clipboard. */
export function reportNotice(opened: 'email' | 'link' | null): string {
  if (opened === 'email') return 'Support report copied. Paste it into the email that just opened.'
  if (opened === 'link') return 'Support report copied. Paste it into the support page that just opened.'
  return 'Support report copied. Paste it in your support chat.'
}

/**
 * "Report an issue" copies the support report, then opens the member's
 * support link or email when one is set. "Copy support report" only copies.
 */
export function ReportButtons({ jobId = null, size = 'md' }: { jobId?: string | null; size?: 'sm' | 'md' }): React.JSX.Element {
  const hasLink = useMemberPrefsStore((state) => Boolean(supportTarget(state.supportLink)))
  const [working, setWorking] = useState<'report' | 'copy' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  useEffect(() => {
    if (message?.tone !== 'ok') return
    const timer = setTimeout(() => setMessage(null), 8000)
    return () => clearTimeout(timer)
  }, [message])
  const run = async (open: boolean): Promise<void> => {
    setWorking(open ? 'report' : 'copy'); setMessage(null)
    try {
      const result = await getApi().support.report(jobId, open)
      setMessage({ tone: 'ok', text: reportNotice(result.opened) })
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'The support report could not be copied.') })
    } finally { setWorking(null) }
  }
  return (
    <>
      <Button size={size} variant="ghost" icon={<LifeBuoy className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />} loading={working === 'report'} disabled={working !== null}
        tooltip={hasLink ? 'Copies the support report, then opens your support link' : 'Copies the support report for your support chat'} onClick={() => void run(true)}>
        Report an issue
      </Button>
      <Button size={size} variant="ghost" icon={<ClipboardCopy className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />} loading={working === 'copy'} disabled={working !== null}
        onClick={() => void run(false)}>
        Copy support report
      </Button>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'basis-full text-xs text-danger' : 'basis-full text-xs text-success'}>{message.text}</p>}
    </>
  )
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
        description="A desktop notification when clips, remixes or an avatar video are ready (or fail) while you’re in another app."
        control={<Switch label="Notify me when a job finishes" checked={notifyOnFinish} disabled={!loaded}
          onChange={(value) => void saveApp({ notifyOnFinish: value }).catch((err) => setError(errorMessage(err)))} />} />
      <Field label="Support link or email (optional)"
        hint={error ? undefined : saved ? 'Saved.' : target ? `Report an issue copies the support report, then opens ${target.kind === 'email' ? 'an email to this address' : 'this link'}.` : 'Where Report an issue sends you, like your community’s support page or a support email. Empty: it only copies the report.'}>
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
