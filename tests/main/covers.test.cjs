'use strict'
// Make my cover: words and layouts (shared/covers.ts) and main's checks and files (src/main/covers.ts).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')

const shared = loadMain("export * from './src/shared/covers'")
const measure = (line, size) => line.length * size * 0.5
const plain = (v) => JSON.parse(JSON.stringify(v))

test('thumbnail words: 3 to 5 words said, numbers and strong words first, never starting or ending on a little word', () => {
  assert.equal(shared.thumbnailWords('Yesterday I spent $4,365 on ads to get buyers'), 'Yesterday I spent $4,365')
  const picked = shared.thumbnailWords('You do not have to be an influencer to make money online')
  const words = picked.split(' ')
  assert.ok(words.length >= 3 && words.length <= 5, picked)
  assert.ok('You do not have to be an influencer to make money online'.includes(picked))
  assert.ok(!['to', 'a', 'an', 'the', 'and'].includes(words[0].toLowerCase()) && !['to', 'a', 'an', 'the', 'and'].includes(words.at(-1).toLowerCase()))
  // Short text stays whole; nothing is made up.
  assert.equal(shared.thumbnailWords('Stop scrolling now'), 'Stop scrolling now')
  assert.equal(shared.thumbnailWords('   '), '')
  // Reel: the headline; YouTube: from the headline, else from what was said.
  assert.equal(shared.coverText('reel', 'A virtual nobody when it comes to the internet', 'x y z'), 'A virtual nobody when it comes to the internet')
  assert.ok('I made 12 sales from one video today'.includes(shared.coverText('youtube', '', 'I made 12 sales from one video today')))
  assert.equal(shared.coverFileName('/runs/a/clip_00.mp4', 'jpg'), 'clip_00.cover.jpg')
  assert.equal(shared.coverFileName('C:\\runs\\video.final.mov', 'png'), 'video.final.cover.png')
  assert.equal(shared.coverFormatFor(1920, 1080), 'youtube')
  assert.equal(shared.coverFormatFor(1080, 1920), 'reel')
})

test('reel cover: the frame fills 1080x1920, the hook sits inside the part Instagram and TikTok leave clear, off the eyes', () => {
  const face = [0.33, 0.28, 0.38, 0.33]
  const layout = shared.reelCoverLayout(1080, 1920, face, 'A virtual nobody when it comes to the internet', measure, { color: '#7C3AED' })
  assert.equal(layout.width, 1080); assert.equal(layout.height, 1920)
  const { image, hook } = layout
  assert.ok(image.x <= 0 && image.y <= 0 && image.x + image.width >= 1080 && image.y + image.height >= 1920)
  assert.equal(hook.at, 'top')
  const top = Math.min(...hook.lines.map((l) => l.center - l.height / 2)) + hook.offsetY
  const bottom = Math.max(...hook.lines.map((l) => l.center + l.height / 2)) + hook.offsetY
  assert.ok(top >= 1920 * shared.COVER_SAFE.top - 1, `hook top ${top}`)
  assert.ok(bottom <= 1920 * shared.COVER_SAFE.buttonsFrom, `hook bottom ${bottom}`)
  for (const l of hook.lines) assert.ok(l.width <= 1080 * (1 - 2 * shared.COVER_SAFE.side) + 1)
  // The hook may sit over the hair, never over the eyes.
  assert.ok(bottom <= image.y + (face[1] + 0.3 * face[3]) * image.height, `hook bottom ${bottom}`)
  // The key words go on a box in the brand color.
  assert.equal(layout.colors.phraseBg, '#7C3AED')
  assert.ok(hook.lines.some((l) => l.phrase) && hook.leadPath && hook.phrasePath)
  // A face high in the frame: the hook moves down, still above the caption line at the bottom.
  const high = shared.reelCoverLayout(1080, 1920, [0.3, 0.03, 0.4, 0.3], 'Stop posting every day', measure, null)
  assert.equal(high.hook.at, 'bottom')
  const lowBottom = Math.max(...high.hook.lines.map((l) => l.center + l.height / 2)) + high.hook.offsetY
  assert.ok(lowBottom <= 1920 * (1 - shared.COVER_SAFE.bottom) + 1)
  // A landscape frame still fills the 9:16 cover around the face.
  const wide = shared.reelCoverLayout(1920, 1080, [0.6, 0.2, 0.15, 0.3], 'Hello there', measure, null)
  assert.ok(wide.image.x <= 0 && wide.image.x + wide.image.width >= 1080 && wide.image.height >= 1920)
  const faceX = wide.image.x + (0.6 + 0.075) * wide.image.width
  assert.ok(faceX > 300 && faceX < 780, `face at ${faceX}`)
})

