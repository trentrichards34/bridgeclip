'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const realPromises = require('node:fs/promises')
const path = require('node:path')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')
const { directoryLinkType, fileLinksAvailable } = require('../support/symlinks.cjs')

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SOURCE = "export * from './src/main/library-storage'; export * as folders from './src/main/library-folders'; export * as settings from './src/main/settings-store'; export * as security from './src/main/security'"

/** A Library with fake guards: every busy check and the editor/posting calls are controllable. */
function fixture({ fsPromises } = {}) {
  const temp = tempDir('bridgeclip-library-storage-')
  const library = path.join(temp.dir, 'library')
  fs.mkdirSync(library, { recursive: true })
  const state = { live: new Set(), editorBusy: new Set(), remixFolder: null, remixStatus: null, recomposing: null, freed: [], posted: new Map(), locks: [] }
  const mocks = {
    electron: fakeElectron(temp.dir).electron,
    './job-manager': { liveJobIds: () => state.live, dismissJob: () => {} },
    './clip-editor': {
      editorBusy: (run) => state.editorBusy.has(path.basename(run)),
      freeEditorMedia: async (run, revision) => {
        state.freed.push([run, revision])
        for (const name of fs.readdirSync(run)) if (/^editor-(source|preview)/.test(name)) fs.rmSync(path.join(run, name))
      }
    },
    './remix': { remixFolderInUse: () => state.remixFolder, remixStatus: () => state.remixStatus, remixRunBusy: (p) => state.recomposing && p === state.recomposing ? 'busy' : null },
    './avatar-studio': { avatarRenderStatus: () => null },
    './ctas': { withRunLock: async (run, work) => { state.locks.push(run); return work() } },
    './library-posting': { libraryPostingSummary: async (dirs) => dirs.map((dir) => ({ outputDir: dir, counts: state.posted.get(dir) ?? { posted: 0, notPosted: 1 } })) },
    './logger': { logger: { info() {}, warn() {}, error() {} } },
    ...(fsPromises ? { 'fs/promises': fsPromises } : {})
  }
  const main = loadMain(SOURCE, mocks)
  main.settings.savePublicSettings({ outputDirectory: library, pythonPath: 'python3' })
  return { ...temp, library, state, main }
}

function makeRun(library, name, { clips = [0], extra = {}, title = 'Run ' + name, editor = null } = {}) {
  const run = path.join(library, name)
  fs.mkdirSync(run, { recursive: true })
  const output = {
    source_video_title: title,
    ...(editor ? { editor_project: true } : {}),
    clips: clips.map((index) => {
      const file = path.join(run, `clip_${String(index).padStart(2, '0')}.mp4`)
      fs.writeFileSync(file, Buffer.alloc(100))
      return { clip_index: index, s3_url: `file://${file}`, duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, summary: 'Clip', virality_score: 0.5, ...(extra[index] ?? {}) }
    })
  }
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify(output))
  if (editor) fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(editor))
  return run
}

const EDITOR_FIXTURE = require('../fixtures/editor/project.json')
function editorProject(statuses) {
  const project = structuredClone(EDITOR_FIXTURE)
  const template = project.candidates[0]
  project.revision = 7
  project.candidates = statuses.map((status, i) => ({ ...structuredClone(template), id: `c${i}`, status }))
  return project
}

const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes)) }
const groupOf = (plan, id) => plan.groups.find((group) => group.id === id)

