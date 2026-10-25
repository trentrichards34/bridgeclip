// Word marks and line swaps as drawn in the app: a marker's highlight, underline, circle or scribble sits on its word
// (measured once fonts are in and the unit is fitted) whatever the brand's accent face and the line's size, the marked
// word keeps a normal word space either side, and a line swap never shows the outgoing line cut by its mask or both
// lines at once.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { editorTools, linkEngine } = require('./editor-e2e-tools.cjs')
const fixture = require('../fixtures/editor/project.json')

const GRAPHICS = [
  // A short line (big type) and a long one (small type), each mark style, and the annotate unit.
  { id: 'g-mark-hi', template: 'fx', at_ms: 1000, duration_ms: 3500, placement: 'top', fields: { effect: 'marker-highlight', text: 'We spend money on ads', word: 'ads', style: 'highlight' }, origin: 'member' },
  { id: 'g-mark-ul', template: 'fx', at_ms: 1000, duration_ms: 3500, placement: 'bottom', fields: { effect: 'vox-annotate', text: 'Start with a cold audience', word: 'cold', note: 'people who never met you', style: 'underline' }, origin: 'member' },
  { id: 'g-mark-ci', template: 'fx', at_ms: 7100, duration_ms: 2800, placement: 'top', fields: { effect: 'marker-highlight', text: "I'm not having to write any of it because the platform built it", word: 'having', style: 'circle' }, origin: 'member' },
  { id: 'g-mark-sc', template: 'fx', at_ms: 7100, duration_ms: 2800, placement: 'middle', fields: { effect: 'marker-highlight', text: 'Most people quit too early', word: 'quit', style: 'scribble' }, origin: 'member' },
  { id: 'g-swap', template: 'fx', at_ms: 7100, duration_ms: 2800, placement: 'bottom', fields: { effect: 'line-swap', first: 'A warm audience will buy anything', second: 'A cold audience needs a better page', underline: 'better' }, origin: 'member' }
]
// The brand faces a marked word may be set in (the hook's font: graphic-layout.ts graphicFonts).
const FONTS = ['serif', 'condensed', 'marker', 'sans_serif_accent']

/** In the page: each visible marked word, its mark's drawn box and the word spaces around it (em of the line's font). */
const MARKS = () => {
  const ctx = document.createElement('canvas').getContext('2d')
  const words = (node) => [...node.data.matchAll(/\S+/g)].map((m) => { const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length); return r.getBoundingClientRect() })
  const out = []
  for (const stage of document.querySelectorAll('.editor-graphics-overlay .fx-stage')) {
    if (!stage.shadowRoot || getComputedStyle(stage).visibility !== 'visible') continue
    for (const host of stage.shadowRoot.querySelectorAll('.mh-em, .va-em')) {
      const word = host.querySelector('.mh-em-text, .va-em-text')
      const mark = host.querySelector('.mh-mark path, .va-mark path')
      const r = document.createRange(); r.selectNodeContents(word)
      const ink = r.getBoundingClientRect()
      const probe = document.createElement('span'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
      word.appendChild(probe); const base = probe.getBoundingClientRect().bottom; probe.remove()
      const wcs = getComputedStyle(word)
      ctx.font = `${wcs.fontStyle} ${wcs.fontWeight} ${wcs.fontSize} ${wcs.fontFamily}`
      const k = stage.getBoundingClientRect().width / stage.offsetWidth
      const cap = ctx.measureText('H').actualBoundingBoxAscent * k
      const em = parseFloat(getComputedStyle(host.parentElement).fontSize) * k
      const before = host.previousSibling?.nodeType === 3 ? words(host.previousSibling).at(-1) : null
      const after = host.nextSibling?.nodeType === 3 ? words(host.nextSibling)[0] : null
      // The other word spaces of the line, for comparison.
      const others = []
      for (const node of host.parentElement.childNodes) {
        if (node.nodeType !== 3) continue
        const boxes = words(node)
        for (let i = 1; i < boxes.length; i++) if (Math.abs(boxes[i].top - boxes[i - 1].top) < 2) others.push((boxes[i].left - boxes[i - 1].right) / em)
      }
      // The stroke as painted: its path, plus half its width (stretched with its box) each side.
      const g = mark.getBoundingClientRect(), svg = mark.ownerSVGElement.getBoundingClientRect()
      const half = parseFloat(mark.getAttribute('stroke-width')) / 2
      const vb = mark.ownerSVGElement.viewBox.baseVal
      const p = { left: g.left - half * svg.width / vb.width, right: g.right + half * svg.width / vb.width, top: g.top - half * svg.height / vb.height, bottom: g.bottom + half * svg.height / vb.height }
      out.push({ style: host.dataset.markerStyle, face: wcs.fontFamily, word: word.textContent, em, cap, base,
        ink: { left: ink.left, right: ink.right }, mark: { left: p.left, right: p.right, top: p.top, bottom: p.bottom },
        gapBefore: before && Math.abs(before.top - ink.top) < em ? (ink.left - before.right) / em : null,
        gapAfter: after && Math.abs(after.top - ink.top) < em ? (after.left - ink.right) / em : null, others })
    }
  }
  return out
}

