import { useEffect, useState } from 'react'
import { ArrowUpRight, RefreshCw, Wallet } from 'lucide-react'
import { SPENDING_LINKS } from '../../config/brand'
import { formatSpendUsd, LIMIT_WARNING_SHARE, SPEND_KIND_LABELS, SPEND_KINDS, type SpendEntry } from '../../../shared/spending'
import { getApi } from '../../lib/ipc'
import { cn, errorMessage } from '../../lib/utils'
import { useSpendingStore } from '../../store/use-spending-store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Field, TextInput } from '../ui/Field'
import { IconTile } from '../ui/IconTile'
import { PanelHeader } from '../ui/Panel'
import { ProgressBar } from '../ui/ProgressBar'

const open = (url: string): void => { void getApi().shell.openPath(url) }

function when(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) +
    ' · ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function checkedAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  return minutes < 1 ? 'Checked just now' : minutes === 1 ? 'Checked 1 minute ago' : `Checked ${minutes} minutes ago`
}

/** Settings → Spending: totals from the app's own record, the OpenRouter balance and the monthly limit. */
export function SpendingSettings(): React.JSX.Element {
  const { overview, loadError, balance, balanceLoading, balanceError, load, refreshBalance } = useSpendingStore()

  useEffect(() => {
    void load()
    void refreshBalance(false)
  }, [load, refreshBalance])

  const summary = overview?.summary
  return (
    <>
      <PanelHeader
        icon={<IconTile tone="accent"><Wallet /></IconTile>}
        title="Spending"
        description="What your AI runs cost, as recorded by CreatorClips. These are the app’s estimates from what each provider reported (or from list prices where a provider reports nothing). Your actual bills are on OpenRouter and fal.ai."
      />
      {loadError && <Callout tone="danger" className="mt-3">{loadError}</Callout>}

      <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Spending totals" role="group">
        <Stat label="This month" value={summary ? formatSpendUsd(summary.thisMonthUsd) : '—'} />
        <Stat label="Last month" value={summary ? formatSpendUsd(summary.lastMonthUsd) : '—'} />
        <Stat label="All time" value={summary ? formatSpendUsd(summary.allTimeUsd) : '—'} />
      </div>

      <section aria-label="OpenRouter balance" className="mt-3 glass-tile rounded-2xl px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">OpenRouter balance</p>
            <p className="mt-0.5 text-xs text-ink-muted" role="status">
              {!overview?.openrouterConfigured ? 'Add your OpenRouter key in API keys to see it.'
                : balanceError ? balanceError
                  : balance?.remainingUsd != null ? <><span className="font-mono tabular text-ink">{formatSpendUsd(Math.max(0, balance.remainingUsd))}</span> left{balance.checkedAt ? ` · ${checkedAgo(balance.checkedAt)}` : ''}</>
                    : balance?.note ?? (balanceLoading ? 'Checking…' : 'Not checked yet.')}
            </p>
            {balance?.remainingUsd != null && balance.note && <p className="mt-1 text-2xs text-ink-subtle">{balance.note}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" aria-label="Refresh OpenRouter balance" loading={balanceLoading} disabled={!overview?.openrouterConfigured}
              icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void refreshBalance(true)}>Refresh</Button>
            <Button size="sm" trailingIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => open(SPENDING_LINKS.openrouterCredits)}>Add credits</Button>
          </div>
        </div>
      </section>

      <LimitField />

      <section aria-label="Spending by kind" className="mt-4">
        <h3 className="eyebrow px-1">By kind</h3>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-2xs text-ink-subtle">
              <th className="px-1 py-1 font-normal">Kind</th>
              <th className="px-1 py-1 text-right font-normal">This month</th>
              <th className="px-1 py-1 text-right font-normal">All time</th>
            </tr>
          </thead>
          <tbody>
            {SPEND_KINDS.map((kind) => (
              <tr key={kind} className="border-t border-white/[0.06]">
                <td className="px-1 py-1.5 text-ink">{SPEND_KIND_LABELS[kind]}</td>
                <td className="px-1 py-1.5 text-right font-mono tabular text-ink-muted">{summary ? formatSpendUsd(summary.byKind[kind].thisMonthUsd) : '—'}</td>
                <td className="px-1 py-1.5 text-right font-mono tabular text-ink-muted">{summary ? formatSpendUsd(summary.byKind[kind].allTimeUsd) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Recent spending" className="mt-4">
        <h3 className="eyebrow px-1">Last {Math.min(20, summary?.recent.length ?? 0) || 20} entries</h3>
        {summary && summary.recent.length === 0 ? (
          <p className="mt-2 px-1 text-xs text-ink-muted">Nothing recorded yet. Finished Create, Remix, Avatar Studio and Chat runs appear here with what they cost.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {summary?.recent.map((entry, index) => <EntryRow key={`${entry.at}-${index}`} entry={entry} />)}
          </ul>
        )}
      </section>

      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
        <Button size="sm" variant="ghost" trailingIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => open(SPENDING_LINKS.openrouterActivity)}>OpenRouter usage</Button>
        <Button size="sm" variant="ghost" trailingIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => open(SPENDING_LINKS.falBilling)}>fal.ai billing</Button>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="glass-tile rounded-xl px-3 py-2">
      <p className="text-2xs text-ink-subtle">{label}</p>
      <p className="mt-0.5 font-mono text-base tabular text-ink">{value}</p>
    </div>
  )
}

function EntryRow({ entry }: { entry: SpendEntry }): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
      <span className="w-36 shrink-0 text-2xs text-ink-subtle">{when(entry.at)}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{entry.label}</span>
      <span className="hidden text-2xs text-ink-subtle sm:inline">{SPEND_KIND_LABELS[entry.kind]} · {entry.provider === 'fal' ? 'fal.ai' : 'OpenRouter'}</span>
      {entry.estimated && <Badge>estimate</Badge>}
      <span className="w-16 shrink-0 text-right font-mono tabular text-ink">{formatSpendUsd(entry.usd)}</span>
    </li>
  )
}

