// Text templates on a phone (the owner's real run, Oct 24: small white cards, an empty card on the stage): each text
// template is rendered offscreen on the app's own graphics page with lines from that recording, at card and stage size,
// and checked the way an editor would look at it: the type is big enough to read on a phone (a short line at a cap
// height of about 54 px), the graphic spans most of the frame (70% as a card, 88% on the stage), the one look gives light
// ink on dark glass (or dark ink with no card on a light stage), and no card is ever on screen without its words.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const LINES = [
  ['headline_pill', { text: "how I'm using", phrase: 'AI to do exactly that' }, 3500, 6],
  ['title', { text: 'build an entire digital product' }, 2500, 5],
  ['statement', { text: 'we need a better sales page', accent: 'sales page' }, 3500, 6],
  ['quote', { text: 'I am a virtual nobody when it comes to the internet' }, 4000, 11],
  ['before_after', { before: 'a warm audience will buy anything', after: 'a cold audience needs a better sales page' }, 4000, 8],
  ['strike_list', { items: 'going viral\npeople sharing my content', final: 'the blueprint', accent: 'blueprint' }, 5000, 4],
  ['lower_third', { name: 'Travis Stephenson', role: 'Paid Creators' }, 3500, 2],
  ['sticky_notes', { items: 'a product\nan offer\neyeballs' }, 4000, 2],
  ['comment_cta', { keyword: 'BLUEPRINT', lead: 'Comment' }, 3500, 1]
]

/** In the page: the smallest font of the visible words (labels and kickers aside), and whether a card shows without words. */
const MEASURE = `(() => {
  const shown = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1'); return o }
  const fonts = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!n.data.trim() || p.closest('.mg-kicker,.mg-quote-author,.mg-sub,.mg-quote-mark,.mg-cta-lead')) continue
    fonts.push(parseFloat(getComputedStyle(p).fontSize))
  }
  const empty = [...document.querySelectorAll('.mg-card, .mg-hl-line.one')].some((card) => {
    if (shown(card) < .5 || getComputedStyle(card).visibility === 'hidden') return false
    const words = [...card.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /[\\p{L}\\p{N}]/u.test(n.data)))
    return !words.some((w) => shown(w) > .2)
  })
  const root = document.querySelector('.mg-root')
  const word = document.querySelector('.mg-w, .mg-big-w, .mg-strike-word')
  return { minFont: Math.min(...fonts), empty, classes: root ? root.className : '', ink: word ? getComputedStyle(word).color : '' }
})()`

test('text templates read on a phone: big type, wide cards, one look, never an empty card', { timeout: 300000 }, async (t) => {
  const appDir = buildApp()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-text-cards-'))
  const { app, close } = await launchApp({ appDir, userDataDir })
  t.after(close)
  const page = path.join(appDir, 'out/renderer/graphics.html')
  const results = await app.evaluate(async ({ BrowserWindow }, { page, lines, measure }) => {
    const w = new BrowserWindow({ show: false, width: 1080, height: 1920, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
      enableLargerThanScreen: true, paintWhenInitiallyHidden: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
    await w.loadFile(page)
    w.setContentSize(1080, 1920)
    const out = []
    for (const [template, fields, ms] of lines) {
      for (const size of ['card', 'stage']) {
        for (const theme of ['dark', 'light']) {
          const spec = { template, fields: { ...fields, theme }, width: 1080, height: 1920, duration_ms: ms, placement: 'middle', color: '#2F5BFF', font: 'clean',
            box: size === 'stage' ? { top: .08, bottom: .5 } : { top: .14, bottom: .44 }, ...(size === 'stage' ? { size } : {}) }
          await w.webContents.executeJavaScript(`window.__graphic.load(${JSON.stringify(spec)})`)
          const early = []
          for (const at of [30, 90, 160, 260, 400]) {
            await w.webContents.executeJavaScript(`window.__graphic.frame(${at})`)
            early.push((await w.webContents.executeJavaScript(measure)).empty)
          }
          await w.webContents.executeJavaScript(`window.__graphic.frame(${Math.round(ms * .85)})`)
          const settled = await w.webContents.executeJavaScript(measure)
          // The drawn width: the outermost columns with ink, from the captured frame
          // (after two paints, so a busy machine cannot hand back the frame before).
          await w.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          let img = await w.webContents.capturePage()
          if (img.getSize().width !== 1080) img = img.resize({ width: 1080, height: 1920 })
          const bm = img.toBitmap()
          let lo = 1080, hi = -1
          for (let y = 0; y < 1920; y += 4) for (let x = 0; x < 1080; x++) if (bm[(y * 1080 + x) * 4 + 3] > 60) { if (x < lo) lo = x; if (x > hi) hi = x }
          out.push({ template, size, theme, early, ...settled, width: (hi - lo + 1) / 1080 })
        }
      }
    }
    w.destroy()
    return out
  }, { page, lines: LINES, measure: MEASURE })

  for (const r of results) {
    const where = `${r.template} ${r.size} ${r.theme}`
    const words = LINES.find((l) => l[0] === r.template)[3]
    // Cap height about 54 px for a short line (the bold sans at 0.72 of its size), about 43 px for a longer one.
    const least = words <= 6 ? 75 : 60
    assert.ok(r.minFont >= least - 1, `${where}: type ${r.minFont}px (at least ${least})`)
    // Most of the frame: 70% as a card, 88% on the stage.
    // (A Before & after's two cards stack taller than a card band: the safe-area check draws it a little smaller so it
    // stays inside its band, never over the captions.)
    assert.ok(r.width >= (r.template === 'before_after' ? (r.size === 'stage' ? .8 : .6) : r.size === 'stage' ? .86 : .69), `${where}: ${Math.round(r.width * 100)}% wide`)
    // Never a card on screen without its words, as it comes in or once it holds.
    assert.ok(!r.early.some(Boolean) && !r.empty, `${where}: an empty card ${JSON.stringify(r.early)}`)
    // The one look: light ink on dark glass for the white-card templates in the dark theme.
    if (r.theme === 'dark' && !['sticky_notes'].includes(r.template)) assert.match(r.classes, /tone-dark/, where)
  }
  // Words with no card on a light stage take dark ink.
  const ink = await app.evaluate(async ({ BrowserWindow }, { page }) => {
    const w = new BrowserWindow({ show: false, width: 1080, height: 1920, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } })
    await w.loadFile(page)
    const spec = { template: 'big_words', fields: { text: '2 ways', theme: 'light' }, width: 1080, height: 1920, duration_ms: 2500, placement: 'middle', color: '#2F5BFF', font: 'clean', box: { top: .1, bottom: .45 } }
    await w.webContents.executeJavaScript(`window.__graphic.load(${JSON.stringify(spec)})`)
    await w.webContents.executeJavaScript('window.__graphic.frame(2000)')
    const color = await w.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.mg-big-line')).color`)
    w.destroy()
    return color
  }, { page })
  assert.equal(ink, 'rgb(15, 23, 42)')
})
