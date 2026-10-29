const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true } catch { return false } })()

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, Uint8Array, JSON,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))

function probe(file) {
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file]).toString())
  return { streams: out.streams.map((s) => s.codec_type), video: out.streams.find((s) => s.codec_type === 'video'), seconds: Number(out.format.duration) }
}

function meanColor(file, at, crop) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `${crop},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [...raw]
}

test('the CTA library takes videos and images, and appends, switches and removes a CTA on a clip', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ctas-'))
  const authorized = []
  const ctas = load('main/ctas.ts', {
    electron: { app: { getPath: () => userData } },
    './security': { authorizeMedia: (p) => { authorized.push(p); return p } },
    './tools': { resolveBinary: (name) => name }
  })
  // A phone-style 9:16 recording with sound, and a square offer graphic.
  const recording = path.join(userData, 'my cta.mov')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=720x1280:d=20:r=24', '-f', 'lavfi', '-i', 'sine=d=20', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', recording])
  const graphic = path.join(userData, 'offer.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=800x800', '-frames:v', '1', graphic])

  await assert.rejects(ctas.addCta(path.join(userData, 'notes.txt'), ''), /Choose a video/)
  let list = plain(await ctas.addCta(recording, 'Comment PLAYBOOK'))
  assert.equal(list.length, 1)
  assert.equal(list[0].kind, 'video')
  assert.equal(list[0].name, 'Comment PLAYBOOK')
  assert.equal(list[0].seconds, 15, 'a long recording is cut to 15 seconds')
  assert.deepEqual(probe(list[0].path).streams.sort(), ['audio', 'video'])
  list = plain(await ctas.addCta(graphic, ''))
  assert.equal(list[1].kind, 'image')
  assert.equal(list[1].name, 'offer')
  assert.equal(list[1].seconds, 4)
  assert.ok(authorized.includes(list[1].path), 'previewable in the app')
  list = plain(await ctas.updateCta(list[1].id, { seconds: 3, name: 'Free guide' }))
  assert.deepEqual([list[1].name, list[1].seconds], ['Free guide', 3])
  await assert.rejects(ctas.updateCta(list[1].id, { seconds: 30 }), /2-8 seconds/)
  await assert.rejects(ctas.updateCta(list[0].id, { seconds: 3 }), /own length/)
  const [video, image] = list

  // A finished run: one 16:9 clip without sound, one 9:16 clip with sound.
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-run-'))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=1920x1080:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(run, 'clip_00.mp4')])
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=1080x1920:d=3:r=30', '-f', 'lavfi', '-i', 'sine=d=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(run, 'clip_01.mp4')])
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ clips: [{ clip_index: 0, duration_ms: 3000, summary: 'A' }, { clip_index: 1, duration_ms: 3000, summary: 'B' }] }))

  assert.deepEqual(plain(await ctas.applyRunCta(run, image.id)), { failed: [], cancelled: false })
  let out = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
  assert.deepEqual(out.clips.map((c) => c.cta), [{ id: image.id, name: 'Free guide', seconds: 3 }, { id: image.id, name: 'Free guide', seconds: 3 }])
  assert.ok(Math.abs(out.clips[0].duration_ms - 6000) < 250, `3s clip + 3s image (${out.clips[0].duration_ms})`)
  assert.equal(out.clips[0].summary, 'A', 'other fields are kept')
  const wide = probe(path.join(run, 'clip_00.mp4'))
  assert.deepEqual([wide.video.width, wide.video.height], [1920, 1080], 'the CTA is fitted to the clip’s own frame')
  assert.deepEqual(wide.streams.sort(), ['audio', 'video'])
  assert.ok(fs.existsSync(path.join(run, 'clip_00.original.mp4')))
  const [r, g, b] = meanColor(path.join(run, 'clip_00.mp4'), 4.5, 'crop=200:200:860:440')
  assert.ok(b > 150 && g < 100, `the image shows at the end (${r},${g},${b})`)

  // Switch one clip to the recorded CTA: built from the original, not stacked.
  await ctas.applyRunCta(run, video.id, [1])
  out = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
  assert.equal(out.clips[1].cta.id, video.id)
  assert.equal(out.clips[0].cta.id, image.id, 'the other clip is untouched')
  assert.ok(Math.abs(out.clips[1].duration_ms - 18000) < 300, `3s + 15s (${out.clips[1].duration_ms})`)
  const tall = probe(path.join(run, 'clip_01.mp4'))
  assert.deepEqual([tall.video.width, tall.video.height], [1080, 1920])
  const [r2, g2] = meanColor(path.join(run, 'clip_01.mp4'), 10, 'crop=100:100:490:910')
  assert.ok(r2 > 150 && g2 < 100, 'the recording plays at the end')

  // Remove: back to the clip as rendered.
  await ctas.applyRunCta(run, null, [1])
  out = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
  assert.equal(out.clips[1].cta, null)
  assert.ok(Math.abs(out.clips[1].duration_ms - 3000) < 150)
  assert.ok(!fs.existsSync(path.join(run, 'clip_01.original.mp4')))
  assert.deepEqual(fs.readdirSync(run).filter((f) => f.startsWith('.cta-')), [], 'no temp files left')

  // A transparent PNG keeps its transparency: the clip's own last frame (blurred) shows around the logo, not a black box.
  const logo = path.join(userData, 'logo.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=200x200,format=rgba,pad=600:600:200:200:color=black@0', '-frames:v', '1', logo])
  list = plain(await ctas.addCta(logo, 'Logo'))
  const png = list.find((c) => c.name === 'Logo')
  assert.match(png.path, /\.png$/)
  await ctas.applyRunCta(run, png.id, [0])
  const [lr] = meanColor(path.join(run, 'clip_00.mp4'), 4, 'crop=200:200:860:440')
  assert.ok(lr > 150, `the logo shows (${lr})`)
  const [er, eg] = meanColor(path.join(run, 'clip_00.mp4'), 4, 'crop=100:100:40:40')
  assert.ok(eg > er, `around it: the clip's green, blurred (${er},${eg})`)
  out = JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8'))
  assert.equal(out.clips[0].cta.seconds, 4)

  // Cancelled before it starts: nothing changes, and it says so.
  const before = fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')
  const stop = new AbortController(); stop.abort()
  assert.deepEqual(plain(await ctas.applyRunCta(run, video.id, undefined, { signal: stop.signal })), { failed: [], cancelled: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).clips.map((c) => c.cta?.id ?? null),
    JSON.parse(before).clips.map((c) => c.cta?.id ?? null))
  // Progress per clip.
  const steps = []
  await ctas.applyRunCta(run, null, undefined, { onProgress: (done, total) => steps.push([done, total]) })
  assert.deepEqual(steps, [[1, 2], [2, 2]])
  // Leftover temp files from an interrupted change are cleared.
  fs.writeFileSync(path.join(run, '.cta-deadbeef.mp4'), 'partial')
  await ctas.applyRunCta(run, null)
  assert.ok(!fs.existsSync(path.join(run, '.cta-deadbeef.mp4')))

  // A removed CTA can't be used; the library entry is gone.
  list = plain(await ctas.removeCta(image.id))
  assert.equal(list.length, 2)
  await assert.rejects(ctas.applyRunCta(run, image.id), /no longer in your library/)
  await assert.rejects(ctas.removeCta('../x'), /Choose a call to action/)
})