/** In the page: the line swap's two lines now: opacity, where its words are (px) and its font size as drawn. */
const SWAP = () => {
  for (const stage of document.querySelectorAll('.editor-graphics-overlay .fx-stage')) {
    const mask = stage.shadowRoot?.querySelector('.ls-mask')
    if (!mask || getComputedStyle(stage).visibility !== 'visible') continue
    const k = stage.getBoundingClientRect().width / stage.offsetWidth
    return [...mask.querySelectorAll('.ls-line')].map((line) => {
      const r = document.createRange(); r.selectNodeContents(line.querySelector('.ls-line-inner'))
      const box = r.getBoundingClientRect()
      return { opacity: parseFloat(getComputedStyle(line).opacity), top: box.top, bottom: box.bottom, em: parseFloat(getComputedStyle(line).fontSize) * k }
    })
  }
  return null
}

function checkMark(m, label) {
  const w = m.ink.right - m.ink.left
  const mid = (m.mark.left + m.mark.right) / 2
  assert.ok(Math.abs(mid - (m.ink.left + m.ink.right) / 2) <= 0.08 * w + 1, `${label}: mark centered on “${m.word}” (${JSON.stringify(m)})`)
  const width = m.mark.right - m.mark.left
  assert.ok(width >= 0.95 * w && width <= (m.style === 'circle' ? 1.4 : 1.15) * w, `${label}: mark as wide as “${m.word}” (${width.toFixed(1)} vs ${w.toFixed(1)})`)
  const cy = (m.mark.top + m.mark.bottom) / 2
  const at = ((m.base - cy) / m.cap).toFixed(2)
  if (m.style === 'highlight' || m.style === 'scribble') {
    // The ink band runs through the letters' middle (the lower caps, the x-height), not above them or under the line.
    assert.ok(cy >= m.base - 0.55 * m.cap && cy <= m.base - 0.18 * m.cap, `${label}: ${m.style} through the letters of “${m.word}” (center ${at} caps above the baseline)`)
  } else if (m.style === 'underline') {
    assert.ok(cy >= m.base + 0.05 * m.cap && cy <= m.base + 0.6 * m.cap, `${label}: underline just under “${m.word}” (center ${at} caps above the baseline)`)
  } else if (m.style === 'circle') {
    assert.ok(m.mark.top <= m.base - m.cap && m.mark.bottom >= m.base && m.mark.left <= m.ink.left + 0.03 * w && m.mark.right >= m.ink.right - 0.03 * w,
      `${label}: circle around “${m.word}” (${JSON.stringify(m)})`)
  }
  // A normal word space either side (a circle a little more for its ring), never a double gap.
  const usual = [...m.others].sort((a, b) => a - b)[Math.floor(m.others.length / 2)] ?? 0.3
  const most = usual * (m.style === 'circle' ? 1.6 : 1.3)
  for (const [side, gap] of [['before', m.gapBefore], ['after', m.gapAfter]]) {
    if (gap === null) continue
    assert.ok(gap >= 0.12 && gap <= most, `${label}: word space ${side} “${m.word}” is ${gap.toFixed(3)} em (the line's usual ${usual.toFixed(3)})`)
  }
}