test('run sizes count every file once (hard links too), cache until the run changes, and refuse folders outside the Library', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const run = makeRun(f.library, UUID(1))
  write(path.join(run, '.edit', 'clip_00', 'part.mp4'), 1000)
  fs.linkSync(path.join(run, 'clip_00.mp4'), path.join(run, 'clip_00.original.mp4'))
  const base = 100 + fs.statSync(path.join(run, 'job_output.json')).size + 1000
  assert.deepEqual(await f.main.runSizes([run]), [{ outputDir: run, bytes: base }])
  // Cached: the same bytes are returned without walking again while nothing changed.
  assert.equal((await f.main.runSizes([run]))[0].bytes, base)
  write(path.join(run, 'framing-source.mp4'), 500)
  assert.equal((await f.main.runSizes([run]))[0].bytes, base + 500)
  // A change one level down (Remix parts) is noticed too.
  write(path.join(run, '.edit', 'clip_00', 'more.mp4'), 50)
  assert.equal((await f.main.runSizes([run]))[0].bytes, base + 550)
  const outside = path.join(f.dir, 'elsewhere')
  fs.mkdirSync(outside)
  assert.deepEqual(await f.main.runSizes([outside, f.library, path.join(run, '.edit')]), [
    { outputDir: outside, bytes: null }, { outputDir: f.library, bytes: null }, { outputDir: path.join(run, '.edit'), bytes: null }])
  await assert.rejects(f.main.runSizes('nope'), /Choose runs/)
  if (directoryLinkType) {
    fs.symlinkSync(run, path.join(f.library, 'linked-run'), directoryLinkType)
    assert.equal((await f.main.runSizes([path.join(f.library, 'linked-run')]))[0].bytes, null)
  }
})