test('a call to action that can\'t be added leaves the clip exactly as it was, with no stray original copy', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ctas-fail-'))
  const ctas = load('main/ctas.ts', {
    electron: { app: { getPath: () => userData } },
    './security': { authorizeMedia: (p) => p },
    './tools': { resolveBinary: (name) => name }
  })
  const clip = path.join(userData, 'clip_00.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
  const before = fs.readFileSync(clip)
  // A CTA whose file is unreadable: the step fails.
  const broken = path.join(userData, 'broken.mp4')
  fs.writeFileSync(broken, 'not a video')
  await assert.rejects(ctas.renderClipCta(clip, { id: 'a1b2c3d4e5f60718', name: 'x', kind: 'video', seconds: 3, path: broken }))
  assert.equal(fs.readFileSync(clip).equals(before), true)
  assert.equal(fs.existsSync(ctas.originalPath(clip)), false, 'no original left behind that says the clip has a CTA')
  // Holding the run's lock: other work on the run waits its turn (any spelling of the path).
  const order = []
  const first = ctas.withRunLock(userData, async () => { await new Promise((r) => setTimeout(r, 50)); order.push('first') })
  const second = ctas.withRunLock(userData + path.sep, async () => { order.push('second') })
  await Promise.all([first, second])
  assert.deepEqual(order, ['first', 'second'])
  fs.rmSync(userData, { recursive: true, force: true })
})

test('a clip whose original was removed to free up space keeps its call to action instead of stacking or dropping it', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ctas-freed-'))
  try {
    const ctas = load('main/ctas.ts', { electron: { app: { getPath: () => userData } }, './security': { authorizeMedia: (p) => p }, './tools': { resolveBinary: (name) => name } })
    const run = path.join(userData, 'run')
    fs.mkdirSync(run)
    fs.writeFileSync(path.join(run, 'clip_00.mp4'), 'clip with its call to action')
    const output = { clips: [{ clip_index: 0, s3_url: path.join(run, 'clip_00.mp4'), duration_ms: 5000, cta: { id: 'a1b2c3d4e5f60718', name: 'Follow' } }] }
    fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify(output))
    await assert.rejects(ctas.applyRunCta(run, null, [0]), /original was removed to free up space/)
    assert.deepEqual(plain(await ctas.applyRunCta(run, null)), { failed: [0], cancelled: false })
    assert.equal(fs.readFileSync(path.join(run, 'clip_00.mp4'), 'utf8'), 'clip with its call to action')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run, 'job_output.json'), 'utf8')).clips[0].cta, output.clips[0].cta)
  } finally { fs.rmSync(userData, { recursive: true, force: true }) }
})
