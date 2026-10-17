'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true } catch { return false } })()
const plain = (value) => JSON.parse(JSON.stringify(value))

/** Library modules bundled together (real file system, fake Electron). */
function fixture() {
  const temp = tempDir('cc-avatar-library-')
  const library = path.join(temp.dir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const source = [
    "export * as avatars from './src/main/avatar-library'",
    "export * as manage from './src/main/library-management'",
    "export * as files from './src/main/file-manager'",
    "export * as ctas from './src/main/ctas'",
    "export * as settings from './src/main/settings-store'",
    "export { parseJobOutput } from './src/shared/job-output'"
  ].join('; ')
  const main = loadMain(source, {
    electron: fakeElectron(temp.dir).electron,
    './job-manager': { liveJobIds: () => new Set(), dismissJob: () => undefined }
  })
  main.settings.savePublicSettings({ outputDirectory: library, pythonPath: 'python3' })
  return { ...temp, library, main }
}

/** A legacy render folder: `<output>/Avatar Studio/<name>/<video>` (+ script.json). */
function legacyRender(library, name, { video = 'final.mp4', script = null, bytes = 'video bytes' } = {}) {
  const folder = path.join(library, 'Avatar Studio', name)
  fs.mkdirSync(path.join(folder, 'parts'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'parts', 'narration.mp3'), 'mp3')
  if (video) fs.writeFileSync(path.join(folder, video), bytes)
  if (script) fs.writeFileSync(path.join(folder, 'script.json'), JSON.stringify(script))
  return folder
}

const avatarRuns = (library) => fs.readdirSync(library).filter((name) => /^avatar-/.test(name)).sort()

test('a finished avatar video is written as a valid Library run with clip_00.mp4, made with AI', async () => {
  const f = fixture()
  try {
    const run = f.main.avatars.newAvatarRun(f.library)
    assert.match(path.basename(run), f.main.avatars.AVATAR_RUN)
    fs.mkdirSync(run)
    fs.writeFileSync(path.join(run, 'clip_00.mp4'), 'mp4')
    await f.main.avatars.writeAvatarJobOutput(run, { title: '  Stop  buying coffee ', headline: 'Stop buying coffee', postCaption: 'Stop buying coffee. Here is why.', durationMs: 12345.6, kind: 'talking', estimatedCostUsd: 0.02 })
    assert.deepEqual(fs.readdirSync(run).sort(), ['clip_00.mp4', 'job_output.json'], 'no temp file left behind')
    const raw = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
    const output = plain(f.main.parseJobOutput(raw))
    assert.ok(output, 'the Library accepts it')
    assert.equal(output.job_id, path.basename(run))
    assert.equal(output.source_video_title, 'Avatar Studio · Stop buying coffee')
    assert.equal(output.clips.length, 1)
    const [clip] = output.clips
    assert.equal(clip.s3_url, `file://${path.join(run, 'clip_00.mp4')}`)
    assert.deepEqual([clip.clip_index, clip.duration_ms, clip.start_time_ms, clip.end_time_ms], [0, 12346, 0, 12346])
    assert.deepEqual([clip.summary, clip.headline, clip.post_caption, clip.ai_generated, clip.cta], ['Stop buying coffee', 'Stop buying coffee', 'Stop buying coffee. Here is why.', true, null])
    assert.equal(output.metrics.api_costs.total_estimated_cost_usd, 0.02)
    // No hook and no caption are written as null, not empty strings.
    const bare = f.main.avatars.avatarJobOutput(run, { title: '', headline: null, postCaption: '  ', durationMs: 1000, kind: 'recreate' })
    assert.deepEqual([bare.clips[0].headline, bare.clips[0].post_caption, bare.source_video_title], [null, null, 'Avatar Studio · Avatar video'])
    assert.equal('api_costs' in bare.metrics, false, 'no cost is made up when it is unknown')
    const history = plain(await f.main.files.getJobHistory(f.library))
    assert.deepEqual(history.map((entry) => [entry.jobId, entry.status, entry.clipCount]), [[path.basename(run), 'completed', 1]])
  } finally { f.cleanup() }
})

test('a render still in progress (no job_output.json yet) is not listed', async () => {
  const f = fixture()
  try {
    const run = f.main.avatars.newAvatarRun(f.library)
    fs.mkdirSync(path.join(run, '.avatar', 'parts'), { recursive: true })
    assert.deepEqual(plain(await f.main.files.getJobHistory(f.library)), [])
  } finally { f.cleanup() }
})

test('old Avatar Studio videos are imported into the Library once, linked not copied, originals untouched', async () => {
  const f = fixture()
  try {
    const script = { title: 'Stop buying coffee', style: 'talking', scenes: [{ narration: 'Stop buying coffee. Brew it at home instead.', visual: '' }] }
    const talking = legacyRender(f.library, '2026-10-13 093105 Stop buying coffee', { script })
    const recreate = legacyRender(f.library, '2026-10-14 101500 POV you finally get it', { video: 'final-no-captions.mp4' })
    legacyRender(f.library, '2026-10-15 080000 Failed render', { video: null })
    fs.writeFileSync(path.join(f.library, 'Avatar Studio', 'notes.txt'), 'not a render')
    const made = new Date('2026-10-13T09:31:05Z')
    fs.utimesSync(path.join(talking, 'final.mp4'), made, made)
    const probed = []
    const probe = async (file) => { probed.push(path.basename(file)); return 4200 }

    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library, probe), 2)
    assert.deepEqual(probed.sort(), ['final-no-captions.mp4', 'final.mp4'])
    const runs = avatarRuns(f.library)
    assert.equal(runs.length, 2)
    const history = plain(await f.main.files.getJobHistory(f.library))
    const byTitle = Object.fromEntries(history.map((entry) => [entry.videoTitle, entry]))
    assert.deepEqual(Object.keys(byTitle).sort(), ['Avatar Studio · POV you finally get it', 'Avatar Studio · Stop buying coffee'])
    const coffee = byTitle['Avatar Studio · Stop buying coffee']
    assert.equal(coffee.date, made.toISOString(), 'dated when it was made, not when it was imported')
    const output = plain(await f.main.files.getJobOutput(coffee.outputDir, f.library))
    assert.deepEqual([output.clips[0].post_caption, output.clips[0].ai_generated, output.clips[0].duration_ms], ['Stop buying coffee. Brew it at home instead.', true, 4200])
    const pov = plain(await f.main.files.getJobOutput(byTitle['Avatar Studio · POV you finally get it'].outputDir, f.library))
    assert.equal(pov.clips[0].post_caption, null, 'no script, so no caption is invented')
    // A hard link: same file, no extra space, and the original stays where it was.
    const original = fs.statSync(path.join(talking, 'final.mp4')), linked = fs.statSync(path.join(coffee.outputDir, 'clip_00.mp4'))
    assert.equal(linked.ino, original.ino)
    assert.equal(fs.readFileSync(path.join(recreate, 'final-no-captions.mp4'), 'utf8'), 'video bytes')
    assert.ok(fs.existsSync(path.join(talking, 'parts', 'narration.mp3')))

    // Idempotent: nothing new on later scans, even after a run is deleted from the Library.
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library, probe), 0)
    assert.equal(avatarRuns(f.library).length, 2)
    await f.main.manage.deleteLibraryRun(coffee.outputDir)
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library, probe), 0)
    assert.equal(avatarRuns(f.library).length, 1)
    assert.equal(fs.readFileSync(path.join(talking, 'final.mp4'), 'utf8'), 'video bytes', 'deleting the run keeps the original')

    // Concurrent scans (two Library loads) import a new render once.
    legacyRender(f.library, '2026-10-16 090000 Third video')
    const both = await Promise.all([f.main.avatars.importLegacyAvatarVideos(f.library, probe), f.main.avatars.importLegacyAvatarVideos(f.library, probe)])
    assert.deepEqual(both, [1, 1], 'the second call waits for the first')
    assert.equal(avatarRuns(f.library).length, 2)
  } finally { f.cleanup() }
})

