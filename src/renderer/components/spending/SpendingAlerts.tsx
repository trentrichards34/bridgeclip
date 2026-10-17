import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, Wallet } from 'lucide-react'
import { SPENDING_LINKS } from '../../config/brand'
import { formatSpendUsd, LIMIT_WARNING_SHARE, OUT_OF_CREDITS_MESSAGES, type SpendGate, type SpendProvider } from '../../../shared/spending'
import { getApi } from '../../lib/ipc'
import { useSpendingStore } from '../../store/use-spending-store'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Dialog, DialogFooter } from '../ui/Dialog'

const creditsLink = (provider: SpendProvider): string => provider === 'fal' ? SPENDING_LINKS.falBilling : SPENDING_LINKS.openrouterCredits

function monthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}`
}

function readDismissed(): string | null {
  try { return localStorage.getItem('spending.limitNotice.dismissed') } catch { return null }
}

/**
 * App-wide spending notices: the check before a paid run (low balance or the
 * monthly limit), "out of credits" with a link to add more, and a notice at
 * 80% of the monthly limit.
 */
export function SpendingAlerts({ onOpenSpending }: { onOpenSpending: () => void }): React.JSX.Element | null {
  const overview = useSpendingStore((state) => state.overview)
  const [gate, setGate] = useState<{ gate: SpendGate; resolve: (start: boolean) => void } | null>(null)
  const [outOfCredits, setOutOfCredits] = useState<SpendProvider | null>(null)
  const [dismissedMonth, setDismissedMonth] = useState<string | null>(readDismissed)

  useEffect(() => {
    const spending = getApi().spending
    if (!spending) return
    void useSpendingStore.getState().load()
    spending.setGateHandler((next) => new Promise<boolean>((resolve) => setGate({ gate: next, resolve })))
    const unsubscribes = [
      spending.onChange(() => { void useSpendingStore.getState().load() }),
      spending.onOutOfCredits((provider) => setOutOfCredits(provider))
    ]
    return () => { spending.setGateHandler(null); unsubscribes.forEach((unsubscribe) => unsubscribe()) }
  }, [])

  const answer = (start: boolean): void => {
    gate?.resolve(start)
    setGate(null)
  }

  const limit = overview?.limitUsd ?? null
  const month = overview?.summary.thisMonthUsd ?? 0
  const nearLimit = limit !== null && month >= limit * LIMIT_WARNING_SHARE && dismissedMonth !== monthKey()
  const dismissLimit = (): void => {
    const key = monthKey()
    setDismissedMonth(key)
    try { localStorage.setItem('spending.limitNotice.dismissed', key) } catch { /* this session only */ }
  }

  return (
    <>
      {(outOfCredits || nearLimit) && (
        <div className="no-drag pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
          {outOfCredits && (
            <div className="glass pointer-events-auto rounded-2xl">
              <Callout tone="danger" title={outOfCredits === 'fal' ? 'fal.ai is out of credit' : 'OpenRouter is out of credits'} stacked onDismiss={() => setOutOfCredits(null)}
                action={<Button size="sm" variant="primary" trailingIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.openPath(creditsLink(outOfCredits))}>
                  Add credits
                </Button>}>
                {OUT_OF_CREDITS_MESSAGES[outOfCredits]}
              </Callout>
            </div>
          )}
          {nearLimit && limit !== null && (
            <div className="glass pointer-events-auto rounded-2xl">
              <Callout tone="warning" icon={<Wallet />} title={month >= limit ? 'Monthly AI spending limit reached' : 'Close to your monthly AI spending limit'} stacked onDismiss={dismissLimit}
                action={<Button size="sm" onClick={onOpenSpending}>Open Spending</Button>}>
                About {formatSpendUsd(month)} of your {formatSpendUsd(limit)} limit is used this month.
                {month >= limit ? ' Paid runs won’t start until next month, or until you raise the limit.' : ''}
              </Callout>
            </div>
          )}
        </div>
      )}
      {gate && <SpendGateDialog gate={gate.gate} onAnswer={answer} onOpenSpending={() => { answer(false); setTimeout(onOpenSpending, 50) }} />}
    </>
  )
}

function SpendGateDialog({ gate, onAnswer, onOpenSpending }: { gate: SpendGate; onAnswer: (start: boolean) => void; onOpenSpending: () => void }): React.JSX.Element {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); onAnswer(false) } }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onAnswer])
  const balance = gate.reason === 'balance'
  return (
    <Dialog role="alertdialog" aria-labelledby={titleId} onBackdropMouseDown={() => onAnswer(false)} panelClassName="max-w-[460px]" layer="system">
      <div className="px-5 pb-5 pt-5">
        <h2 id={titleId} className="text-base font-semibold text-ink">{balance ? 'Your OpenRouter balance is low' : 'Over your monthly AI spending limit'}</h2>
        <p className="mt-1.5 text-sm text-ink-muted" data-selectable>{gate.message}</p>
        <p className="mt-2 text-2xs text-ink-subtle">Amounts are CreatorClips’ estimates. Your actual balance and bills are on {gate.provider === 'fal' ? 'fal.ai' : 'OpenRouter'}.</p>
      </div>
      <DialogFooter>
        <Button ref={closeRef} variant="ghost" onClick={() => onAnswer(false)}>Don’t start</Button>
        {balance ? (
          <>
            <Button trailingIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => void getApi().shell.openPath(creditsLink(gate.provider))}>Add credits</Button>
            <Button variant="primary" onClick={() => onAnswer(true)}>Start anyway</Button>
          </>
        ) : (
          <Button variant="primary" onClick={onOpenSpending}>Change limit</Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
