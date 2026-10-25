// Stage moments and text effects as the owner's run 5 showed them, drawn by the app's own offscreen render page:
// - a Wrong / right on the stage is two big filled cards across ~90% of the frame, its ✗ and ✓ badges in, the wrong
//   side struck (it was two small outline boxes with faint words on a dead blue frame);
// - every words effect at rest sits on the near-solid dark glass with its words at full strength, and is fully in about
//   10 frames after it starts (lines sat half see-through, "ghostly", for most of a second).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { loadMain } = require('../zernio/support/load-main.cjs')

const m = loadMain("export * from './src/shared/graphic-layout'")

test('a Wrong / right fills the stage; text effects are solid at rest and in within about 10 frames', { timeout: 600000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-stage-moments-'))
  const appDir = buildApp(path.join(root, 'app'))
  const session = await launchApp({ appDir, userDataDir: path.join(root, 'user-data') })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const stage = { aspect: '9:16', hook: 0, captions: { y: .532, bottom: false }, handle: null }
  const card = { aspect: '9:16', hook: 0, captions: { y: 1340 / 1920, bottom: false }, handle: null }
  const LINE = "Now that we know we're not gonna go viral"
  const words = [
    ['marker-highlight', { text: LINE, word: 'viral', style: 'highlight' }, true],
    ['vox-annotate', { text: 'especially cold audience', word: 'cold', note: "people that don't know us", style: 'underline' }, true],
    ['line-swap', { first: 'A warm audience will buy anything.', second: 'we need a better sales page.', underline: 'better sales page' }, true],
    ['per-word-rise', { text: 'and instead I just focus on making' }, false],
    ['text-stagger', { text: 'especially cold audience' }, false]
  ]
  const specs = words.map(([effect, fields, quick]) => ({ name: effect, quick, spec: { template: 'fx', fields: { effect, theme: 'dark', ...fields }, width: 1080, height: 1920,
    duration_ms: 4000, box: m.graphicBox('top', card, 'card'), placement: 'top', color: '#2F5BFF', font: 'clean', accent_font: 'serif' } }))
  const compare = { template: 'compare_marks', fields: { items: 'organic content\nads', wrong: 'first', item_ms: '0\n2200' }, width: 1080, height: 1920, duration_ms: 3900,
    box: m.graphicBox('middle', stage, 'stage'), placement: 'middle', color: '#7CB82F', font: 'clean', size: 'stage' }
  const page = path.join(appDir, 'out', 'renderer', 'graphics.html')
  const shots = await session.app.evaluate(async ({ BrowserWindow }, { page, specs, compare }) => {
    const w = new BrowserWindow({ show: false, width: 1080, height: 1920, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
      enableLargerThanScreen: true, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false, webgl: false, partition: 'stage-moments-test' } })
    w.setContentSize(1080, 1920)
    w.webContents.setFrameRate(60)
    await w.loadFile(page)
    const grab = async (ms) => {
      await w.webContents.executeJavaScript(`window.__graphic.frame(${ms})`)
      let img = await w.webContents.capturePage()
      if (img.getSize().width !== 1080) img = img.resize({ width: 1080, height: 1920 })
      return img.toBitmap()
    }
    // BGRA (every other pixel): bright opaque pixels (words) and near-solid dark glass.
    const read = (px, top, bottom) => {
      let bright = 0, solid = 0
      for (let y = Math.floor(top * 1920); y < Math.ceil(bottom * 1920); y += 2) {
        for (let x = 0; x < 1080; x += 2) {
          const i = (y * 1080 + x) * 4, b = px[i], g = px[i + 1], r = px[i + 2], a = px[i + 3]
          if (a >= 250 && r > 215 && g > 215 && b > 215) bright++
          if (r < 60 && g < 60 && b < 70 && a >= 230) solid++
        }
      }
      return { bright, solid }
    }
    const out = { words: [], compare: null }
    for (const { name, quick, spec } of specs) {
      await w.webContents.executeJavaScript(`window.__graphic.load(${JSON.stringify(spec)})`)
      const rest = read(await grab(2800), spec.box.top - .05, spec.box.bottom + .05)
      const early = quick ? read(await grab(360), spec.box.top - .05, spec.box.bottom + .05) : null
      out.words.push({ name, rest, early })
    }
    await w.webContents.executeJavaScript(`window.__graphic.load(${JSON.stringify(compare)})`)
    const px = await grab(3300)
    // The cards' span across the frame (white, the struck one light gray), the red ✗ and green ✓ badges, the dark title words.
    let minX = 1080, maxX = 0, red = 0, green = 0, ink = 0
    for (let y = Math.floor(compare.box.top * 1920); y < Math.ceil(compare.box.bottom * 1920); y += 2) {
      for (let x = 0; x < 1080; x += 2) {
        const i = (y * 1080 + x) * 4, b = px[i], g = px[i + 1], r = px[i + 2], a = px[i + 3]
        if (a < 250) continue
        if (r > 190 && g > 200 && b > 210) { minX = Math.min(minX, x); maxX = Math.max(maxX, x) }
        if (r > 200 && g < 100 && b < 100) red++
        if (g > 150 && r < 80 && b < 150) green++
        if (r < 40 && g < 50 && b < 70) ink++
      }
    }
    out.compare = { span: (maxX - minX) / 1080, red, green, ink }
    w.destroy()
    return out
  }, { page, specs, compare })
  for (const { name, rest, early } of shots.words) {
    // On the near-solid dark glass, the words at full strength.
    // (A sample of every other pixel: 15,000 is a near-solid glass of about 60,000 px, a see-through one has none.)
    assert.ok(rest.solid >= 15000, `${name}: ${rest.solid} near-solid glass pixels`)
    assert.ok(rest.bright >= 800, `${name}: ${rest.bright} bright word pixels at rest`)
    // In within about 10 frames: by 360 ms its words are (nearly) all there at full strength.
    if (early) assert.ok(early.bright >= rest.bright * .85, `${name}: ${early.bright} of ${rest.bright} word pixels at 360 ms`)
  }
  const c = shots.compare
  assert.ok(c.span >= .85, `the cards span ${c.span} of the frame`)
  assert.ok(c.red > 300 && c.green > 300, `badges red ${c.red} green ${c.green}`)
  assert.ok(c.ink > 1500, `title ink ${c.ink}`)
})