test('an import interrupted before its run was finished starts again; unreadable videos are retried later', async () => {
  const f = fixture()
  try {
    const folder = legacyRender(f.library, '2026-10-13 093105 Hook')
    // A crash after the marker and part of the run were written, before job_output.json.
    const stale = `avatar-${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`
    fs.mkdirSync(path.join(f.library, stale, '.avatar'), { recursive: true })
    fs.writeFileSync(path.join(f.library, stale, 'clip_00.mp4'), 'partial')
    fs.writeFileSync(path.join(folder, '.library-run.json'), JSON.stringify({ run: stale, done: false }))
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library, async () => 1000), 1)
    assert.equal(fs.existsSync(path.join(f.library, stale)), false, 'the half-made run is removed')
    assert.equal(avatarRuns(f.library).length, 1)
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder, '.library-run.json'), 'utf8')).done, true)

    const broken = legacyRender(f.library, '2026-10-14 000000 Broken')
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library, async () => { throw new Error('unreadable') }), 0)
    assert.equal(fs.existsSync(path.join(broken, '.library-run.json')), false, 'not marked, so a later scan can try again')
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library, async () => 1000), 1)
  } finally { f.cleanup() }
})

test('links and other non-render entries in Avatar Studio are never imported', async () => {
  const f = fixture()
  try {
    const outside = path.join(f.dir, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'final.mp4'), 'private')
    fs.mkdirSync(path.join(f.library, 'Avatar Studio'), { recursive: true })
    fs.symlinkSync(outside, path.join(f.library, 'Avatar Studio', 'linked'), 'dir')
    const folder = path.join(f.library, 'Avatar Studio', '2026-10-13 093105 Linked video')
    fs.mkdirSync(folder)
    fs.symlinkSync(path.join(outside, 'final.mp4'), path.join(folder, 'final.mp4'))
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library, async () => 1000), 0)
    assert.deepEqual(avatarRuns(f.library), [])
    // No Avatar Studio folder at all is fine.
    const empty = path.join(f.dir, 'empty')
    fs.mkdirSync(empty)
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(empty, async () => 1000), 0)
  } finally { f.cleanup() }
})