function LimitField(): React.JSX.Element {
  const { overview, setLimit } = useSpendingStore()
  const saved = overview?.limitUsd ?? null
  const [draft, setDraft] = useState(saved === null ? '' : String(saved))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(saved === null ? '' : String(saved)) }, [saved])

  const commit = async (): Promise<void> => {
    const value = draft.trim()
    if (value === (saved === null ? '' : String(saved))) { setError(null); return }
    setSaving(true)
    try { await setLimit(value); setError(null) } catch (err) { setError(errorMessage(err, 'Could not save the limit.')) } finally { setSaving(false) }
  }
  const month = overview?.summary.thisMonthUsd ?? 0
  const share = saved ? month / saved : 0
  return (
    <div className="mt-4">
      <Field
        label="Monthly AI spending limit (USD)"
        htmlFor="spending-limit"
        hint="Optional. Before a paid run starts, CreatorClips checks that this month’s total plus the run’s estimate stays under it. Leave it empty for no limit."
      >
        <TextInput id="spending-limit" inputMode="decimal" placeholder="No limit" value={draft} disabled={saving} leading={<span className="text-ink-subtle">$</span>}
          onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') void commit() }} className="max-w-[180px]" />
      </Field>
      {error && <p role="alert" className="mt-1.5 text-xs text-danger">{error}</p>}
      {saved !== null && (
        <div className="mt-2">
          <ProgressBar value={Math.min(100, share * 100)} failed={share >= 1} />
          <p className={cn('mt-1 text-2xs', share >= LIMIT_WARNING_SHARE ? 'text-warning' : 'text-ink-subtle')}>
            {formatSpendUsd(month)} of {formatSpendUsd(saved)} used this month{share >= 1 ? ' · paid runs are paused until next month or a higher limit' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