test('the cleanup plan groups removable files and never includes finished clips, results, sidecars or links', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const run = makeRun(f.library, UUID(1), { extra: { 0: { cta: { id: 'a'.repeat(32), name: 'Follow' } } } })
  write(path.join(run, 'clip_00.original.mp4'), 300)
  write(path.join(run, 'framing-source.mp4'), 400)
  write(path.join(run, 'clip_00.mp4.partial.mp4'), 10)
  write(path.join(run, '.work', 'plan.json'), 20)
  write(path.join(run, '.recordings', 'take.webm'), 30)
  write(path.join(run, '.cta-abcdef12.mp4'), 40)
  write(path.join(run, 'job_output.json.1234.tmp'), 5)
  write(path.join(run, 'editor-source.mp4'), 600) // no editor project: a stray copy
  write(path.join(run, 'clip_00.srt'), 7)
  write(path.join(run, 'clip_00.framing.json'), 7)
  fs.writeFileSync(path.join(run, '.bridgeclip-favorite'), '')
  fs.writeFileSync(path.join(run, '.bridgeclip-posted-0'), '')
  write(path.join(run, '.delete-clips-x', 'clip_01.mp4'), 9) // recovery files from a failed delete
  const outsideFile = path.join(f.dir, 'outside.tmp')
  write(outsideFile, 999)
  if (fileLinksAvailable) fs.symlinkSync(outsideFile, path.join(run, 'linked.tmp'))
  const outsideDir = path.join(f.dir, 'outside-work')
  write(path.join(outsideDir, 'keep.mp4'), 999)

  const remix = makeRun(f.library, `remix-${UUID(2)}`, { clips: [0, 1], extra: { 0: { editable: { split: true } }, 1: { editable: { split: false } } } })
  write(path.join(remix, '.edit', 'clip_00', 'edit.json'), 50)
  write(path.join(remix, '.edit', 'clip_00', 'moment.mp4'), 950)
  if (directoryLinkType) fs.symlinkSync(outsideDir, path.join(remix, '.edit', 'clip_01'), directoryLinkType)
  if (directoryLinkType) fs.symlinkSync(outsideDir, path.join(remix, '.work'), directoryLinkType)

  const plan = await f.main.cleanupPlan({})
  assert.equal(plan.runCount, 2)
  assert.deepEqual(groupOf(plan, 'editorMedia'), { id: 'editorMedia', bytes: 600, files: 1, runs: [{ outputDir: run, videoTitle: `Run ${UUID(1)}`, bytes: 600, files: 1 }] })
  assert.equal(groupOf(plan, 'intermediates').bytes, 410)
  assert.equal(groupOf(plan, 'leftovers').bytes, 20 + 30 + 40 + 5)
  assert.equal(groupOf(plan, 'remixParts').bytes, 1000)
  assert.equal(groupOf(plan, 'ctaOriginals').bytes, 300)

  const result = await f.main.runCleanup(['editorMedia', 'intermediates', 'leftovers'], {})
  assert.equal(result.freedBytes, 600 + 410 + 95)
  assert.deepEqual(result.skipped, [])
  for (const kept of ['clip_00.mp4', 'job_output.json', 'clip_00.srt', 'clip_00.framing.json', '.bridgeclip-favorite', '.bridgeclip-posted-0', 'clip_00.original.mp4', path.join('.delete-clips-x', 'clip_01.mp4')]) {
    assert.ok(fs.existsSync(path.join(run, kept)), `${kept} is kept`)
  }
  for (const gone of ['framing-source.mp4', 'clip_00.mp4.partial.mp4', '.work', '.recordings', '.cta-abcdef12.mp4', 'job_output.json.1234.tmp', 'editor-source.mp4']) {
    assert.ok(!fs.existsSync(path.join(run, gone)), `${gone} is removed`)
  }
  // Links are never followed or removed; their targets are untouched.
  assert.equal(fs.statSync(outsideFile).size, 999)
  assert.equal(fs.statSync(path.join(outsideDir, 'keep.mp4')).size, 999)
  if (fileLinksAvailable) assert.ok(fs.lstatSync(path.join(run, 'linked.tmp')).isSymbolicLink())
  if (directoryLinkType) assert.ok(fs.lstatSync(path.join(remix, '.work')).isSymbolicLink())
  assert.ok(fs.existsSync(path.join(remix, '.edit', 'clip_00', 'moment.mp4')), 'Remix parts are their own opt-in group')
  assert.ok(f.state.locks.includes(run), 'cleaning a run holds its run lock')

  // Remix parts: removed, and the clip no longer offers "Edit hook text & captions".
  const parts = await f.main.runCleanup(['remixParts'], {})
  assert.equal(parts.freedBytes, 1000)
  assert.ok(!fs.existsSync(path.join(remix, '.edit', 'clip_00')))
  const clips = JSON.parse(fs.readFileSync(path.join(remix, 'job_output.json'), 'utf8')).clips
  assert.equal('editable' in clips[0], false)
  assert.deepEqual(clips[1].editable, { split: false })
  if (directoryLinkType) assert.ok(fs.lstatSync(path.join(remix, '.edit', 'clip_01')).isSymbolicLink())

  const originals = await f.main.runCleanup(['ctaOriginals'], {})
  assert.equal(originals.freedBytes, 300)
  assert.ok(!fs.existsSync(path.join(run, 'clip_00.original.mp4')))
  assert.ok(fs.existsSync(path.join(run, 'clip_00.mp4')))

  await assert.rejects(f.main.runCleanup([], {}), /Choose what/)
  await assert.rejects(f.main.runCleanup(['clips'], {}), /Choose what/)
  await assert.rejects(f.main.cleanupPlan({ olderThanDays: -1 }), /days/)
})

