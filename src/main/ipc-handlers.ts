import { openEditor, saveEditor, runEditor, cancelEditor, replaceEditorSource } from './clip-editor'
import { mediaAccessStatus, requestMediaAccess } from './media-permissions'
import { uniqueFileName, writeZip } from './clip-zip'
import { randomUUID } from 'crypto'
import { RECORDING_VIDEO_EXTENSIONS, REMIX_IMAGE_EXTENSIONS } from '../shared/remix'
import { LOGO_EXTENSIONS } from '../shared/brand-kit'
import { addEditorCandidate, editorCallEstimate, editorCloseReady, editorOperationStatus, editorTranslationEstimate, freeEditorMedia, onEditorExportCta, onEditorRunLock, onEditorSpend, readEditorProgress, suggestEditorHooks } from './clip-editor'
import { automaticEditInfo, prepareAutomaticEditor } from './edit-automatic'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, realpathSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { loadSettings, publicSettings, replaceApiKey, savePublicSettings, saveSpendLimit, type ApiKeyName, type PublicSettings } from './settings-store'
import { getJobHistory, getJobOutput, generateThumbnail } from './file-manager'
import { measureOutputStorage } from './output-storage'
import { inspectEdits } from './edit-inspector'
import { getEnginePath, getBridgeRunnerPath, resolvePythonPath, validatePython } from './pipeline-runner'
import { cancelTrackedJob, dismissJob, initJobManager, listJobs, liveJobIds, onJobUpdate } from './job-manager'
import { allowOnce, assertSpendAllowed, friendlyIpcError, initSpending, metered, meteredAvatarRender, onOutOfCredits, onSpendingChange, openRouterBalance, recordSpend, spendOverview, trackAvatarStatus, trackJobSnapshot, trackRemixStatus } from './spending'
import { readTimecodeScreenshot } from './moment-take'
import { MAX_TIMECODE_IMAGE_BYTES, parseMomentRanges, type TimecodeRead } from '../shared/moment-take'
import { friendlyCreditError, type SpendProvider } from '../shared/spending'
import { AI_PORTRAIT_CANDIDATES, estimateRecreateCost, estimateRenderCost, PRICES, REACTIONS } from '../shared/avatars'
import { estimateRemixCost, isRemixHost, MAX_REMIXES } from '../shared/remix'
import { deletePreset, readMemberPrefs, renamePreset, saveAppPrefs, saveLastStyle, savePreset, saveProfile } from './member-prefs'
import { recordToolCheck, reportIssue } from './support-report'
import { announce, avatarNotice, createNotice, remixNotice } from './job-notifications'
import { libraryClipForRemix } from './library-source'
import { dropMissing, type MemberPrefs } from '../shared/member-prefs'
import { moreClipsInfo, startClipJobRequest, startClipJobRequests, startMoreClips } from './job-start'
import { MAX_CREATE_SOURCES } from '../shared/create-sources'
import { addBackgrounds, listBackgrounds, removeBackground } from './backgrounds'
import { addCta, applyRunCta, applyRunCtaInLock, listCtas, removeCta, updateCta, withRunLock } from './ctas'
import { CTA_IMAGE_EXTENSIONS, CTA_VIDEO_EXTENSIONS, parseCtaChoice } from '../shared/ctas'
import { addPhotoToAvatar, cloneVoice, cloningInProgress, createAvatar, removePicture, usePicture, draftFromPhoto, draftsFromDescription, restyleDrafts, setPortrait, listAvatars, PHOTO_EXTENSIONS, readReactions, removeAvatar, updateAvatar, VOICE_SAMPLE_EXTENSIONS } from './avatars'
import { voiceSample } from './voice-samples'
import { makeReactions, reactionsInProgress, REACTION_VIDEO_EXTENSIONS, removeReaction, uploadReaction } from './reactions'
import { anotherMoment, momentEstimate, momentTalkingPoints, setMomentBounds, pauseView, setPauseSettings, setRemixTrim, recomposeRemix, remixRunBusy, writeRemix, abortRecording, appendRecording, beginRecording, finishRecording, remixMoment, remixRecordings, removeRecording, uploadRecording, onRemixMomentSpend, BRAND_IDENTITY_EXTENSIONS, importBrandLogo, cancelRemix, discardRemix, renderRemix, listBrandIdentities, onRemixStatus, remixAvatarInUse, remixFolderInUse, readBrandIdentityFile, remixStatus, removeBrandIdentity, saveBrandIdentity, startRemix } from './remix'
import { importLegacyAvatarVideos } from './avatar-library'
import { avatarInUse, avatarRenderStatus, avatarRunBusy, cancelAvatarRender, onAvatarRenderStatus, parseRenderRequest, startAvatarRecreate, startAvatarRender, writeAvatarScript } from './avatar-studio'
import { logger, getLogFilePath } from './logger'
import { assertAbsolutePath, assertMediaPath, assertTrustedSender, authorizeMedia, isTrustedExternalUrl, isWebUrl, isWithinDirectory, isWithinLibrary, openAuthorizedMedia, setExtraLibraryRoots } from './security'
import { cleanupPlan, folderChangeInfo, forgetFolder, freeSpace, listPreviousFolders, moveFolderRuns, onOutputFolderChanged, runCleanup, runSizes } from './library-storage'
import { previousOutputFolders } from './library-folders'
import { getModelCatalog } from './openrouter-models'
import { getYouTubePreview } from './youtube-preview'
import { resolveBinary, supportsCaptionFilter } from './tools'
import { automationEnhancementGroups, enhanceAutomationBatch, automationContentSource, enhanceAutomationContent, resolveAutomationMetadataDraft, addAutomationContent, addLibraryClipsToAutomation, createAutomation, deleteAutomation, isAutomationMedia, listAutomations, removeAutomationContent, runAutomation, updateAutomation, updateAutomationContent, approveAutomationTikTokReview, prepareAutomationTikTokReview } from './automations'
import { unscheduleAutomationContent, acknowledgeAutomationWarnings, retryAutomationContent, dismissAutomationMetadataError, automationLibraryClip, reorderAutomationContent, reviewAutomationContent, showAutomationContentInFolder } from './automations'
import { libraryPostingStatus, libraryMetadataSource, enhanceLibraryMetadata } from './library-posting'
import { libraryPostingSummary, postPerformanceInsights } from './library-posting'
import { readyToPost } from './ready-to-post'
import { deleteLibraryClips, deleteLibraryRun, setLibraryClipCta, setLibraryFavorite, setLibraryPosted, setRunBusyCheck } from './library-management'
import {
  cancelZernioConnect,
  connectZernioAccount,
  createZernioProfile,
  disconnectZernioAccount,
  getPendingZernioConnect,
  getZernioOverview,
  readCachedOverview,
  resetZernioState,
  syncZernioAccounts,
  checkZernioStatus
} from './zernio/service'
import {
  cancelPost,
  cancelUpload,
  clipSubtitlesForPosting,
  coverImageForPosting,
  dismissPost,
  getTikTokCreatorInfo,
  listPosts,
  openPostLink,
  openTikTokLegal,
  probeClipForPosting,
  publishClip,
  refreshPosts,
  refreshPostStats,
  reschedulePost,
  retryPost
} from './zernio/posts'

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  // Clips exported from the editor end with their call to action, like the run's.
  onEditorRunLock(withRunLock)
  // Editor AI calls (caption translation on a bake, hook ideas) join the spending ledger.
  onEditorSpend((usd, label) => recordSpend({ kind: 'create', provider: 'openrouter', usd, label }))
  // Runs inside the export's run lock (onEditorRunLock), so it uses the in-lock version.
  onEditorExportCta(async (run, ctaId, index) => {
    const { failed } = await applyRunCtaInLock(run, ctaId, [index])
    if (failed.length) throw new Error('The call to action could not be added.')
  })
  const selectedOutputDirectories = new Set<string>()
  initJobManager(getMainWindow)
  // Errors where a provider says the credit ran out reach the page in the same plain words (and show the add-credits banner).
  const handle: typeof ipcMain.handle = (channel, listener) => ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    let result: unknown
    try { result = listener(event, ...args) } catch (error) { throw friendlyIpcError(error) }
    return typeof (result as PromiseLike<unknown> | null)?.then === 'function'
      ? Promise.resolve(result).catch((error: unknown) => { throw friendlyIpcError(error) })
      : result
  })
  const sendToWindow = (channel: string, payload?: unknown): void => {
    const window = getMainWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
  }
  // Spending: the ledger, the OpenRouter balance and the check before paid runs.
  initSpending()
  onSpendingChange(() => sendToWindow('spend:changed'))
  onOutOfCredits((provider) => sendToWindow('spend:outOfCredits', provider))
  onJobUpdate(trackJobSnapshot)
  /** A paid handler: the spending check (monthly limit, OpenRouter balance) runs first. */
  const paid = (channel: string, provider: SpendProvider, estimate: (...args: unknown[]) => number | null,
    run: (...args: unknown[]) => unknown): void => {
    handle(channel, async (_event, ...args: unknown[]) => {
      let estimateUsd: number | null = null
      try { estimateUsd = estimate(...args) } catch { estimateUsd = null }
      await assertSpendAllowed(channel, provider, estimateUsd)
      return run(...args)
    })
  }
  handle('spend:overview', () => spendOverview())
  handle('spend:balance', (_event, force: unknown) => openRouterBalance(force === true))
  handle('spend:setLimit', async (_event, value: unknown) => { saveSpendLimit(value); sendToWindow('spend:changed'); return spendOverview() })
  handle('spend:allowOnce', (_event, channel: unknown) => allowOnce(channel))
  // Remembered styles, saved styles, the support link and notifications (member-prefs.json).
  // Styles name library items by id: ones deleted since are dropped as they're read.
  const known = async (prefs: MemberPrefs): Promise<MemberPrefs> => {
    const [ctas, avatars, brands, backgrounds] = await Promise.all([
      listCtas().catch(() => []), listAvatars().catch(() => []), listBrandIdentities().catch(() => []), listBackgrounds().catch(() => [])
    ])
    const result = dropMissing(prefs, {
      ctaIds: new Set(ctas.map((item) => item.id)), avatarIds: new Set(avatars.map((item) => item.id)),
      brandIds: new Set(brands.map((item) => item.id)), backgrounds: new Set(backgrounds)
    })
    // End-to-end tests start on a fresh profile; the guided setup only opens in the tests that ask for it.
    if (process.env.BRIDGECLIP_E2E === '1' && process.env.BRIDGECLIP_E2E_ONBOARDING !== '1' && result.profile.onboarding === 'new') {
      return { ...result, profile: { ...result.profile, onboarding: 'skipped' } }
    }
    return result
  }
  handle('prefs:load', () => known(readMemberPrefs()))
  handle('prefs:saveLast', (_event, kind: unknown, style: unknown) => { saveLastStyle(kind, style) })
  handle('prefs:savePreset', (_event, kind: unknown, name: unknown, style: unknown) => known(savePreset(kind, name, style)))
  handle('prefs:renamePreset', (_event, kind: unknown, id: unknown, name: unknown) => known(renamePreset(kind, id, name)))
  handle('prefs:deletePreset', (_event, kind: unknown, id: unknown) => known(deletePreset(kind, id)))
  handle('prefs:saveApp', (_event, update: unknown) => known(saveAppPrefs(update)))
  handle('prefs:saveProfile', (_event, update: unknown) => known(saveProfile(update)))
  handle('app:mediaAccessStatus', () => mediaAccessStatus())
  // Copy the support report (never the keys); "Report an issue" then opens the member's support link.
  handle('support:report', (_event, jobId: unknown, open: unknown) => reportIssue(jobId, open === true, [
    () => { const status = remixStatus(); return status?.phase === 'failed' ? { what: 'Remix', message: status.error, at: null } : null },
    () => { const status = avatarRenderStatus(); return status?.phase === 'failed' ? { what: 'Avatar Studio', message: status.error, at: status.startedAt } : null }
  ]))
  handle('library:remixSource', (_event, outputDir: unknown, clipIndex: unknown) => libraryClipForRemix(outputDir, clipIndex))
  // A desktop notification when a long job finishes while the app is in the background.
  onJobUpdate((job) => announce(createNotice(job), getMainWindow))

  handle('settings:load', () => {
    return publicSettings(loadSettings())
  })
  handle('settings:storageUsage', (_event, fresh: unknown = false) => measureOutputStorage(loadSettings().outputDirectory, { fresh: fresh === true }))
  handle('models:list', (_event, refresh: unknown = false) => getModelCatalog(refresh))
  handle('source:youtubePreview', (_event, source: unknown, details: unknown = false) => getYouTubePreview(source, details))

  handle('settings:save', (_event, settings: PublicSettings) => {
    const current = loadSettings()
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings')
    if (typeof settings.outputDirectory !== 'string' || typeof settings.pythonPath !== 'string' || typeof settings.customVocabulary !== 'string') throw new Error('Invalid settings')
    if (settings.outputDirectory !== current.outputDirectory && !selectedOutputDirectories.has(settings.outputDirectory)) throw new Error('Choose the output folder with the folder picker')
    if (app.isPackaged && settings.pythonPath !== current.pythonPath) throw new Error('Runtime paths cannot be changed in packaged builds')
    const saved = savePublicSettings(settings)
    // The old folder's runs stay in the Library (as an earlier output folder) instead of disappearing.
    if (saved.outputDirectory !== current.outputDirectory) onOutputFolderChanged(current.outputDirectory, saved.outputDirectory)
    return saved
  })

  // Disk space: run sizes, Free up space, earlier output folders, low-disk check.
  setExtraLibraryRoots(previousOutputFolders)
  handle('storage:runSizes', (_event, outputDirs: unknown) => runSizes(outputDirs))
  handle('storage:cleanupPlan', (_event, filters: unknown) => cleanupPlan(filters))
  handle('storage:cleanup', (_event, groups: unknown, filters: unknown) => runCleanup(groups, filters))
  handle('storage:freeSpace', () => freeSpace())
  handle('storage:folderChangeInfo', () => folderChangeInfo())
  handle('storage:previousFolders', () => listPreviousFolders())
  handle('storage:forgetFolder', (_event, folder: unknown) => forgetFolder(folder))
  handle('storage:moveFolder', (event, folder: unknown) => moveFolderRuns(folder, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('storage:moveProgress', progress)
  }))

  handle('settings:replaceApiKey', (_event, key: ApiKeyName, value: string) => {
    const previousZernioKey = key === 'zernioApiKey' ? loadSettings().zernioApiKey : null
    const saved = replaceApiKey(key, value)
    // A different Zernio key may be a different workspace; drop the old one's accounts.
    if (previousZernioKey !== null && loadSettings().zernioApiKey !== previousZernioKey) resetZernioState(getMainWindow)
    return saved
  })

  // Social accounts via the user's own Zernio key (main process only).
  handle('zernio:overview', () => getZernioOverview())
  handle('zernio:profiles:create', (_event, name: unknown) => createZernioProfile(name))
  handle('zernio:sync', () => syncZernioAccounts())
  handle('zernio:checkStatus', () => checkZernioStatus())
  handle('zernio:cachedOverview', () => readCachedOverview())
  handle('zernio:pendingConnect', () => getPendingZernioConnect())
  handle('zernio:connect', (_event, platform: unknown, profileId: unknown, options: unknown) => connectZernioAccount(platform, profileId, options, getMainWindow))
  handle('zernio:cancelConnect', () => cancelZernioConnect())
  handle('zernio:disconnect', (_event, accountId: unknown) => disconnectZernioAccount(accountId))

  // Posting clips through Zernio. Uploads and post links stay in the main process.
  handle('zernio:posts:probe', (_event, clipPath: unknown, durationMs: unknown) => probeClipForPosting(clipPath, durationMs))
  handle('zernio:posts:subtitles', (_event, clipPath: unknown) => clipSubtitlesForPosting(clipPath))
  handle('zernio:posts:pickCoverImage', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a cover image', filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    return coverImageForPosting(result.filePaths[0])
  })
  handle('zernio:posts:tiktokCreatorInfo', (_event, accountId: unknown) => getTikTokCreatorInfo(accountId))
  handle('zernio:posts:publish', (event, request: unknown) => publishClip(request, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('zernio:postProgress', progress)
  }))
  handle('zernio:posts:cancelUpload', (_event, attemptId: unknown) => cancelUpload(attemptId))
  handle('zernio:posts:list', () => listPosts())
  handle('zernio:posts:refresh', (_event, force: unknown) => refreshPosts(force))
  handle('zernio:posts:refreshStats', (_event, force: unknown) => refreshPostStats(force))
  handle('zernio:posts:insights', () => postPerformanceInsights())
  handle('zernio:posts:cancel', (_event, postId: unknown) => cancelPost(postId))
  handle('zernio:posts:reschedule', (_event, postId: unknown, scheduledFor: unknown, timezone: unknown) => reschedulePost(postId, scheduledFor, timezone))
  handle('zernio:posts:retry', (_event, postId: unknown) => retryPost(postId))
  handle('zernio:posts:dismiss', (_event, postId: unknown) => dismissPost(postId))
  handle('zernio:posts:open', (_event, postId: unknown, targetIndex: unknown) => openPostLink(postId, targetIndex))
  handle('zernio:posts:openTikTokLegal', (_event, key: unknown) => openTikTokLegal(key))

  handle('automations:enhancementGroups', (_event, id: unknown) => automationEnhancementGroups(id))
  handle('automations:enhanceBatch', (_event, id: unknown, ids: unknown, key: unknown, guidance: unknown) => enhanceAutomationBatch(id, ids, key, guidance))
  handle('automations:source', (_event, id: unknown, contentId: unknown) => automationContentSource(id, contentId))
  handle('automations:enhance', (_event, id: unknown, contentId: unknown, options: unknown) => enhanceAutomationContent(id, contentId, options))
  handle('automations:resolveDraft', (_event, id: unknown, contentId: unknown, draftId: unknown, apply: unknown) => resolveAutomationMetadataDraft(id, contentId, draftId, apply))
  handle('automations:list', () => listAutomations())
  handle('automations:acknowledgeWarnings', (_event, id: unknown, contentId: unknown) => acknowledgeAutomationWarnings(id, contentId))
  handle('automations:dismissMetadataError', (_event, id: unknown, contentId: unknown) => dismissAutomationMetadataError(id, contentId))
  handle('automations:reviewContent', (_event, id: unknown, contentId: unknown, returnToQueue: unknown) => reviewAutomationContent(id, contentId, returnToQueue))
  handle('automations:libraryClip', (_event, id: unknown, contentId: unknown) => automationLibraryClip(id, contentId))
  handle('automations:showInFolder', (_event, id: unknown, contentId: unknown) => showAutomationContentInFolder(id, contentId))
  handle('automations:reorder', (_event, id: unknown, contentId: unknown, beforeId: unknown) => reorderAutomationContent(id, contentId, beforeId))
  handle('automations:create', (_event, name: unknown) => createAutomation(name))
  handle('automations:update', (_event, id: unknown, update: unknown) => updateAutomation(id, update))
  handle('automations:delete', (_event, id: unknown) => deleteAutomation(id))
  handle('automations:retryContent', (_event, id: unknown, contentId: unknown) => retryAutomationContent(id, contentId))
  handle('automations:run', (_event, id: unknown) => runAutomation(id))
  handle('automations:unscheduleContent', (_event, id: unknown, contentId: unknown) => unscheduleAutomationContent(id, contentId))
  handle('automations:addLibraryClips', (_event, id: unknown, outputDir: unknown, clipIndices: unknown) => addLibraryClipsToAutomation(id, outputDir, clipIndices))
  handle('automations:updateContent', (_event, id: unknown, contentId: unknown, update: unknown) => updateAutomationContent(id, contentId, update))
  handle('automations:prepareTikTokReview', (_event, id: unknown, contentId: unknown) => prepareAutomationTikTokReview(id, contentId))
  handle('automations:approveTikTokReview', (_event, id: unknown, contentId: unknown, update: unknown) => approveAutomationTikTokReview(id, contentId, update))
  handle('automations:removeContent', (_event, id: unknown, contentId: unknown) => removeAutomationContent(id, contentId))
  handle('automations:addContent', async (_event, id: unknown) => {
    const window = getMainWindow()
    if (!window) return listAutomations()
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      title: 'Add clips to automation',
      filters: [{ name: 'Postable videos', extensions: ['mp4', 'mov', 'm4v', 'webm'] }]
    })
    if (result.canceled) return listAutomations()
    for (const path of result.filePaths) authorizeMedia(path)
    return addAutomationContent(id, result.filePaths)
  })

  handle('settings:selectOutputDir', async () => {
    const window = getMainWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Output Folder'
    })

    if (result.canceled || result.filePaths.length === 0) return null
    selectedOutputDirectories.add(result.filePaths[0])
    return result.filePaths[0]
  })

  handle('backgrounds:list', () => listBackgrounds())
  handle('backgrounds:remove', (_event, name: unknown) => removeBackground(name))
  handle('backgrounds:add', async () => {
    const window = getMainWindow()
    if (!window) return listBackgrounds()
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      title: 'Add background videos',
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'webm'] }]
    })
    if (result.canceled) return listBackgrounds()
    return addBackgrounds(result.filePaths)
  })

  // Call-to-action library: the dialog opens here, so the renderer never names a file.
  handle('ctas:list', () => listCtas())
  handle('ctas:add', async (_event, name: unknown) => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: 'Choose a call-to-action video or image',
      filters: [{ name: 'Video or image', extensions: [...CTA_VIDEO_EXTENSIONS, ...CTA_IMAGE_EXTENSIONS] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return addCta(result.filePaths[0], name)
  })
  handle('ctas:update', (_event, id: unknown, patch: unknown) => updateCta(id, patch))
  handle('ctas:remove', (_event, id: unknown) => removeCta(id))
  // Library changes wait while a Remix video in that run is being re-made, or an avatar video is finishing.
  setRunBusyCheck((path) => remixRunBusy(path) ?? avatarRunBusy(path))
  handle('remix:recompose', async (_event, outputDir: unknown, clipIndex: unknown, edit: unknown) => {
    const note = await recomposeRemix(outputDir, clipIndex, edit)
    return { output: await getJobOutput(outputDir as string, loadSettings().outputDirectory), note }
  })
  handle('clips:setCta', (_event, outputDir: unknown, clipIndex: unknown, ctaId: unknown) => {
    const choice = parseCtaChoice(ctaId)
    return setLibraryClipCta(outputDir, clipIndex, (run, index) => applyRunCta(run, choice, [index]), remixFolderInUse())
  })

  handle('avatars:list', () => listAvatars())
  handle('avatars:pickPhoto', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a photo for your avatar', filters: [{ name: 'Photos', extensions: PHOTO_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return draftFromPhoto(result.filePaths[0])
  })
  paid('avatars:generateFaces', 'openrouter', () => AI_PORTRAIT_CANDIDATES * PRICES.image, (description) => metered('avatar', 'Avatar pictures', () => draftsFromDescription(description)))
  paid('avatars:restyle', 'openrouter', () => AI_PORTRAIT_CANDIDATES * PRICES.image,
    (source, look, detail, consent) => metered('avatar', 'Avatar pictures', () => restyleDrafts(source, look, detail, consent)))
  handle('avatars:setPortrait', (_event, id: unknown, draftId: unknown) => {
    if (id === avatarInUse() || id === remixAvatarInUse()) throw new Error('This avatar is being used for a video right now. Try again when it finishes.')
    if (typeof id === 'string' && reactionsInProgress(id)) throw new Error('This avatar’s reactions are being made from its current picture. Change the picture when they finish.')
    return setPortrait(id, draftId)
  })
  handle('avatars:create', (_event, input: unknown) => createAvatar((input ?? {}) as Parameters<typeof createAvatar>[0]))
  // Saved pictures: switch, remove, or add another photo (the dialog opens here).
  const pictureGuard = (id: unknown): void => {
    if (id === avatarInUse() || id === remixAvatarInUse()) throw new Error('This avatar is being used for a video right now. Try again when it finishes.')
    if (typeof id === 'string' && reactionsInProgress(id)) throw new Error('This avatar’s reactions are being made or uploaded. Change the picture when that finishes.')
    if (typeof id === 'string' && cloningInProgress(id)) throw new Error('This avatar’s voice is being cloned. Change the picture when that finishes.')
  }
  handle('avatars:usePicture', (_event, id: unknown, file: unknown) => { pictureGuard(id); return usePicture(id, file) })
  handle('avatars:removePicture', (_event, id: unknown, file: unknown) => { pictureGuard(id); return removePicture(id, file) })
  handle('avatars:addPhoto', async (_event, id: unknown) => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Add a photo of yourself', filters: [{ name: 'Photos', extensions: PHOTO_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return addPhotoToAvatar(id, result.filePaths[0])
  })
  handle('avatars:update', (_event, id: unknown, patch: unknown) => updateAvatar(id, (patch ?? {}) as { name?: unknown; voice?: unknown }))
  handle('avatars:remove', (_event, id: unknown) => {
    if (id === avatarInUse() || id === remixAvatarInUse()) throw new Error('This avatar is being used by the video in progress. Wait for it to finish or cancel it first.')
    if (typeof id === 'string' && reactionsInProgress(id)) throw new Error('This avatar’s reactions are still being made (a few minutes). Remove it when they finish.')
    if (typeof id === 'string' && cloningInProgress(id)) throw new Error('This avatar’s voice is being cloned. Remove it when that finishes.')
    return removeAvatar(id)
  })
  paid('avatars:makeReactions', 'openrouter', (id) => {
    const have = typeof id === 'string' ? new Set(readReactions(id).map((reaction) => reaction.id)) : new Set<string>()
    return REACTIONS.filter((reaction) => !have.has(reaction.id)).length * PRICES.reactionClip || null
  }, (id) => metered('avatar', 'Avatar reactions', () => makeReactions(id)))
  handle('avatars:uploadReaction', async (_event, id: unknown, kind: unknown) => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a short silent reaction clip (5-10 seconds)', filters: [{ name: 'Video', extensions: REACTION_VIDEO_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return uploadReaction(id, kind, result.filePaths[0])
  })
  handle('avatars:removeReaction', (_event, id: unknown, kind: unknown) => removeReaction(id, kind))
  paid('avatars:cloneVoice', 'openrouter', () => 0.02, async (id, consent) => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a voice recording (30-90 seconds of clear speech)', filters: [{ name: 'Audio', extensions: VOICE_SAMPLE_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return metered('avatar', 'Voice clone', () => cloneVoice(id, result.filePaths[0], consent))
  })
  handle('avatars:writeScript', (_event, request: unknown) => writeAvatarScript(request))
  paid('avatars:render', 'openrouter', (request) => estimateRenderCost(parseRenderRequest(request)),
    (request) => meteredAvatarRender(false, () => startAvatarRender(request)))
  paid('avatars:recreate', 'fal', (request) => {
    const raw = (request ?? {}) as Record<string, unknown>
    if (typeof raw.startSeconds !== 'number' || typeof raw.endSeconds !== 'number' || !['replace', 'move', 'motion'].includes(raw.mode as string)) return null
    const cost = estimateRecreateCost({ startSeconds: raw.startSeconds, endSeconds: raw.endSeconds, mode: raw.mode as 'replace' | 'move' | 'motion' })
    return Number.isFinite(cost) && cost > 0 ? cost : null
  }, (request) => meteredAvatarRender(true, () => startAvatarRecreate(request)))
  handle('avatars:cancelRender', () => cancelAvatarRender())
  handle('avatars:renderStatus', () => friendlyStatus(avatarRenderStatus()))
  handle('voices:sample', (_event, request: unknown) => metered('avatar', 'Voice preview', () => voiceSample(request)))
  onAvatarRenderStatus((status) => {
    trackAvatarStatus(status)
    announce(avatarNotice(status), getMainWindow)
    sendToWindow('avatars:status', friendlyStatus(status))
  })

  handle('brandIdentities:list', () => listBrandIdentities())
  handle('brandIdentities:save', (_event, input: unknown) => saveBrandIdentity(input))
  handle('brandIdentities:remove', (_event, id: unknown) => removeBrandIdentity(id))
  handle('brandIdentities:importFile', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a brand identity document', filters: [{ name: 'Text', extensions: BRAND_IDENTITY_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return readBrandIdentityFile(result.filePaths[0])
  })
  // A logo for the brand kit: checked and stored as a PNG; saved with the brand.
  handle('brandIdentities:chooseLogo', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose your logo', filters: [{ name: 'Images', extensions: LOGO_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return importBrandLogo(result.filePaths[0])
  })
  paid('remix:start', 'openrouter', (request) => {
    const raw = (request ?? {}) as Record<string, unknown>
    if (raw.format === 'image' || raw.format === 'pause_react') return estimateRemixCost('camera', 1, 0, raw.format).total
    if (raw.format === 'moment_take') return momentEstimate(parseMomentRanges((raw.moment as { ranges?: unknown } | undefined)?.ranges)).total
    const sources = Array.isArray(raw.sources) ? Math.max(1, raw.sources.length) : 1
    const count = typeof raw.count === 'number' && Number.isInteger(raw.count) && raw.count >= 1 && raw.count <= MAX_REMIXES ? raw.count : null
    if (!isRemixHost(raw.host) || count === null) return null
    return estimateRemixCost(raw.host, count * sources, 0.5, raw.format === 'silent' ? 'silent' : 'commentary').total
  }, (request) => startRemix(request))
  paid('remix:render', 'openrouter', (edits) => {
    const ids = new Set(Array.isArray(edits) ? edits.map((edit) => (edit as { id?: unknown } | null)?.id) : [])
    const total = (remixStatus()?.drafts ?? []).filter((draft) => ids.has(draft.id)).reduce((sum, draft) => sum + draft.estimateUsd, 0)
    return total > 0 ? total : null
  }, (edits) => renderRemix(edits))
  handle('remix:discard', () => discardRemix())
  handle('remix:cancel', () => cancelRemix())
  handle('remix:status', () => friendlyStatus(remixStatus()))
  // Me, on camera: recordings for the takes under review.
  handle('remix:mediaAccess', () => requestMediaAccess())
  handle('remix:moment', (_event, draftId: unknown) => remixMoment(draftId))
  paid('remix:write', 'openrouter', (ids) => {
    const format = remixStatus()?.drafts[0]?.format
    // Moment + my take: one short writing call per take (like a screenshot take).
    if (format === 'moment_take') return estimateRemixCost('camera', 1, 0, 'image').total * Math.max(1, Array.isArray(ids) ? ids.length : remixStatus()?.drafts.length ?? 1)
    return estimateRemixCost('camera', 1, 0, format === 'pause_react' ? 'pause_react' : 'image').total
  }, (ids) => writeRemix(ids))
  // Moment + my take: nudge a moment (free), find another one in its range (one planning call), talking points (one small call),
  // and read the time from a screenshot of a player (one small call; before any run, so it's recorded here).
  handle('remix:momentBounds', (_event, draftId: unknown, startMs: unknown, endMs: unknown) => setMomentBounds(draftId, startMs, endMs))
  paid('remix:anotherMoment', 'openrouter', () => estimateRemixCost('camera', 1, 0.1, 'moment_take').total - estimateRemixCost('camera', 1, 0, 'image').total,
    (draftId) => anotherMoment(draftId))
  paid('remix:talkingPoints', 'openrouter', () => null, (draftId) => momentTalkingPoints(draftId))
  const readTimecode = async (bytes: unknown): Promise<TimecodeRead | null> => {
    const result = await readTimecodeScreenshot(bytes, loadSettings().openrouterApiKey)
    if (result.costUsd > 0) void recordSpend({ kind: 'remix', provider: 'openrouter', usd: result.costUsd, label: 'Remix: reading a screenshot’s time' })
    return result.read
  }
  paid('remix:readTimecode', 'openrouter', () => null, (bytes) => readTimecode(bytes))
  // The same from a screenshot chosen in the file dialog (null when none is chosen).
  paid('remix:readTimecodeFile', 'openrouter', () => null, async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a screenshot of the player', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const info = await stat(result.filePaths[0])
    if (!info.isFile() || info.size > MAX_TIMECODE_IMAGE_BYTES) throw new Error('Use a screenshot under 10 MB.')
    return { read: await readTimecode(new Uint8Array(await readFile(result.filePaths[0]))) }
  })
  // Pause & react: the part of their video, and when it plays and pauses (finding a phone recording's pauses is local and free).
  handle('remix:trim', (_event, draftId: unknown, startMs: unknown, endMs: unknown) => setRemixTrim(draftId, startMs, endMs))
  handle('remix:pauseView', () => pauseView())
  handle('remix:pauseSettings', (_event, settings: unknown) => setPauseSettings(settings))
  handle('remix:selectImage', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a screenshot', filters: [{ name: 'Images', extensions: REMIX_IMAGE_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return authorizeMedia(result.filePaths[0])
  })
  handle('remix:recordings', () => remixRecordings())
  handle('remix:recordingBegin', (_event, draftId: unknown, part: unknown, mime: unknown) => beginRecording(draftId, part, mime))
  handle('remix:recordingAppend', (_event, token: unknown, chunk: unknown) => appendRecording(token, chunk))
  handle('remix:recordingFinish', (_event, token: unknown, offsetSeconds: unknown, pause: unknown) => finishRecording(token, offsetSeconds, pause))
  handle('remix:recordingAbort', (_event, token: unknown) => abortRecording(token))
  handle('remix:removeRecording', (_event, draftId: unknown, part: unknown) => removeRecording(draftId, part))
  handle('remix:uploadRecording', async (_event, draftId: unknown, part: unknown) => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose your recording', filters: [{ name: 'Video', extensions: RECORDING_VIDEO_EXTENSIONS }] })
    if (result.canceled || !result.filePaths[0]) return null
    return uploadRecording(draftId, part, result.filePaths[0])
  })
  // A moment call that finishes after its review was closed: its cost goes to the ledger directly.
  onRemixMomentSpend((usd, label, runId) => recordSpend({ kind: 'remix', provider: 'openrouter', usd, label, runId: runId || undefined }))
  onRemixStatus((status) => {
    trackRemixStatus(status)
    announce(remixNotice(status), getMainWindow)
    sendToWindow('remix:status', friendlyStatus(status))
  })

  // Create runs have no cost estimate: the balance check asks for at least $1.
  paid('job:start', 'openrouter', () => null, (config) => startClipJobRequest(config))
  // Several videos with the same settings: one spending check, then one job per video.
  paid('job:startMany', 'openrouter', () => null, (requests) => startClipJobRequests(requests))
  // More clips from a finished run: reuses its saved transcript when it still matches the video.
  handle('job:moreClipsInfo', (_event, outputDir: unknown) => moreClipsInfo(outputDir))
  paid('job:moreClips', 'openrouter', () => null, (outputDir, choices) => startMoreClips(outputDir, choices))

  handle('job:cancel', (_event, jobId: unknown) => {
    if (typeof jobId !== 'string') return false
    logger.info('job.cancel.request', { jobId })
    return cancelTrackedJob(jobId)
  })

  handle('jobs:list', () => listJobs())
  handle('jobs:dismiss', (_event, jobId: unknown) => typeof jobId === 'string' && dismissJob(jobId))

  handle('diagnostics:getLogPath', () => {
    return getLogFilePath()
  })

  handle('diagnostics:openLogFolder', () => {
    const logFile = getLogFilePath()
    if (existsSync(logFile)) {
      shell.showItemInFolder(logFile)
      return true
    }
    return false
  })

  handle('history:list', async () => {
    const settings = loadSettings()
    // Avatar Studio videos made before they were saved to the Library join it once (originals stay put).
    await importLegacyAvatarVideos(settings.outputDirectory).catch(() => 0)
    return getJobHistory(settings.outputDirectory, liveJobIds())
  })

  handle('history:postingStatus', (_event, outputDir: unknown) => libraryPostingStatus(outputDir))
  handle('history:postingSummary', (_event, outputDirs: unknown) => libraryPostingSummary(outputDirs))
  handle('history:readyToPost', () => readyToPost())
  handle('history:setPosted', (_event, outputDir: unknown, clipIndex: unknown, posted: unknown) => setLibraryPosted(outputDir, clipIndex, posted))
  handle('history:setFavorite', (_event, outputDir: unknown, favorite: unknown) => setLibraryFavorite(outputDir, favorite))
  handle('history:delete', (_event, outputDir: unknown) => deleteLibraryRun(outputDir))
  handle('history:deleteClips', (_event, outputDir: unknown, indices: unknown) => deleteLibraryClips(outputDir, indices))
  handle('history:metadataSource', (_event, outputDir: unknown, clipIndex: unknown) => libraryMetadataSource(outputDir, clipIndex))
  handle('history:enhanceMetadata', (_event, outputDir: unknown, clipIndex: unknown, options: unknown) => enhanceLibraryMetadata(outputDir, clipIndex, options))
  handle('history:getJob', (_event, outputDir: string) => {
    assertAbsolutePath(outputDir)
    const library = loadSettings().outputDirectory
    if (isWithinDirectory(outputDir, library)) return getJobOutput(outputDir, library)
    // A run in an earlier output folder the Library still shows.
    const previous = previousOutputFolders().find((root) => isWithinDirectory(outputDir, root))
    if (!previous) throw new Error('Job is outside the library')
    return getJobOutput(outputDir, previous)
  })

  handle('editor:open', (_event, path: unknown) => openEditor(path))
  handle('editor:save', (_event, path: unknown, revision: unknown, edits: unknown) => saveEditor(path, revision, edits))
  // A bake translates the captions of clips in another caption language (one OpenRouter call each): those pass the spending check.
  // A review (coherence judgments, and looks at the video's frames) is paid too: it always does.
  handle('editor:run', async (_event, path: unknown, revision: unknown, id: unknown, action: unknown) => {
    if (action === 'review') {
      await assertSpendAllowed('editor:run', 'openrouter', await editorCallEstimate(path, 'review').catch(() => null))
      return runEditor(path, revision, id, action)
    }
    const translating = await editorTranslationEstimate(path, id, action).catch(() => ({ clips: 0, estimateUsd: null }))
    if (translating.clips) await assertSpendAllowed('editor:run', 'openrouter', translating.estimateUsd)
    return runEditor(path, revision, id, action)
  })
  handle('editor:cancel', (_event, path: unknown) => cancelEditor(path))
  handle('editor:replaceSource', (_event, path: unknown, revision: unknown, replacement: unknown) => replaceEditorSource(path, revision, replacement))
  handle('editor:progress', (_event, path: unknown) => readEditorProgress(path))
  handle('editor:freeMedia', (_event, path: unknown, revision: unknown) => freeEditorMedia(path, revision))
  handle('editor:addCandidate', (_event, path: unknown, revision: unknown, candidate: unknown, sourceId: unknown) => addEditorCandidate(path, revision, candidate, sourceId))
  // Hook ideas are one paid call: they pass the spending check (estimated from this run's earlier ones, if any).
  handle('editor:suggestHooks', async (_event, path: unknown, revision: unknown, id: unknown) => {
    await assertSpendAllowed('editor:suggestHooks', 'openrouter', await editorCallEstimate(path, 'suggest-hooks').catch(() => null))
    return suggestEditorHooks(path, revision, id)
  })
  handle('editor:closeReady', (_event, saved: unknown) => editorCloseReady(saved))
  // An Automatic Create run opened in the editor: what it takes, doing it, and its progress.
  handle('editor:automaticInfo', (_event, path: unknown) => automaticEditInfo(path))
  handle('editor:prepareAutomatic', (_event, path: unknown, localFile: unknown) => prepareAutomaticEditor(path, localFile))
  handle('editor:operationStatus', (_event, path: unknown) => editorOperationStatus(path))

  handle('edits:inspect', (_event, outputDir: string) => inspectEdits(outputDir, loadSettings().outputDirectory))

  handle('thumbnails:generate', async (_event, videoPath: string, seekSeconds?: number) => {
    if (isAutomationMedia(videoPath)) authorizeMedia(videoPath)
    else assertMediaPath(videoPath, loadSettings().outputDirectory)
    if (seekSeconds !== undefined && (!Number.isFinite(seekSeconds) || seekSeconds < 0 || seekSeconds > 6 * 60 * 60)) throw new Error('Invalid thumbnail time')
    const thumbnail = await generateThumbnail(videoPath, seekSeconds)
    if (thumbnail) authorizeMedia(thumbnail)
    return thumbnail
  })

  handle('shell:openPath', async (_event, path: unknown) => {
    if (isWebUrl(path)) {
      if (!isTrustedExternalUrl(path)) throw new Error('This external link is not supported')
      await shell.openExternal(path)
      return true
    }
    assertAbsolutePath(path)
    if (!existsSync(path)) return false
    // Check and open the same canonical name: an alias can hide a .app suffix.
    const canonical = realpathSync(path)
    if (!isWithinLibrary(canonical, loadSettings().outputDirectory)) assertMediaPath(canonical, loadSettings().outputDirectory)
    const { statSync } = await import('fs')
    if (statSync(canonical).isDirectory()) {
      // macOS opens these directory packages with Installer, System Settings,
      // Automator or the bundle itself instead of showing a folder.
      if (canonical.split(/[\\/]+/).some((part) => /\.(app|bundle|pkg|mpkg|prefpane|saver|workflow|action|xpc|appex|plugin|kext|framework|qlgenerator|wdgt)$/i.test(part))) throw new Error('Application bundles cannot be opened from the library')
    } else {
      assertMediaPath(canonical, loadSettings().outputDirectory)
    }
    return (await shell.openPath(canonical)) === ''
  })

  handle('shell:showItemInFolder', (_event, path: string) => {
    assertAbsolutePath(path)
    if (!isWithinLibrary(path, loadSettings().outputDirectory)) assertMediaPath(path, loadSettings().outputDirectory)
    if (!existsSync(path)) return false
    shell.showItemInFolder(path)
    return true
  })

  handle('dialog:selectVideo', async () => {
    const window = getMainWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: 'Choose a Video',
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'flv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return authorizeMedia(result.filePaths[0])
  })

  // Create: several videos at once (each becomes its own job).
  handle('dialog:selectVideos', async () => {
    const window = getMainWindow()
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      title: 'Choose videos',
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'flv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths.slice(0, MAX_CREATE_SOURCES).map((path) => authorizeMedia(path))
  })

  // The selected clips as one .zip (stored, not recompressed: video is already compressed).
  handle('clips:exportZip', async (_event, clips: { path: string; name: string }[], zipName: unknown) => {
    const window = getMainWindow()
    if (!Array.isArray(clips) || clips.length > 500) throw new Error('Invalid export selection')
    for (const clip of clips) {
      if (!clip || typeof clip.name !== 'string' || clip.name.length > 500) throw new Error('Invalid export selection')
      assertMediaPath(clip.path, loadSettings().outputDirectory)
    }
    if (!window || clips.length === 0) return { success: false, count: 0, failedCount: clips.length }
    const suggested = uniqueFileName(typeof zipName === 'string' && zipName.trim() ? zipName : 'CreatorClips clips', '.zip', new Set())
    const result = await dialog.showSaveDialog(window, { title: 'Save Clips as .zip', defaultPath: suggested, filters: [{ name: 'Zip archive', extensions: ['zip'] }] })
    if (result.canceled || !result.filePath) return { success: false, count: 0, failedCount: 0 }
    const dest = result.filePath.toLowerCase().endsWith('.zip') ? result.filePath : `${result.filePath}.zip`
    const { open, rm, rename } = await import('fs/promises')
    const { extname, join, dirname } = await import('path')
    const sources: Awaited<ReturnType<typeof openAuthorizedMedia>>[] = []
    const temp = join(dirname(dest), `.creatorclips-${randomUUID()}.zip.part`)
    try {
      for (const clip of clips) sources.push(await openAuthorizedMedia(clip.path, loadSettings().outputDirectory))
      const taken = new Set<string>()
      const target = await open(temp, 'wx', 0o600)
      try {
        await writeZip(target, sources.map((source, index) => ({ name: uniqueFileName(clips[index].name, extname(clips[index].path) || '.mp4', taken), handle: source.handle, size: source.size })))
      } finally { await target.close() }
      await rename(temp, dest)
      return { success: true, count: clips.length, failedCount: 0, destDir: dest }
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    } finally {
      await Promise.all(sources.map((source) => source.handle.close().catch(() => undefined)))
    }
  })

  handle('clips:bulkExport', async (_event, clips: { path: string; name: string }[]) => {
    const window = getMainWindow()
    if (!Array.isArray(clips) || clips.length > 500) throw new Error('Invalid export selection')
    for (const clip of clips) {
      if (!clip || typeof clip.name !== 'string' || clip.name.length > 500) throw new Error('Invalid export selection')
      assertMediaPath(clip.path, loadSettings().outputDirectory)
    }
    if (!window || clips.length === 0) return { success: false, count: 0, failedCount: clips.length }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Export Clips To…'
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0, failedCount: 0 }

    const destDir = result.filePaths[0]
    const { open, rm } = await import('fs/promises')
    const { pipeline } = await import('stream/promises')
    const { extname, join } = await import('path')
    let count = 0

    for (const clip of clips) {
      try {
        const source = await openAuthorizedMedia(clip.path, loadSettings().outputDirectory)
        try {
          const ext = extname(clip.path) || '.mp4'
          const safeName = Array.from(clip.name).filter((char) => char.charCodeAt(0) >= 32).join('').replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'clip'
          let suffix = 0
          while (true) {
            const dest = join(destDir, `${safeName}${suffix ? ` (${suffix})` : ''}${ext}`)
            let target: Awaited<ReturnType<typeof open>> | undefined
            try {
              target = await open(dest, 'wx', 0o600)
              // Release both streams before closing: a FileHandle with a live write stream never finishes closing,
              // which stalled the export after its first clip.
              const reader = source.handle.createReadStream({ autoClose: false })
              const writer = target.createWriteStream({ autoClose: false })
              try { await pipeline(reader, writer) } finally { reader.destroy(); writer.destroy() }
              await target.close()
              break
            } catch (error) {
              await target?.close()
              if (target) await rm(dest, { force: true })
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || ++suffix > 10000) throw error
            }
          }
          count++
        } finally {
          await source.handle.close()
        }
      } catch { /* Counted below as an unsuccessful copy. */ }
    }

    return { success: count > 0, count, failedCount: clips.length - count, destDir }
  })

  handle('system:isPackaged', () => {
    return app.isPackaged
  })

  handle('system:checkTools', async () => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const { join } = await import('path')
    const settings = loadSettings()
    const enginePath = getEnginePath()
    const bridgePath = getBridgeRunnerPath()
    const resolvedPython = resolvePythonPath(enginePath, settings.pythonPath)

    // ffmpeg/ffprobe only accept `-version`; `--version` exits non-zero and
    // made the check report them missing even when installed.
    const check = async (cmd: string, flag = '--version'): Promise<boolean> => {
      try {
        await execFileAsync(cmd, [flag], { timeout: 15000 })
        return true
      } catch {
        return false
      }
    }

    const [pythonValidation, python, ffmpeg, ffmpegCaptions, ffprobe, ytdlp] = await Promise.all([
      validatePython(resolvedPython, enginePath),
      check(resolvedPython),
      check(resolveBinary('ffmpeg'), '-version'),
      supportsCaptionFilter(),
      check(resolveBinary('ffprobe'), '-version'),
      check(resolveBinary('yt-dlp'))
    ])

    const result = {
      python,
      pythonDeps: pythonValidation.ok,
      pythonPath: resolvedPython,
      pythonError: pythonValidation.error,
      pythonHint: pythonValidation.hint,
      pythonRepairCommand: pythonValidation.repairCommand,
      ffmpeg,
      ffmpegCaptions,
      ffprobe,
      ytdlp,
      engine: existsSync(join(enginePath, 'clip_engine', 'bridge_contract.py')),
      enginePath,
      bridgeRunner: existsSync(bridgePath),
      bridgePath
    }
    logger.info('system.checkTools', result)
    recordToolCheck(result)
    return result
  })
}

/** A status whose error says the credit ran out, in the same plain words as everywhere else. */
function friendlyStatus<T extends { error: string | null } | null>(status: T): T {
  return status && status.error ? { ...status, error: friendlyCreditError(status.error) } : status
}
