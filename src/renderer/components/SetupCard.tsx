import { KeyRound, ShieldCheck, Wrench } from 'lucide-react'
import { useSettingsStore, useSetupState } from '../store/use-settings-store'
import { useApiKeyDrafts } from '../hooks/use-api-key-drafts'
import { PROVIDER_LINKS } from '../config/brand'
import { cn } from '../lib/utils'
import { ApiKeyInput } from './ApiKeyInput'
import { Button } from './ui/Button'
import { IconTile } from './ui/IconTile'

/** The OpenRouter key field, saved as it's typed or pasted (the setup card and the setup checklist's first row). */
export function OpenRouterKeyField({ className }: { className?: string }): React.JSX.Element {
  const { drafts, setDraft, persist, error } = useApiKeyDrafts()
  return (
    <div className={className}>
      <ApiKeyInput
        label="OpenRouter key"
        value={drafts.openrouterApiKey}
        onChange={(v) => setDraft('openrouterApiKey', v)}
        onBlur={() => void persist()}
        placeholder="sk-or-…"
        getKeyUrl={PROVIDER_LINKS.openrouter}
      />
      <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-subtle">
        <ShieldCheck className="h-3.5 w-3.5 text-success/80" />
        Your key is encrypted on this computer with your system keychain.
      </p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

/**
 * First-run setup, inline on the Create page: paste the OpenRouter key here instead of
 * being sent to Settings. Hidden once the OpenRouter key exists and the tools check out.
 * With `askForKey` off (the setup checklist is showing and asks for the key in its first
 * row), only the missing-tools notice shows, so the key is asked for in one place.
 */
export function SetupCard({ onOpenSettings, askForKey = true, className }: { onOpenSettings: () => void; askForKey?: boolean; className?: string }): React.JSX.Element | null {
  const { missingKeys, toolsOk } = useSetupState()
  const toolStatus = useSettingsStore((s) => s.toolStatus)
  const toolError = useSettingsStore((s) => s.toolError)
  const missingTools = toolStatus
    ? [
        !toolStatus.python && 'Python',
        !toolStatus.pythonDeps && 'Clipping dependencies or smart framing',
        !toolStatus.ffmpeg && 'FFmpeg',
        !toolStatus.ffprobe && 'FFprobe',
        !toolStatus.ytdlp && 'yt-dlp',
        !toolStatus.engine && 'CreatorClips clipping engine',
        !toolStatus.bridgeRunner && 'Bridge runner'
      ].filter(Boolean).join(', ')
    : ''

  if (missingKeys.length > 0) {
    if (!askForKey) return null
    return (
      <section
        className={cn(
          'glass relative overflow-hidden rounded-3xl bg-accent/[0.05] animate-fade-in',
          'shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_0_0_1px_rgb(var(--accent)/0.22)]',
          className
        )}
        aria-label="Finish setup"
      >
        <div className="relative flex items-start gap-3 p-3.5 pb-0">
          <IconTile tone="accent">
            <KeyRound />
          </IconTile>
          <div className="min-w-0">
            <p className="eyebrow text-accent">One-time setup</p>
            <h2 className="mt-0.5 text-base font-semibold text-ink">Connect OpenRouter</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-ink-muted">
              CreatorClips has no account and no server. One OpenRouter key covers transcription and picking the best moments.
            </p>
          </div>
        </div>
        <OpenRouterKeyField className="relative m-3 rounded-xl bg-black/15 p-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" />
      </section>
    )
  }

  if (toolsOk === false) {
    return (
      <section
        className={cn(
          'flex items-center gap-3 rounded-3xl bg-danger/[0.07] p-3 pr-4 animate-fade-in',
          'shadow-[inset_0_0_0_1px_rgb(var(--danger)/0.26),inset_0_1px_0_rgb(255_255_255/0.06)]',
          className
        )}
      >
        <IconTile tone="danger">
          <Wrench />
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{toolError ? 'Could not check required tools' : 'Some required tools are missing'}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{toolError ? 'Open Settings to retry the system check.' : `Missing: ${missingTools}. Open Settings for details.`}</p>
        </div>
        <Button onClick={onOpenSettings}>See what’s missing</Button>
      </section>
    )
  }

  return null
}
