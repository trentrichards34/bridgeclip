import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { ClipboardCopy, LifeBuoy, RotateCw, TriangleAlert } from 'lucide-react'
import { APP_NAME, APP_VERSION } from '../config/brand'
import { getApi } from '../lib/ipc'
import { Button } from './ui/Button'
import { ReportDialog } from './SupportReport'

/** What "Copy details" copies: the version, the error and where in the app it happened. */
export function crashDetails(error: unknown, componentStack?: string | null): string {
  const err = error instanceof Error ? error : null
  const lines = [
    `${APP_NAME} ${APP_VERSION}`,
    `Error: ${err ? `${err.name}: ${err.message}` : String(error)}`
  ]
  const stack = (componentStack ?? '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 12)
  if (stack.length) lines.push('Where:', ...stack.map((line) => `  ${line}`))
  return lines.join('\n')
}

/** The screen shown instead of a page that crashed: Reload, Copy details and Report an issue. */
export function CrashScreen({ details, scope = 'app' }: { details: string; scope?: 'app' | 'page' }): React.JSX.Element {
  const [reporting, setReporting] = useState(false)
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null)
  const copy = async (): Promise<void> => {
    try {
      // The main process's clipboard works even when the window isn't focused.
      if (getApi().support?.copyText) await getApi().support.copyText(details)
      else await navigator.clipboard.writeText(details)
      setCopied('ok')
    } catch { setCopied('error') }
  }
  return (
    <div className={scope === 'app' ? 'app-backdrop drag flex h-screen items-center justify-center p-6' : 'flex min-h-[60vh] items-center justify-center p-6'}>
      <div role="alert" className="glass no-drag w-full max-w-[460px] space-y-4 rounded-3xl px-6 py-6 text-center animate-pop-in">
        <TriangleAlert className="mx-auto h-7 w-7 text-warning" />
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
          <p className="text-sm leading-relaxed text-ink-muted">
            {scope === 'page' ? 'This page hit a problem and couldn’t be shown.' : `${APP_NAME} hit a problem and couldn’t show this screen.`} Reloading usually fixes it. If it keeps happening, report it so it can be fixed.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" icon={<RotateCw className="h-4 w-4" />} onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="ghost" icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => void copy()}>Copy details</Button>
          <Button variant="ghost" icon={<LifeBuoy className="h-4 w-4" />} onClick={() => setReporting(true)}>Report an issue</Button>
        </div>
        {copied && <p role="status" className={copied === 'ok' ? 'text-xs text-success' : 'text-xs text-danger'}>{copied === 'ok' ? 'Details copied.' : 'The details could not be copied.'}</p>}
      </div>
      {reporting && <ReportDialog extra={details} onClose={() => setReporting(false)} />}
    </div>
  )
}

interface Props {
  children: ReactNode
  /** 'app' fills the window; 'page' fills the page area and leaves the sidebar working. */
  scope?: 'app' | 'page'
}

interface State { error: unknown; componentStack: string | null }

/**
 * Catches a render error so the window never goes blank. The page area has its
 * own boundary (reset by navigating), and the whole app has one around it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown error') }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    const name = error instanceof Error ? error.name : 'Error'
    void getApi().diagnostics?.rendererError?.(name)?.catch(() => undefined)
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    const scope = this.props.scope ?? 'app'
    return (
      <CrashScreen scope={scope} details={crashDetails(this.state.error, this.state.componentStack)} />
    )
  }
}
