import { useCallback, useRef, useState } from 'react'
import { useSetupState } from '../store/use-settings-store'
import { useDraftStore } from '../store/use-draft-store'
import { useMemberPrefsStore } from '../store/use-member-prefs-store'
import { useJobStore } from '../store/use-job-store'
import { errorMessage } from '../lib/utils'
import { getApi } from '../lib/ipc'
import type { ClipJobRequest } from '../../shared/jobs'
import { JobForm } from '../components/JobForm'
import { useLowDiskGate } from '../components/LowDiskGate'
import { SetupCard } from '../components/SetupCard'
import { SetupChecklist } from '../components/SetupChecklist'
import { FirstRunGuide } from '../components/FirstRunGuide'
import { PageHeader } from '../components/ui/PageHeader'
import { Page } from '../components/ui/Page'
import { Callout } from '../components/ui/Callout'
import type { Page as PageId } from '../components/Sidebar'

/**
 * Create: the setup checklist (which asks for the OpenRouter key in its first
 * row, or the setup card when the checklist is closed) and the clipping wizard. Runs go
 * to the main process's queue and are followed on the Jobs page, so this page
 * is always ready for the next video.
 */
export function ClipPage({ onNavigate }: { onNavigate: (page: PageId) => void }): React.JSX.Element {
  const setup = useSetupState()
  const startingRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const lowDisk = useLowDiskGate()
  const ensureSpace = lowDisk.ensureSpace
  // The checklist asks for the key itself; the key card only when it isn't showing.
  const checklistShown = useMemberPrefsStore((state) => state.loaded && !state.setupChecklistDismissed)

  const handleSubmit = useCallback(async (configs: ClipJobRequest[]) => {
    if (startingRef.current || configs.length === 0) return
    startingRef.current = true
    setStarting(true)
    setStartError(null)
    try {
      // A nearly full drive asks first (and offers Free up space).
      if (!(await ensureSpace())) return
      if (configs.length > 1) {
        // Several videos: one job each, same settings (one spending check for all).
        const result = await getApi().job.startMany(configs)
        if (result.error) { setStartError(result.error); return }
        const started = result.started ?? []
        for (const item of started) useJobStore.getState().upsert(item.job)
        if (!started.length) {
          setStartError((result.failed ?? []).map((item) => item.error).filter((error, i, all) => all.indexOf(error) === i).join('\n') || 'Could not start these jobs.')
          return
        }
        useDraftStore.getState().markStarted({ jobId: started[0].jobId, source: started[0].videoUrl, queued: started.every((item) => item.queued), count: started.length, failed: result.failed ?? [] })
        if (configs[0].workflow === 'review') { useJobStore.getState().focusJob(null); onNavigate('jobs') }
        return
      }
      const config = configs[0]
      const result = await getApi().job.start(config)
      if (result.error) setStartError(result.error)
      else if (result.jobId) {
        // Starting must not depend on an event arriving before navigation.
        if (result.job) useJobStore.getState().upsert(result.job)
        else await getApi().job.list().then(useJobStore.getState().hydrate).catch(() => {})
        useDraftStore.getState().markStarted({ jobId: result.jobId, source: config.videoUrl, queued: Boolean(result.queued) })
        if (config.workflow === 'review') { useJobStore.getState().focusJob(result.jobId); onNavigate('jobs') }
      }
    } catch (err) {
      setStartError(errorMessage(err, 'Could not start the job. Please try again.'))
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }, [onNavigate, ensureSpace])

  const viewJob = useCallback((jobId: string) => {
    // Several videos: open the Jobs list, where they all show.
    useJobStore.getState().focusJob((useDraftStore.getState().started?.count ?? 1) > 1 ? null : jobId)
    onNavigate('jobs')
  }, [onNavigate])

  const blockedReason =
    setup.missingKeys.length > 0
      ? `Add your ${setup.missingKeys.join(' and ')} key${setup.missingKeys.length > 1 ? 's' : ''} above to start.`
      : setup.toolsOk === false
        ? 'Fix the missing tools in Settings to start.'
        : !setup.ready ? 'Checking required tools…' : undefined

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Studio"
        title="Create clips"
        description="Clips from your videos or ones you have permission to use. CreatorClips finds the strongest moments and cuts them into captioned clips."
      />

      <SetupCard className="mt-4" askForKey={!checklistShown} onOpenSettings={() => onNavigate('settings')} />
      <SetupChecklist className="mt-4" onNavigate={onNavigate} />
      <FirstRunGuide page="clip" />
      {lowDisk.element}

      {startError && (
        <Callout tone="danger" className="mt-3" onDismiss={() => setStartError(null)}>
          <span className="whitespace-pre-line">{startError}</span>
        </Callout>
      )}

      <JobForm className="mt-4" onSubmit={handleSubmit} onViewJob={viewJob} blockedReason={blockedReason} submitting={starting} onOpenRemix={() => onNavigate('remix')} />
    </Page>
  )
}