test('busy runs and unfinished editor projects are left alone and reported', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const live = makeRun(f.library, UUID(1), { title: 'Live job' })
  const editing = makeRun(f.library, UUID(2), { title: 'Editing', editor: editorProject(['baked', 'ready']) })
  const done = makeRun(f.library, UUID(3), { title: 'Done editing', editor: editorProject(['baked', 'discarded']) })
  const remixing = makeRun(f.library, `remix-${UUID(4)}`, { title: 'Remaking' })
  const remaking = makeRun(f.library, `remix-${UUID(5)}`, { title: 'Re-making' })
  const editorOpen = makeRun(f.library, UUID(6), { title: 'Editor open' })
  for (const run of [live, editing, done, remixing, remaking, editorOpen]) {
    write(path.join(run, 'framing-source.mp4'), 100)
    write(path.join(run, 'editor-preview.mp4'), 200)
  }
  f.state.live.add(UUID(1))
  f.state.editorBusy.add(UUID(6))
  f.state.remixStatus = { phase: 'rendering', folder: remixing }
  f.state.recomposing = fs.realpathSync(remaking)
  const plan = await f.main.cleanupPlan({})
  const reasons = Object.fromEntries(plan.skipped.map((item) => [item.videoTitle, item.reason]))
  assert.match(reasons['Live job'], /job is still running/)
  assert.match(reasons.Editing, /bake or discard/)
  assert.match(reasons.Remaking, /Remix video is being made/)
  assert.match(reasons['Re-making'], /re-made/)
  assert.match(reasons['Editor open'], /editor is working/)
  assert.deepEqual(groupOf(plan, 'editorMedia').runs.map((run) => run.videoTitle), ['Done editing'])
  assert.deepEqual(groupOf(plan, 'intermediates').runs.map((run) => run.videoTitle).sort(), ['Done editing', 'Editing'])

  const result = await f.main.runCleanup(['editorMedia', 'intermediates'], {})
  // Editor media goes through the editor's own Free editor media, with the project's revision.
  assert.deepEqual(f.state.freed, [[done, 7]])
  assert.equal(result.freedBytes, 200 + 100 + 100)
  for (const run of [live, remixing, remaking, editorOpen]) assert.ok(fs.existsSync(path.join(run, 'framing-source.mp4')))
  assert.ok(fs.existsSync(path.join(editing, 'editor-preview.mp4')))
  assert.ok(!fs.existsSync(path.join(done, 'editor-preview.mp4')))

  // A run that became busy after planning is rechecked under its lock.
  write(path.join(done, 'framing-source.mp4'), 100)
  f.state.editorBusy.add(UUID(3))
  const late = await f.main.runCleanup(['intermediates'], {})
  assert.ok(fs.existsSync(path.join(done, 'framing-source.mp4')))
  assert.ok(late.skipped.some((item) => item.videoTitle === 'Done editing'))
})

test('filters limit the plan to older runs and to fully posted runs', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const old = makeRun(f.library, UUID(1), { title: 'Old' })
  const recent = makeRun(f.library, UUID(2), { title: 'Recent' })
  for (const run of [old, recent]) write(path.join(run, 'framing-source.mp4'), 100)
  const past = new Date(Date.now() - 40 * 86_400_000)
  fs.utimesSync(path.join(old, 'job_output.json'), past, past)
  assert.deepEqual(groupOf(await f.main.cleanupPlan({ olderThanDays: 30 }), 'intermediates').runs.map((run) => run.videoTitle), ['Old'])
  f.state.posted.set(recent, { posted: 1, notPosted: 0 })
  assert.deepEqual(groupOf(await f.main.cleanupPlan({ postedOnly: true }), 'intermediates').runs.map((run) => run.videoTitle), ['Recent'])
  assert.equal((await f.main.cleanupPlan({ postedOnly: true, olderThanDays: 30 })).runCount, 0)
  await f.main.runCleanup(['intermediates'], { postedOnly: true })
  assert.ok(fs.existsSync(path.join(old, 'framing-source.mp4')))
  assert.ok(!fs.existsSync(path.join(recent, 'framing-source.mp4')))
})

