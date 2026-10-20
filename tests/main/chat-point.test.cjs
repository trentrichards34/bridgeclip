// "Point at the preview": pins checked from the page, output time ↔ source time through the cuts and speed,
// output-frame points → source-frame points through the layout, the tools that take a pin (clip editor, Edit my
// recording, Remix), and one mocked OpenRouter turn where "put an arrow here" becomes an arrow at the pin.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const shared = loadMain(`export * from './src/shared/chat-point'
export { applyChatTool, sourcePointAt, zoomCropAt, pinSourceMs, CHAT_TOOLS } from './src/shared/clip-chat'
export { parseCandidateEdit } from './src/shared/clip-editor'
export { sourceTimeAt, nearestOutputTime, outputTime } from './src/shared/motion-graphics'
export { applyRemixChatTool } from './src/shared/remix-chat'`)
const plain = (x) => JSON.parse(JSON.stringify(x))
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-3, `${label}: ${actual} is not ${expected}`)
const project = { duration_ms: 12000, width: 1920, height: 1080, aspect_ratio: '9:16', transcriptCount: 4 }
let ids = 0
const newId = () => `chat-pt${String(++ids).padStart(4, '0')}`
const clip = () => plain(shared.parseCandidateEdit(structuredClone(fixture.candidates[0]), 12000, 4))
const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message), `expected ${pattern}`)

test('pins from the page are checked: up to 3, numbered once, inside the frame', () => {
  assert.deepEqual(plain(shared.parseChatPoints(undefined)), [])
  assert.deepEqual(plain(shared.parseChatPoints([{ n: 2, x: 0.81234, y: 0.1, w: 0.1, h: 0.2, out_ms: 1600.4 }, { n: 1, x: 0.3, y: 0.25, out_ms: null }])), [
    { n: 1, x: 0.3, y: 0.25, out_ms: null },
    { n: 2, x: 0.812, y: 0.1, w: 0.1, h: 0.2, out_ms: 1600 }
  ])
  assert.throws(() => shared.parseChatPoints([1, 2, 3, 4]), /up to 3/)
  assert.throws(() => shared.parseChatPoints('pin'), /up to 3/)
  assert.throws(() => shared.parseChatPoints([{ n: 1, x: 0.1, y: 0.1, out_ms: 0 }, { n: 1, x: 0.2, y: 0.2, out_ms: 0 }]), /malformed/)
  assert.throws(() => shared.parseChatPoints([{ n: 4, x: 0.1, y: 0.1, out_ms: 0 }]), /malformed/)
  assert.throws(() => shared.parseChatPoints([{ n: 1, x: 1.2, y: 0.1, out_ms: 0 }]), /outside the video/)
  assert.throws(() => shared.parseChatPoints([{ n: 1, x: 0.9, y: 0.1, w: 0.3, h: 0.1, out_ms: 0 }]), /box/)
  assert.throws(() => shared.parseChatPoints([{ n: 1, x: 0.5, y: 0.5, out_ms: -5 }]), /invalid time/)
  assert.throws(() => shared.parseChatPoints([{ n: 1, x: 0.5, y: 0.5, out_ms: '0:12' }]), /invalid time/)
  // The chip's words.
  assert.equal(shared.pointLabel({ n: 1, x: 0.1, y: 0.2, out_ms: 12000 }), 'at 0:12.0, top-left')
  assert.equal(shared.pointLabel({ n: 1, x: 0.5, y: 0.5, out_ms: null }), 'center')
  assert.equal(shared.pointLabel({ n: 1, x: 0.4, y: 0.7, w: 0.2, h: 0.2, out_ms: 0 }), 'at 0:00.0, box, bottom')
  assert.equal(shared.pointLabel({ n: 1, x: 0.9, y: 0.5, out_ms: null }), 'right')
  assert.deepEqual(['top', 'middle', 'bottom'].map((_, i) => shared.placementNear([0.2, 0.5, 0.8][i])), ['top', 'middle', 'bottom'])
})

test('output time ↔ source time follows the cuts and the export speed', () => {
  const c = clip() // [[1000, 5000], [7000, 10000]] at 1.25×
  assert.equal(shared.sourceTimeAt(c, 0), 1000)
  assert.equal(shared.sourceTimeAt(c, 1600), 3000)
  assert.equal(shared.sourceTimeAt(c, 3200), 7000, 'the join lands at the start of the next section')
  assert.equal(shared.sourceTimeAt(c, 5600), 9999, 'the very end stays inside the clip')
  assert.equal(shared.sourceTimeAt(c, 6000), null)
  assert.equal(shared.sourceTimeAt(c, -1), null)
  for (const t of [1000, 2500, 4999, 7000, 8123, 9999]) assert.equal(shared.sourceTimeAt(c, shared.outputTime(c, t)), t, `round trip at ${t}`)
  assert.equal(shared.nearestOutputTime(c, 3000), 1600)
  assert.equal(shared.nearestOutputTime(c, 500), 0, 'before the clip: its start')
  assert.equal(shared.nearestOutputTime(c, 6000), 3200, 'in a cut-out gap: the join')
  assert.equal(shared.nearestOutputTime(c, 11500), 5600, 'after the clip: its end')
  assert.equal(shared.pinSourceMs(c, { out_ms: 1600 }), 3000)
  assert.equal(shared.pinSourceMs(c, { out_ms: null }), null)
})

test('an output-frame point maps to the source through Full frame, Split and Fit', () => {
  const c = clip()
  // Full frame: crop [0.1, 0, 0.3164, 1] at 3 s.
  let p = shared.sourcePointAt(c, project, 0.5, 0.5, 3000)
  near(p.x, 0.1 + 0.31640625 / 2, 'fill x'); near(p.y, 0.5, 'fill y')
  p = shared.sourcePointAt(c, project, 0, 1, 3000)
  near(p.x, 0.1, 'fill left edge'); near(p.y, 1, 'fill bottom edge')
  // Split from 8 s: the lower panel's crop, trimmed to its panel's shape.
  p = shared.sourcePointAt(c, project, 0.5, 0.75, 9000)
  near(p.x, 0.7, 'split x'); near(p.y, 0.3 + 0.35555556 / 2, 'split y')
  // Fit: the whole frame in the middle; the blurred background above it is no point on the video.
  const fit = { ...c, scenes: [{ at_ms: 0, layout: 'fit', crops: [[0, 0, 1, 1]] }] }
  p = shared.sourcePointAt(fit, project, 0.5, 0.5, 3000)
  near(p.x, 0.5, 'fit x'); near(p.y, 0.5, 'fit y')
  assert.equal(shared.sourcePointAt(fit, project, 0.5, 0.1, 3000), null)
  // A hook bar on top: the video fills the rest.
  const hooked = { ...c, hook: { text: 'He did not see that coming', look: { look: 'white', font: 'clean', color: '#FFFFFF' } } }
  // (the crop is trimmed to the shorter area around its center: 18.1% bar → 81.9% of the crop's height shows)
  p = shared.sourcePointAt(hooked, project, 0.5, 0.05, 3000)
  near(p.y, 0.0905, 'a point on the bar is the top of the video shown')
  p = shared.sourcePointAt(hooked, project, 0.5, 1, 3000)
  near(p.y, 0.9095, 'the bottom of the frame')
})

test('the clip editor tools take a pin: an arrow or circle at it, a graphic moved near it, a zoom centered on it', () => {
  const c = clip()
  const pins = shared.parseChatPoints([{ n: 1, x: 0.3, y: 0.25, out_ms: 1600 }, { n: 2, x: 0.6, y: 0.7, w: 0.2, h: 0.15, out_ms: 3200 }])
  // "Put an arrow here": a highlight at the pin, starting just before the moment pointed at.
  let r = shared.applyChatTool(c, 'add_graphic', { template: 'highlight', pin: 1, fields: { shape: 'arrow' } }, project, newId, pins)
  let g = r.candidate.graphics[0]
  assert.deepEqual(plain([g.template, g.at_ms, g.placement, g.origin, g.fields]), ['highlight', 2600, 'middle', 'chat', { shape: 'arrow', x: '0.3', y: '0.25' }])
  assert.equal(r.step.summary, 'Added an arrow at pin 1 at 0:02.6.')
  // A box pin with no shape given gets a circle around its center.
  r = shared.applyChatTool(c, 'add_graphic', { template: 'highlight', pin: 2 }, project, newId, pins)
  g = r.candidate.graphics[0]
  assert.deepEqual(plain([g.at_ms, g.fields]), [7000, { shape: 'circle', x: '0.7', y: '0.775' }])
  // Another template sits in the band nearest the pin; "move the graphic here" moves it.
  r = shared.applyChatTool(c, 'add_graphic', { template: 'title', pin: 1, fields: { text: 'Look here' } }, project, newId, pins)
  const title = r.candidate.graphics[0]
  assert.equal(title.placement, 'top')
  r = shared.applyChatTool(r.candidate, 'update_graphic', { id: title.id, pin: 2 }, project, newId, pins)
  assert.equal(r.candidate.graphics[0].placement, 'bottom')
  assert.equal(r.step.summary, 'Moved the title slam at 0:02.6 to the bottom.')
  // A placement the model gives wins.
  r = shared.applyChatTool(c, 'add_graphic', { template: 'title', pin: 1, placement: 'middle', fields: { text: 'Look here' } }, project, newId, pins)
  assert.equal(r.candidate.graphics[0].placement, 'middle')
  // "Zoom in on this": a Full frame crop centered on the pin from its time to the end.
  r = shared.applyChatTool(c, 'set_layout_at', { pin: 1 }, project, newId, pins)
  const zoom = r.candidate.scenes.find((s) => s.at_ms === 3000)
  assert.ok(zoom, 'a layout change at the pin’s source time')
  assert.equal(zoom.layout, 'fill')
  const [x, y, w, h] = zoom.crops[0]
  near(w, 0.31640625 / 1.6, 'zoomed width'); near(h, 1 / 1.6, 'zoomed height')
  near(x + w / 2, 0.1 + 0.3 * 0.31640625, 'centered across'); near(y, 0, 'as close to centered down as the frame allows')
  assert.equal(r.step.summary, 'Zoomed in 1.6× on pin 1 from 0:03.0 to the end.')
  r = shared.applyChatTool(c, 'set_layout_at', { pin: 1, zoom: 2, until_ms: 4000 }, project, newId, pins)
  near(r.candidate.scenes.find((s) => s.at_ms === 3000).crops[0][2], 0.31640625 / 2, 'zoom 2')
  assert.ok(r.candidate.scenes.some((s) => s.at_ms === 4000), 'zooms back out at until_ms')
  // A box pin: zoomed so the box fills the frame (limited to 4×).
  const box = shared.zoomCropAt(c, project, { n: 1, x: 0.25, y: 0.25, w: 0.5, h: 0.5, out_ms: 1600 }, 3000)
  assert.equal(box.zoom, 2)
})

test('pins are checked like any tool input', () => {
  const c = clip()
  const pins = shared.parseChatPoints([{ n: 1, x: 0.3, y: 0.25, out_ms: 1600 }])
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'highlight', pin: 2 }, project, newId, pins), /no pin 2.*pin 1/)
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'highlight', pin: 1 }, project, newId, []), /no pins.*Point button/)
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'highlight', pin: 'here' }, project, newId, pins), /pin must be the pin number/)
  toolError(() => shared.applyChatTool(c, 'set_layout_at', { pin: 1, layout: 'split' }, project, newId, pins), /fill layout/)
  toolError(() => shared.applyChatTool(c, 'set_layout_at', { pin: 1, zoom: 9 }, project, newId, pins), /zoom must be between 1 and 4/)
  toolError(() => shared.applyChatTool(c, 'set_layout_at', { at_ms: 2000, layout: 'fill', zoom: 2 }, project, newId, pins), /zoom goes with a pin/)
  const fit = { ...c, scenes: [{ at_ms: 0, layout: 'fit', crops: [[0, 0, 1, 1]] }] }
  toolError(() => shared.applyChatTool(fit, 'set_layout_at', { pin: 1 }, project, newId, [{ n: 1, x: 0.5, y: 0.05, out_ms: 1600 }]), /blurred background/)
  // A pin with no time needs at_ms; without a pin, a highlight's own x/y are checked.
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'highlight', pin: 1 }, project, newId, [{ n: 1, x: 0.5, y: 0.5, out_ms: null }]), /at_ms must be a number/)
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'highlight', at_ms: 2000, fields: { shape: 'arrow', x: 'left' } }, project, newId), /fields\.x must be a number from 0 to 1/)
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'highlight', at_ms: 2000, fields: { shape: 'star' } }, project, newId), /shape must be arrow or circle/)
  const ok = shared.applyChatTool(c, 'add_graphic', { template: 'highlight', at_ms: 2000, fields: { shape: 'circle', x: '0.25', y: '0.8' } }, project, newId)
  assert.deepEqual(plain(ok.candidate.graphics[0].fields), { shape: 'circle', x: '0.25', y: '0.8' })
  // The tools tell the model about pins.
  for (const name of ['add_graphic', 'update_graphic', 'set_layout_at']) assert.ok(shared.CHAT_TOOLS.find((t) => t.name === name).parameters.properties.pin, `${name} takes a pin`)
})

test('Remix: "put their clip box here" picks the half the pin is in; graphics aim at a pin', () => {
  const state = { draftId: 0, headline: 'He says scam ads run every day', postCaption: 'Credit: @skincoach', graphics: [] }
  const react = { format: 'react_thoughts', theirClip: null, takeMs: 9000, takeTrim: null, trimmable: false, boxAt: 'auto', banner: false, keyword: 'SKIN' }
  const pins = shared.parseChatPoints([{ n: 1, x: 0.5, y: 0.8, out_ms: null }, { n: 2, x: 0.2, y: 0.1, out_ms: null }])
  let r = shared.applyRemixChatTool(state, react, 'set_box_position', { pin: 1 }, undefined, pins)
  assert.deepEqual(plain(r.step.action), { kind: 'layout', patch: { boxAt: 'bottom' } })
  r = shared.applyRemixChatTool(state, react, 'set_box_position', { pin: 2 }, undefined, pins)
  assert.deepEqual(plain(r.step.action), { kind: 'layout', patch: { boxAt: 'top' } })
  toolError(() => shared.applyRemixChatTool(state, react, 'set_box_position', { pin: 3 }, undefined, pins), /no pin 3/)
  const take = { format: 'clip_then_me', theirClip: null, takeMs: 9000, takeTrim: null, trimmable: true, boxAt: null, banner: null, keyword: '' }
  r = shared.applyRemixChatTool(state, take, 'add_graphic', { template: 'highlight', at_ms: 3000, pin: 2, fields: { shape: 'arrow' } }, () => 'g-pin000001', pins)
  assert.deepEqual(plain(r.state.graphics[0].fields), { shape: 'arrow', x: '0.2', y: '0.1' })
})

/** A fake OpenRouter: each request answers with the next scripted SSE reply. */
function fakeOpenRouter(replies) {
  const requests = []
  const fetch = async (url, init) => {
    requests.push(JSON.parse(init.body))
    const next = replies.shift()
    const chunks = []
    if (next.text) chunks.push({ choices: [{ delta: { content: next.text } }] })
    ;(next.calls ?? []).forEach((call, index) => chunks.push({ choices: [{ delta: { tool_calls: [{ index, id: `call_${index}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }))
    chunks.push({ choices: [], usage: { cost: 0.001 } })
    return new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  return { fetch, requests }
}

