import { useState } from 'react'
import { CircleCheck, PlugZap } from 'lucide-react'
import type { HeygenAccount } from '../../shared/heygen'
import { getApi } from '../lib/ipc'
import { errorMessage } from '../lib/utils'
import { Button } from './ui/Button'

/** Settings → API keys: check the HeyGen key and show what is left on the account, as HeyGen reports it. */
export function HeygenKeyCheck({ configured }: { configured: boolean }): React.JSX.Element | null {
  const [checking, setChecking] = useState(false)
  const [account, setAccount] = useState<HeygenAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!configured) return null
  const check = async (): Promise<void> => {
    setChecking(true); setError(null)
    try { setAccount(await getApi().heygen.account()) } catch (err) { setAccount(null); setError(errorMessage(err, 'The key could not be checked.')) } finally { setChecking(false) }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="HeyGen key check">
      <Button size="sm" variant="ghost" icon={<PlugZap className="h-3.5 w-3.5" />} loading={checking} onClick={() => void check()}>Test HeyGen key</Button>
      <p className="min-w-0 flex-1 text-2xs text-ink-muted" role="status">
        {error ? <span className="text-danger">{error}</span>
          : account ? (
            <span className="inline-flex items-center gap-1">
              <CircleCheck className="h-3.5 w-3.5 text-success" />
              Works{account.name ? ` · ${account.name}` : ''}{account.remaining ? ` · ${account.remaining}` : ' · HeyGen didn’t report a balance'}
            </span>
          ) : 'Checks the key with HeyGen and shows what’s left on your account.'}
      </p>
    </div>
  )
}