test('YouTube cover: 1280x720, big upper-case words on one side, the face big on the other, the key words on the brand color', () => {
  const layout = shared.youtubeCoverLayout(1920, 1080, [0.55, 0.2, 0.15, 0.3], 'Yesterday I spent $4,365', measure, { color: '#E11D48' })
  assert.equal(layout.width, 1280); assert.equal(layout.height, 720)
  assert.equal(layout.side, 'left')
  assert.ok(layout.lines.length >= 2 && layout.lines.length <= 3)
  assert.equal(layout.lines.map((l) => l.text).join(' '), 'YESTERDAY I SPENT $4,365')
  for (const l of layout.lines) {
    assert.ok(l.x >= 0 && l.x + l.width <= 1280 * 0.6, `line ${l.text} at ${l.x}+${l.width}`)
    assert.ok(l.size >= 64)
  }
  assert.ok(layout.lines.at(-1).key && !layout.lines[0].key)
  assert.equal(layout.accent, '#E11D48')
  // The face on the right half, about half the height.
  const faceCx = layout.image.x + (0.55 + 0.075) * layout.image.width
  const faceH = 0.3 * layout.image.height
  assert.ok(faceCx > 1280 * 0.6, `face at ${faceCx}`)
  assert.ok(faceH > 720 * 0.3 && faceH < 720 * 0.65, `face height ${faceH}`)
  assert.ok(layout.image.x <= 0 && layout.image.x + layout.image.width >= 1280 && !layout.backdrop)
  // A face on the left of a landscape frame: the words go right.
  assert.equal(shared.youtubeCoverLayout(1920, 1080, [0.15, 0.2, 0.15, 0.3], 'Big words here', measure, null).side, 'right')
  // A 9:16 frame: a blurred copy fills behind it.
  const tall = shared.youtubeCoverLayout(1080, 1920, [0.33, 0.28, 0.38, 0.33], 'Make money online', measure, null)
  assert.ok(tall.backdrop)
})

function loadCovers(library) {
  const { dir } = tempDir('bridgeclip-covers-')
  return loadMain("export * from './src/main/covers'", {
    electron: fakeElectron(dir).electron ?? fakeElectron(dir),
    './settings-store': { loadSettings: () => ({ outputDirectory: library, pythonPath: '' }) },
    './pipeline-runner': { getBridgeRunnerPath: () => '/nope/bridge_runner.py', getEnginePath: () => '/nope/engine', resolvePythonPath: () => '/nope/python', runtimeEnvironment: () => ({}) },
    './logger': { logger: { warn: () => {}, info: () => {}, error: () => {} } },
    './tools': { resolveBinary: (name) => name }
  })
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])

test('main: only a video in the Library; the cover is checked and saved next to it, one per video, and found for posting', async () => {
  const { dir: library, cleanup } = tempDir('bridgeclip-covers-lib-')
  try {
    const run = path.join(library, 'edit-1')
    fs.mkdirSync(run)
    const video = path.join(run, 'clip_00.mp4')
    fs.writeFileSync(video, 'video')
    fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ clips: [{ clip_index: 0, s3_url: `file://${video}`, headline: 'Old headline', post_caption: 'Said words here', editor_candidate: 'c1' }] }))
    fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify({
      candidates: [{ id: 'c1', hook: { text: 'You do not have to be an influencer', look: { look: 'floating', color: '#7C3AED', font: 'serif' } } }],
      transcript: [{ text: 'You do not have to be an influencer' }, { text: 'to make money online.' }]
    }))
    const outside = path.join(path.dirname(library), `outside-${process.pid}.mp4`)
    fs.writeFileSync(outside, 'x')
    const covers = loadCovers(library)
    assert.throws(() => covers.libraryVideo('clip_00.mp4'), /Library/)
    assert.throws(() => covers.libraryVideo(path.join(run, 'job_output.json')), /Library/)
    assert.throws(() => covers.libraryVideo(outside), /Library/)
    assert.throws(() => covers.libraryVideo(42), /Library/)
    fs.rmSync(outside)
    assert.equal(covers.libraryVideo(video).run, fs.realpathSync(run))

    const words = await covers.videoWords(fs.realpathSync(video), fs.realpathSync(run))
    assert.equal(words.headline, 'You do not have to be an influencer')
    assert.equal(words.said, 'You do not have to be an influencer to make money online.')
    assert.equal(words.look.color, '#7C3AED')

    assert.equal(await covers.savedCover(video), null)
    await assert.rejects(covers.saveCover(video, PNG, 'jpg'), /JPG or PNG/)
    await assert.rejects(covers.saveCover(video, JPEG, 'gif'), /JPG or PNG/)
    await assert.rejects(covers.saveCover(video, Buffer.alloc(10), 'jpg'), /empty/)
    await assert.rejects(covers.saveCover(video, Buffer.concat([JPEG, Buffer.alloc(11 * 1024 * 1024)]), 'jpg'), /too large/)
    const png = await covers.saveCover(video, new Uint8Array(PNG), 'png')
    assert.equal(png.path, path.join(fs.realpathSync(run), 'clip_00.cover.png'))
    const jpg = await covers.saveCover(video, new Uint8Array(JPEG), 'jpg')
    assert.equal(path.basename(jpg.path), 'clip_00.cover.jpg')
    assert.ok(!fs.existsSync(png.path), 'one cover per video: the PNG went')
    assert.deepEqual(plain(await covers.savedCover(video)), { path: jpg.path, sizeBytes: JPEG.length })
    // No temp files left behind.
    assert.deepEqual(fs.readdirSync(run).filter((n) => n.includes('.tmp')), [])
  } finally { cleanup() }
})