test('changing the output folder keeps the old runs listed, and moving them renames, rewrites paths and forgets the folder', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const run = makeRun(f.library, UUID(1), { title: 'Moved run' })
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify({ source: path.join(run, 'editor-source.mp4'), other: '/elsewhere/file.mp4' }))
  makeRun(f.library, UUID(2), { title: 'Busy run' })
  fs.mkdirSync(path.join(f.library, 'not-a-run'))
  assert.equal(f.main.folderChangeInfo().runCount, 2)

  const next = path.join(f.dir, 'next')
  f.main.settings.savePublicSettings({ outputDirectory: next, pythonPath: 'python3' })
  f.main.onOutputFolderChanged(f.library, next)
  assert.deepEqual(f.main.folders.previousOutputFolders(), [f.library])
  const listing = await f.main.listPreviousFolders()
  assert.equal(listing.length, 1)
  assert.deepEqual(listing[0].runs.map((entry) => entry.videoTitle).sort(), ['Busy run', 'Moved run'])
  // Their media stays viewable through the media checks.
  f.main.security.setExtraLibraryRoots(f.main.folders.previousOutputFolders)
  assert.doesNotThrow(() => f.main.security.assertMediaPath(path.join(run, 'clip_00.mp4'), next))
  assert.ok(f.main.security.isWithinLibrary(run, next))

  f.state.live.add(UUID(2))
  const progress = []
  const result = await f.main.moveFolderRuns(f.library, (value) => progress.push(value))
  assert.equal(result.moved, 1)
  assert.deepEqual(result.skipped.map((item) => item.videoTitle), ['Busy run'])
  assert.equal(result.remaining, 1)
  assert.ok(progress.at(-1).done === 1 && progress.at(-1).total === 1)
  const moved = path.join(next, UUID(1))
  assert.ok(!fs.existsSync(run))
  const output = JSON.parse(fs.readFileSync(path.join(moved, 'job_output.json'), 'utf8'))
  assert.equal(output.clips[0].s3_url, `file://${path.join(moved, 'clip_00.mp4')}`)
  const project = JSON.parse(fs.readFileSync(path.join(moved, 'editor-project.json'), 'utf8'))
  assert.equal(project.source, path.join(moved, 'editor-source.mp4'))
  assert.equal(project.other, '/elsewhere/file.mp4')
  assert.equal(f.main.folders.currentRunPath(`file://${path.join(run, 'clip_00.mp4')}`), `file://${path.join(moved, 'clip_00.mp4')}`)
  assert.ok(fs.existsSync(path.join(f.library, 'not-a-run')), 'unrelated folders stay')
  // Still listed while a run remains there; forgotten once it's empty.
  assert.deepEqual(f.main.folders.previousOutputFolders(), [f.library])
  f.state.live.clear()
  assert.equal((await f.main.moveFolderRuns(f.library)).remaining, 0)
  assert.deepEqual(f.main.folders.previousOutputFolders(), [])
  await assert.rejects(f.main.moveFolderRuns(f.library), /earlier output folder/)
  await assert.rejects(f.main.moveFolderRuns(f.dir), /earlier output folder/)
})