test('Library features on an avatar run: listed, CTA added and switched off, then deleted (the original video stays)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const f = fixture()
  try {
    const folder = path.join(f.library, 'Avatar Studio', '2026-10-13 093105 Stop buying coffee')
    fs.mkdirSync(folder, { recursive: true })
    const video = path.join(folder, 'final.mp4')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=540x960:d=2:r=30', '-f', 'lavfi', '-i', 'sine=d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
    const before = fs.readFileSync(video)
    assert.equal(await f.main.avatars.importLegacyAvatarVideos(f.library), 1, 'imported with the real duration probe')
    const [entry] = plain(await f.main.files.getJobHistory(f.library))
    assert.equal(entry.videoTitle, 'Avatar Studio · Stop buying coffee')
    let output = plain(await f.main.files.getJobOutput(entry.outputDir, f.library))
    assert.ok(Math.abs(output.clips[0].duration_ms - 2000) < 150)

    const graphic = path.join(f.dir, 'offer.png')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=400x400', '-frames:v', '1', graphic])
    const [cta] = plain(await f.main.ctas.addCta(graphic, 'Free guide'))
    const apply = (choice) => (run, index) => f.main.ctas.applyRunCta(run, choice, [index])
    output = plain(await f.main.manage.setLibraryClipCta(entry.outputDir, 0, apply(cta.id)))
    assert.equal(output.clips[0].cta.id, cta.id)
    assert.ok(output.clips[0].duration_ms > 2000 + cta.seconds * 1000 - 300, 'the CTA plays at the end')
    assert.deepEqual(fs.readFileSync(video), before, 'the original render is untouched')
    output = plain(await f.main.manage.setLibraryClipCta(entry.outputDir, 0, apply(null)))
    assert.equal(output.clips[0].cta, null)
    assert.ok(Math.abs(output.clips[0].duration_ms - 2000) < 150)

    await f.main.manage.deleteLibraryRun(entry.outputDir)
    assert.equal(fs.existsSync(entry.outputDir), false)
    assert.deepEqual(plain(await f.main.files.getJobHistory(f.library)), [])
    assert.deepEqual(fs.readFileSync(video), before, 'Show in folder files from before still play')
  } finally { f.cleanup() }
})
