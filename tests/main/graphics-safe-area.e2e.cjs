// No clipping, ever: every effect and every text template, filled with long realistic lines (the kind a real run had:
// "Now that we know we're not gonna go viral", "I'm not having to write any of it"), drawn offscreen by the app's own
// render page at every placement (and on the stage), must paint nothing at the frame's edges and nothing outside its
// band (the hook above, the captions below), on every settled frame; and the render's last check
// (shared/graphic-safe-area.ts) must never leave one overflowing.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { loadMain } = require('../zernio/support/load-main.cjs')

const m = loadMain("export * from './src/shared/fx-catalog'; export * from './src/shared/graphic-layout'; export * from './src/shared/graphic-safe-area'")

const LINE = "Now that we know we're not gonna go viral"
const LONG = "I'm not having to write any of it, the tool writes the whole sales page"
const ITEMS = 'generate profit\nreinvest that profit\nincrease your ad spend\nthe amount of buyers'
/** Long, realistic words for an effect's fields (by key first, then by kind). */
function fxFields(effect) {
  const fields = { effect: effect.id, theme: 'dark' }
  for (const f of effect.fields) {
    if (f.kind === 'image' || f.kind === 'region') continue
    if (f.kind === 'choice') { if (f.options?.[0]?.value) fields[f.key] = f.options[0].value; continue }
    if (f.kind === 'number') { fields[f.key] = f.key === 'accent_word' ? '2' : /rating/.test(f.key) ? '4.8' : /progress|value|share/.test(f.key) && effect.group === 'numbers' ? '85' : '4,365'; continue }
    if (f.kind === 'list') { fields[f.key] = (f.sample && f.sample.includes('\n') ? f.sample : ITEMS).split('\n').slice(0, 4).map((x) => (x.length < 14 ? `${x} every week` : x).slice(0, f.max ?? 40)).join('\n'); continue }
    fields[f.key] = (f.max ?? 80) >= 40 ? (f.key === 'text' || f.key === 'line' || f.key === 'first' ? LINE : LONG).slice(0, f.max ?? 80) : (f.sample || 'Every week').slice(0, f.max ?? 20)
  }
  // Words that must come from the line: the marked word, the underlined word.
  if ('word' in fields) fields.word = 'viral'
  if ('underline' in fields && fields.second) fields.underline = fields.second.split(' ').slice(-2).join(' ')
  if (effect.group === 'numbers') Object.assign(fields, { value: fields.value && /^\d/.test(fields.value) ? fields.value : '4,365' })
  return fields
}
const TEMPLATES = [
  ['statement', { text: LONG, accent: 'sales page' }], ['quote', { text: LONG, author: 'Travis Stephenson' }], ['title', { text: LINE }],
  ['headline_pill', { text: 'Now that we know we are not', phrase: 'gonna go viral' }], ['stat', { value: '$4,365', label: 'spent on ads yesterday' }],
  ['checklist', { items: 'a really good product\na really good offer\nrun ads every single day' }], ['list', { title: 'Three things', items: ITEMS }],
  ['strike_list', { items: 'brittle selectors\nguessing endpoints', final: 'just a typed client' }], ['before_after', { before: 'A warm audience will buy anything', after: 'A cold audience needs a better sales page' }],
  ['lower_third', { name: 'Travis Stephenson', role: 'Founder, Paid Creators' }], ['link_cta', { text: 'Hit the link', lead: 'Get all the details', where: 'where you see it' }],
  ['comment_cta', { keyword: 'BUYERLOOP', text: 'Comment the word and I will send it' }], ['sticky_notes', { items: 'Turn websites\ninto APIs\nin one afternoon' }]
]