test('a move to another drive copies, verifies, then removes the original; a failed copy leaves the original', async (t) => {
  let failCopy = false
  const fsPromises = {
    ...realPromises,
    // Pretend the new folder is on another drive.
    rename: async (from, to) => {
      if (path.basename(path.dirname(from)) === 'library' && path.basename(to).startsWith('.moving-')) throw Object.assign(new Error('cross-device'), { code: 'EXDEV' })
      return realPromises.rename(from, to)
    },
    copyFile: async (from, to, mode) => {
      await realPromises.copyFile(from, to, mode)
      if (failCopy && from.endsWith('clip_00.mp4')) await realPromises.writeFile(to, Buffer.alloc(100, 1))
    }
  }
  const f = fixture({ fsPromises })
  t.after(f.cleanup)
  const run = makeRun(f.library, UUID(1), { title: 'Copied' })
  write(path.join(run, 'nested', 'deep', 'file.bin'), 2048)
  const bad = makeRun(f.library, UUID(2), { title: 'Bad copy' })
  const next = path.join(f.dir, 'next')
  f.main.settings.savePublicSettings({ outputDirectory: next, pythonPath: 'python3' })
  f.main.onOutputFolderChanged(f.library, next)

  failCopy = true
  fs.rmSync(run, { recursive: true }) // only the bad run first
  const first = await f.main.moveFolderRuns(f.library)
  assert.equal(first.moved, 0)
  assert.match(first.skipped[0].reason, /could not be copied.*left where it is/)
  assert.ok(fs.existsSync(path.join(bad, 'clip_00.mp4')), 'the original stays when verification fails')
  assert.deepEqual(fs.readdirSync(next), [], 'no partial copy is left behind')

  failCopy = false
  makeRun(f.library, UUID(1), { title: 'Copied' })
  write(path.join(f.library, UUID(1), 'nested', 'deep', 'file.bin'), 2048)
  const second = await f.main.moveFolderRuns(f.library)
  assert.equal(second.moved, 2)
  assert.ok(!fs.existsSync(path.join(f.library, UUID(1))))
  assert.equal(fs.statSync(path.join(next, UUID(1), 'nested', 'deep', 'file.bin')).size, 2048)
  const output = JSON.parse(fs.readFileSync(path.join(next, UUID(1), 'job_output.json'), 'utf8'))
  assert.equal(output.clips[0].s3_url, `file://${path.join(next, UUID(1), 'clip_00.mp4')}`)
  assert.ok(!fs.existsSync(path.join(f.dir, 'userData', 'library-moves.json')), 'the move journal is cleared')
})

test('a move interrupted after the rename is finished at the next start', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const next = path.join(f.dir, 'next')
  fs.mkdirSync(next)
  const source = path.join(f.library, UUID(1))
  const staging = path.join(next, '.moving-11111111-1111-4111-8111-111111111111')
  makeRun(f.library, UUID(1))
  fs.renameSync(source, staging)
  fs.writeFileSync(path.join(f.dir, 'userData', 'library-moves.json'), JSON.stringify([{ source, staging, dest: path.join(next, UUID(1)), mode: 'rename' }]))
  await f.main.recoverInterruptedMoves()
  const output = JSON.parse(fs.readFileSync(path.join(next, UUID(1), 'job_output.json'), 'utf8'))
  assert.equal(output.clips[0].s3_url, `file://${path.join(next, UUID(1), 'clip_00.mp4')}`)
  assert.ok(!fs.existsSync(staging))
  assert.ok(!fs.existsSync(path.join(f.dir, 'userData', 'library-moves.json')))
})

test('earlier folders can be hidden without deleting anything, and picking one again makes it current', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  makeRun(f.library, UUID(1))
  const next = path.join(f.dir, 'next')
  f.main.settings.savePublicSettings({ outputDirectory: next, pythonPath: 'python3' })
  f.main.onOutputFolderChanged(f.library, next)
  // Back to the first folder: it is current again, and the empty new one is not remembered.
  f.main.settings.savePublicSettings({ outputDirectory: f.library, pythonPath: 'python3' })
  f.main.onOutputFolderChanged(next, f.library)
  assert.deepEqual(f.main.folders.previousOutputFolders(), [])
  f.main.settings.savePublicSettings({ outputDirectory: next, pythonPath: 'python3' })
  f.main.onOutputFolderChanged(f.library, next)
  assert.throws(() => f.main.forgetFolder(path.join(f.dir, 'other')), /earlier output folder/)
  f.main.forgetFolder(f.library)
  assert.deepEqual(f.main.folders.previousOutputFolders(), [])
  assert.ok(fs.existsSync(path.join(f.library, UUID(1), 'clip_00.mp4')))
})

test('free space reports the output drive, even before the output folder exists', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.main.settings.savePublicSettings({ outputDirectory: path.join(f.dir, 'not', 'yet'), pythonPath: 'python3' })
  const space = await f.main.freeSpace()
  assert.equal(typeof space.freeBytes, 'number')
  assert.equal(space.low, space.freeBytes < space.thresholdBytes)
  assert.equal(space.thresholdBytes, 2_000_000_000)
})
