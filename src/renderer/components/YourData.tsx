import { useEffect, useState } from 'react'
import { FolderOpen, HardDrive } from 'lucide-react'
import { getApi } from '../lib/ipc'
import { useSettingsStore } from '../store/use-settings-store'
import { isAvatarStudioEnabled } from '../../shared/features'
import { Button } from './ui/Button'

/** The services that can get data from CreatorClips, each only with the member's own key. */
export function dataDestinations(keys: { fal: boolean; heygen: boolean }, avatarStudio = isAvatarStudioEnabled()): { name: string; what: string }[] {
  const rows = [
    { name: 'OpenRouter', what: 'Audio, transcripts, video frames and text for the AI steps: transcribing, picking moments, writing, voices and AI images. ElevenLabs voices and transcription are used through OpenRouter.' },
    { name: 'Pexels', what: 'Search words for stock B-roll, only if you add a Pexels key.' },
    { name: 'Zernio', what: 'The clip, caption and accounts you post to, only if you connect Zernio.' }
  ]
  if (avatarStudio || keys.fal) rows.push({ name: 'fal.ai', what: 'Only for Avatar Studio’s Recreate, and only with your fal.ai key.' })
  if (avatarStudio || keys.heygen) rows.push({ name: 'HeyGen', what: 'Your script and avatar for HeyGen avatars, only with your HeyGen key.' })
  return rows
}

function folderOf(file: string): string {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return cut > 0 ? file.slice(0, cut) : file
}

function Row({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-[260px]">
        <p className="text-sm font-medium text-ink">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-ink-muted" data-selectable>{children}</div>
      </div>
      {action}
    </div>
  )
}

const Path = ({ value }: { value: string }): React.JSX.Element => <code className="break-all font-mono text-2xs text-ink-subtle">{value}</code>

/** Settings → About → Your data: where everything is, what leaves the computer, and how to uninstall. */
export function YourData(): React.JSX.Element {
  const { outputDirectory, falConfigured, heygenConfigured } = useSettingsStore()
  const [paths, setPaths] = useState<{ userData: string; logFile: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void getApi().diagnostics.dataPaths?.().then((value) => { if (live) setPaths(value) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  const reveal = (open: () => Promise<boolean> | undefined, what: string): void => {
    setError(null)
    void Promise.resolve(open()).then((ok) => { if (ok === false) setError(`Could not open ${what}.`) }, () => setError(`Could not open ${what}.`))
  }
  const finder = (onClick: () => void, label: string): React.JSX.Element => (
    <Button size="sm" variant="ghost" icon={<FolderOpen className="h-3.5 w-3.5" />} aria-label={label} onClick={onClick}>Show in Finder</Button>
  )
  return (
    <section aria-labelledby="your-data" className="mt-4 border-t border-white/[0.06] pt-4">
      <h3 id="your-data" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><HardDrive className="h-3.5 w-3.5 text-ink-muted" />Your data</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">Your videos are made on this computer. CreatorClips has no server of its own.</p>
      <div className="mt-3 divide-y divide-white/[0.06]">
        <Row title="Your videos" action={outputDirectory ? finder(() => reveal(() => getApi().shell.openPath(outputDirectory), 'the output folder'), 'Show the output folder in Finder') : undefined}>
          Saved in your output folder{outputDirectory ? <>: <Path value={outputDirectory} /></> : '.'} Change it under Output folder.
        </Row>
        <Row title="Settings, projects and keys" action={paths ? finder(() => reveal(() => getApi().diagnostics.openUserData?.(), 'the app data folder'), 'Show the app data folder in Finder') : undefined}>
          Kept in the app data folder{paths ? <>: <Path value={paths.userData} /></> : '.'} Your API keys are saved there encrypted, and the key that unlocks them is kept in your Mac’s Keychain.
        </Row>
        <Row title="Logs" action={finder(() => reveal(() => getApi().diagnostics.openLogFolder(), 'the logs folder'), 'Show the logs folder in Finder')}>
          A record of what the app did, to help with support{paths ? <>: <Path value={folderOf(paths.logFile)} /></> : '.'} They stay on this computer unless you send them.
        </Row>
        <Row title="What leaves this computer">
          <p>Only what goes to the services you set up, using your own keys:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {dataDestinations({ fal: falConfigured, heygen: heygenConfigured }).map((row) => <li key={row.name}><span className="text-ink">{row.name}:</span> {row.what}</li>)}
          </ul>
          <p className="mt-1">Video links you paste are downloaded from their site, and updates come from the CreatorClips releases page on GitHub.</p>
        </Row>
        <Row title="Uninstall">
          Quit CreatorClips, then drag it from Applications to the Trash. To remove your settings, projects and keys too, delete the app data folder above. Your videos stay in your output folder until you delete them.
        </Row>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  )
}