test('every effect and text template, with long lines, paints inside its band and never at the frame edges', { timeout: 1200000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-safe-area-'))
  const appDir = buildApp(path.join(root, 'app'))
  const session = await launchApp({ appDir, userDataDir: path.join(root, 'user-data') })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  // A 9:16 frame with a floating hook (as a saved look sets it) and captions at their usual line.
  const frame = { aspect: '9:16', hook: 0.21, captions: { y: 1340 / 1920, bottom: false }, handle: null }
  const specs = []
  for (const effect of m.FX_EFFECTS) {
    if (effect.group === 'media' || effect.frame === 'full' || effect.media?.length) continue
    const sizes = effect.size === 'stage' ? [['stage', 'top']] : [['card', 'top'], ['card', 'middle'], ['card', 'bottom']]
    for (const [size, placement] of sizes) {
      specs.push({ name: `${effect.id}/${placement}`, spec: { template: 'fx', fields: fxFields(effect), width: 1080, height: 1920, duration_ms: Math.max(2500, effect.default_ms),
        box: m.graphicBox(placement, frame, size), placement, color: '#2F5BFF', font: 'clean', accent_font: 'serif', ...(size !== 'card' ? { size } : {}) } })
    }
  }
  for (const [template, fields] of TEMPLATES) {
    for (const placement of ['top', 'middle', 'bottom']) {
      specs.push({ name: `${template}/${placement}`, spec: { template, fields: { ...fields, theme: 'dark' }, width: 1080, height: 1920, duration_ms: 4000,
        box: m.graphicBox(placement, frame, 'card'), placement, color: '#2F5BFF', font: 'clean', accent_font: 'serif' } })
    }
  }
  const page = path.join(appDir, 'out', 'renderer', 'graphics.html')
  const results = await session.app.evaluate(async ({ BrowserWindow }, { page, specs, slack, settled }) => {
    // As the app's own offscreen render opens it (graphics-render.ts offscreenWindowOptions): transparent, then sized to the frame.
    const w = new BrowserWindow({ show: false, width: 1080, height: 1920, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
      enableLargerThanScreen: true, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false, webgl: false, partition: 'graphics-safe-area-test' } })
    w.setContentSize(1080, 1920)
    w.webContents.setFrameRate(60)
    await w.loadFile(page)
    const probe = await w.webContents.capturePage()
    const corner = probe.toBitmap()[3]
    if (corner !== 0) throw new Error(`The offscreen page is not transparent (corner alpha ${corner}, ${JSON.stringify(probe.getSize())})`)
    const out = []
    for (const { name, spec } of specs) {
      await w.webContents.executeJavaScript(`window.__graphic.load(${JSON.stringify(spec)})`)
      const safe = await w.webContents.executeJavaScript(`document.querySelector('.mg-safe')?.dataset.safe ?? 'exempt'`)
      const problems = []
      for (const k of settled) {
        const ms = Math.round(Math.min(spec.duration_ms - 380, spec.duration_ms * k))
        await w.webContents.executeJavaScript(`window.__graphic.frame(${ms})`)
        let img = await w.webContents.capturePage()
        if (img.getSize().width !== 1080) img = img.resize({ width: 1080, height: 1920 })
        const px = img.toBitmap(), W = 1080, H = 1920
        const a = (x, y) => px[(y * W + x) * 4 + 3]
        let edge = 0, outside = 0
        const top = Math.floor((spec.box.top - slack) * H), bottom = Math.ceil((spec.box.bottom + slack) * H)
        for (let y = 0; y < H; y += 2) {
          for (let x = 0; x < W; x += 2) {
            if (a(x, y) <= 24) continue
            if (x < 4 || x >= W - 4 || y < 4 || y >= H - 4) edge++
            if (y < top || y > bottom) outside++
          }
        }
        if (edge) problems.push(`ink at the frame edge at ${ms} ms (${edge} px)`)
        if (outside > 40) problems.push(`ink outside its band at ${ms} ms (${outside} px)`)
      }
      out.push({ name, safe, problems })
    }
    w.destroy()
    return out
  }, { page, specs, slack: m.BAND_SLACK + 0.01, settled: [0.5, 0.7, 0.85] })
  const bad = results.filter((r) => r.problems.length || r.safe === 'overflow')
  assert.ok(results.length >= 100, `rendered ${results.length}`)
  assert.deepEqual(bad.map((r) => `${r.name}: ${r.safe} ${r.problems.join('; ')}`), [])
})