test('word marks sit on their word in every accent face and size; a line swap is clean', { timeout: 300000 }, async (t) => {
  const tools = editorTools(t, { python: true })
  if (!tools) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-fx-marks-'))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips'), run = path.join(library, 'marks-run')
  fs.mkdirSync(run, { recursive: true })
  execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(run, 'editor-source.mp4')])
  fs.copyFileSync(path.join(run, 'editor-source.mp4'), path.join(run, 'editor-preview.mp4'))
  const project = structuredClone(fixture); project.width = 360; project.height = 640; project.aspect_ratio = '9:16'
  const base = project.candidates[0]
  project.candidates = FONTS.map((font, i) => ({ ...structuredClone(base), id: `candidate-font-${i}`, title: `Face ${font}`, review: undefined, captions: false,
    hook: { text: 'Marks on words', look: { look: 'floating', color: '#FFFFFF', font, textBg: 'dark' } }, graphics: GRAPHICS }))
  fs.writeFileSync(path.join(run, 'editor-project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: project.transcript.map((s) => ({ start_time_ms: s.start_ms, end_time_ms: s.end_ms, text: s.text, words: [] })) }))
  fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ job_id: 'marks-run', source_video_title: 'Marks run', source_video_duration_seconds: 12, clips: [], total_clips: 0, editor_project: true }))
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: tools.python, openrouterApiKey: '', zernioApiKey: '' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: tools.appEnv })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000))
  await page.getByRole('button', { name: 'Library', exact: true }).first().click()
  await page.getByRole('button', { name: 'Open Marks run', exact: true }).click()
  await page.getByRole('region', { name: 'Clip editor' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.editor-source-frame video')?.readyState >= 2)
  const seek = async (ms) => { await page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(ms)); await page.waitForTimeout(250) }
  const settled = async (count) => page.waitForFunction((n) => [...document.querySelectorAll('.editor-graphics-overlay .fx-stage')]
    .filter((s) => getComputedStyle(s).visibility === 'visible' && s.shadowRoot?.querySelector('.mh-em, .va-em')).length >= n, count)

  const faces = new Set()
  for (const font of FONTS) {
    await page.locator('.editor-candidate').filter({ hasText: `Face ${font}` }).click()
    await seek(3900); await settled(2)
    const early = await page.evaluate(MARKS)
    await seek(9400); await settled(2)
    const late = await page.evaluate(MARKS)
    const all = [...early, ...late]
    assert.deepEqual(all.map((m) => m.style).sort(), ['circle', 'highlight', 'scribble', 'underline'], `${font}: ${JSON.stringify(all.map((m) => m.style))}`)
    for (const m of all) { checkMark(m, `${font} ${m.style}`); faces.add(m.face) }
  }
  // The marked words were set in several faces (the brand's accent face each time).
  assert.ok(faces.size >= 3, [...faces].join(' | '))

  // The swap: never both lines at once, never a visible line cut off by its mask.
  await page.locator('.editor-candidate').filter({ hasText: 'Face serif' }).click()
  const samples = []
  for (let ms = 7100; ms <= 9800; ms += 45) {
    await page.getByRole('slider', { name: 'Fine timeline position' }).fill(String(ms))
    await page.waitForTimeout(30)
    const lines = await page.evaluate(SWAP)
    if (lines) samples.push({ ms, lines })
  }
  // Where each line rests (fully shown): while it shows (over a quarter opacity) it is never far from there, so it never
  // runs out past the words' backing; and never both at once.
  const rest = [0, 1].map((i) => samples.map((s) => s.lines[i]).find((l) => l.opacity > 0.99))
  assert.ok(rest[0] && rest[1], 'both lines were shown in turn')
  for (const { ms, lines } of samples) {
    assert.ok(!(lines[0].opacity > 0.05 && lines[1].opacity > 0.05), `${ms} ms: both lines show (${lines[0].opacity}, ${lines[1].opacity})`)
    lines.forEach((l, i) => {
      if (l.opacity > 0.25) assert.ok(Math.abs(l.top - rest[i].top) <= 0.3 * l.em, `${ms} ms: line ${i + 1} at ${l.opacity.toFixed(2)} opacity is ${((l.top - rest[i].top) / l.em).toFixed(2)} em off its place`)
    })
  }
  assert.deepEqual(errors, [])
})