test('one turn (mocked OpenRouter): a pin and "put an arrow here" become an arrow at the pin’s coordinates', async () => {
  const { dir, cleanup } = tempDir('bridgeclip-point-chat-')
  try {
    const { electron } = fakeElectron(dir)
    const chat = loadMain("export * from './src/main/clip-chat'", { electron })
    const openrouter = fakeOpenRouter([
      { calls: [{ name: 'add_graphic', args: { template: 'highlight', pin: 1, fields: { shape: 'arrow' }, reason: 'where you pointed' } }] },
      { text: 'Done. An arrow points at that spot.' }
    ])
    const points = shared.parseChatPoints([{ n: 1, x: 0.3, y: 0.25, out_ms: 1600 }])
    const result = await chat.runClipChat({
      apiKey: 'sk-or-test', model: 'google/gemini-3.8-flash', project: { ...project, title: fixture.title, transcript: fixture.transcript },
      candidate: clip(), message: 'put an arrow here', history: [], segments: null, loud: [], signal: new AbortController().signal,
      fetch: openrouter.fetch, url: 'http://fake/chat/completions', newId, points
    })
    assert.equal(result.error, undefined)
    assert.equal(result.reply, 'Done. An arrow points at that spot.')
    const g = result.steps[0].patch.graphics[0]
    assert.deepEqual(plain([g.template, g.at_ms, g.fields]), ['highlight', 2600, { shape: 'arrow', x: '0.3', y: '0.25' }])
    assert.equal(result.steps[0].summary, 'Added an arrow at pin 1 at 0:02.6 (where you pointed).')
    // The model got the pin with the member's words, its source time, and tools that take a pin.
    const asked = openrouter.requests[0].messages.at(-1).content
    assert.match(asked, /^put an arrow here\n\n\[The member pointed at the video/)
    assert.match(asked, /pin 1: a point at x=0\.3, y=0\.25 \(top-left of the frame\), at 0:01\.6 of the finished video \(source 3000 ms\)/)
    assert.match(openrouter.requests[0].messages[0].content, /Blurring or hiding part of the video isn't supported/)
    assert.ok(openrouter.requests[0].tools.find((t) => t.function.name === 'add_graphic').function.parameters.properties.pin)
    // editorChat checks the page's pins.
    const deps = { session: { run: dir, project: structuredClone(fixture), sourcePath: '', previewPath: '' }, apiKey: 'sk-or-test', model: 'm', ffmpeg: 'ffmpeg', url: 'http://fake/chat/completions' }
    await assert.rejects(chat.editorChat(fixture.candidates[0], 'arrow here', deps, [{ n: 1, x: 2, y: 0, out_ms: 0 }]), /outside the video/)
    await assert.rejects(chat.editorChat(fixture.candidates[0], 'arrow here', deps, [{}, {}, {}, {}]), /up to 3/)
  } finally { cleanup() }
})
