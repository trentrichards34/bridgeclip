// Remix's Chat panel: the tools' checks (hook text, their part, the take's trim, the box and banner, graphics on the
// member's part), the steps the review applies (with undo), and one OpenRouter turn (mocked).
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')

const shared = loadMain("export * from './src/shared/remix-chat'")
const main = loadMain("export * from './src/main/remix-chat'")
const plain = (x) => JSON.parse(JSON.stringify(x))
let ids = 0
const newId = () => `g-test${String(++ids).padStart(5, '0')}`
const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message), `expected ${pattern}`)

const state = () => ({ draftId: 0, headline: 'He says scam ads run every day', postCaption: 'Credit: @skincoach', graphics: [] })
const clipFacts = (patch = {}) => ({
  format: 'clip_then_me', theirClip: { startMs: 1000, endMs: 7000, minMs: 1000, maxMs: 180000, limitStartMs: 0, limitEndMs: 10000 },
  takeMs: 9000, takeTrim: null, trimmable: true, boxAt: null, banner: null, keyword: 'SKIN', ...patch
})

test('hook text, caption and their part', () => {
  let r = shared.applyRemixChatTool(state(), clipFacts(), 'set_hook_text', { text: 'This serum did nothing for me' })
  assert.deepEqual(plain(r.step.patch), { headline: 'This serum did nothing for me' })
  toolError(() => shared.applyRemixChatTool(state(), clipFacts(), 'set_hook_text', { text: 'Too short' }), /3 to 16 words/)
  r = shared.applyRemixChatTool(state(), clipFacts(), 'set_post_caption', { text: 'New caption\nCredit: @skincoach' })
  assert.equal(r.state.postCaption, 'New caption\nCredit: @skincoach')
  r = shared.applyRemixChatTool(state(), clipFacts(), 'set_their_clip', { start_ms: 2000, end_ms: 5000, reason: 'to shorten their clip' })
  assert.deepEqual(plain(r.step.action), { kind: 'their_clip', startMs: 2000, endMs: 5000 })
  assert.deepEqual(plain(r.step.undo), { kind: 'their_clip', startMs: 1000, endMs: 7000 })
  assert.equal(r.step.summary, 'Their part set to 0:02.0–0:05.0 of their video (3.0s) to shorten their clip.')
  assert.deepEqual([r.facts.theirClip.startMs, r.facts.theirClip.endMs], [2000, 5000], 'later calls see the new part')
  toolError(() => shared.applyRemixChatTool(state(), clipFacts(), 'set_their_clip', { start_ms: 2000, end_ms: 2500 }), /at least 1\.0 seconds/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts(), 'set_their_clip', { start_ms: 2000, end_ms: 12000 }), /between 0 and 10000/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts({ theirClip: null, theirClipNote: 'record part 1 again.' }), 'set_their_clip', { start_ms: 0, end_ms: 3000 }), /record part 1 again/)
})

test('the take: trim it (or use all of it again), never in Pause & react or React then my thoughts', () => {
  let r = shared.applyRemixChatTool(state(), clipFacts(), 'trim_my_take', { start_ms: 1800, end_ms: 9000, reason: 'to cut your first sentence' })
  assert.deepEqual(plain(r.step.action), { kind: 'take_trim', startMs: 1800, endMs: 9000 })
  assert.deepEqual(plain(r.step.undo), { kind: 'take_trim', startMs: null, endMs: null })
  assert.equal(r.step.summary, 'Your take now runs 0:01.8–0:09.0 (7.2s of 9.0s) to cut your first sentence.')
  r = shared.applyRemixChatTool(state(), r.facts, 'trim_my_take', { start_ms: null, end_ms: null })
  assert.deepEqual(plain(r.step.undo), { kind: 'take_trim', startMs: 1800, endMs: 9000 })
  toolError(() => shared.applyRemixChatTool(state(), clipFacts(), 'trim_my_take', { start_ms: 0, end_ms: 1000 }), /at least 2 seconds/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts({ format: 'pause_react', trimmable: false }), 'trim_my_take', { start_ms: 0, end_ms: 5000 }), /sets when their video pauses/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts({ format: 'react_thoughts', trimmable: false }), 'trim_my_take', { start_ms: 0, end_ms: 5000 }), /record part 2 again/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts({ takeMs: null }), 'trim_my_take', { start_ms: 0, end_ms: 5000 }), /Record your take first/)
})

test('their clip’s box and the comment banner (React, then my thoughts)', () => {
  const react = clipFacts({ format: 'react_thoughts', theirClip: null, trimmable: false, boxAt: 'auto', banner: false })
  let r = shared.applyRemixChatTool(state(), react, 'set_box_position', { position: 'top' })
  assert.deepEqual(plain([r.step.action, r.step.undo]), [{ kind: 'layout', patch: { boxAt: 'top' } }, { kind: 'layout', patch: { boxAt: 'auto' } }])
  assert.equal(r.step.summary, 'Their clip’s box goes at the top while you react.')
  r = shared.applyRemixChatTool(state(), react, 'set_comment_banner', { on: true })
  assert.deepEqual(plain(r.step.action), { kind: 'layout', patch: { banner: true } })
  toolError(() => shared.applyRemixChatTool(state(), { ...react, keyword: '' }, 'set_comment_banner', { on: true }), /comment keyword/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts({ format: 'pause_react' }), 'set_box_position', { position: 'top' }), /already sits at the top/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts(), 'set_box_position', { position: 'top' }), /plays full screen first/)
})

test('graphics go on the member’s part: after the “My take” label, inside the part of the take used', () => {
  let r = shared.applyRemixChatTool(state(), clipFacts(), 'add_graphic', { template: 'stat', at_ms: 3200, fields: { value: '$1,200', label: 'a month' } }, newId)
  const g = r.state.graphics[0]
  assert.deepEqual([g.template, g.at_ms, g.duration_ms, g.placement, g.origin], ['stat', 3200, 3000, 'middle', 'chat'])
  assert.equal(r.step.summary, 'Added a stat counter at 0:03.2 of your take.')
  r = shared.applyRemixChatTool(r.state, clipFacts(), 'update_graphic', { id: g.id, at_ms: 8000 })
  assert.equal(r.state.graphics[0].duration_ms, 1000, 'it ends with the take')
  toolError(() => shared.applyRemixChatTool(state(), clipFacts(), 'add_graphic', { template: 'title', at_ms: 500, fields: { text: 'Hi there' } }), /at least 1300/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts({ takeTrim: { startMs: 3000, endMs: 8000 } }), 'add_graphic', { template: 'title', at_ms: 2000, fields: { text: 'Hi there' } }), /at least 4300/)
  toolError(() => shared.applyRemixChatTool(state(), clipFacts(), 'add_graphic', { template: 'title', at_ms: 8800, fields: { text: 'Hi there' } }), /before 8200/)
  // Pause & react: from the start of the video.
  r = shared.applyRemixChatTool(state(), clipFacts({ format: 'pause_react', trimmable: false }), 'add_graphic', { template: 'title', at_ms: 0, fields: { text: 'Watch this' } })
  assert.equal(r.state.graphics[0].at_ms, 0)
  r = shared.applyRemixChatTool(r.state, clipFacts(), 'remove_graphic', { id: r.state.graphics[0].id })
  assert.deepEqual(plain(r.state.graphics), [])
})

test('the review merges the steps: its own values, then main’s setters in order, undone in reverse', () => {
  const s = state(), f = clipFacts()
  const a = shared.applyRemixChatTool(s, f, 'set_hook_text', { text: 'This serum did nothing for me' })
  const b = shared.applyRemixChatTool(a.state, a.facts, 'trim_my_take', { start_ms: 1000, end_ms: 8000 })
  const c = shared.applyRemixChatTool(b.state, b.facts, 'set_their_clip', { start_ms: 2000, end_ms: 6000 })
  const merged = shared.mergeRemixChatSteps(plain([a.step, b.step, c.step]))
  assert.deepEqual(plain(merged.patch), { headline: 'This serum did nothing for me' })
  assert.deepEqual(plain(merged.actions.map((x) => x.kind)), ['take_trim', 'their_clip'])
  assert.deepEqual(plain(merged.undo.map((x) => x.kind)), ['their_clip', 'take_trim'])
  assert.throws(() => shared.mergeRemixChatSteps([{ patch: { folder: '/etc' } }]), /invalid edit/)
  assert.throws(() => shared.mergeRemixChatSteps([{ patch: {}, action: { kind: 'delete_everything' } }]), /invalid edit/)
  assert.equal(shared.parseRemixChatSteps([{ tool: 'trim_my_take', summary: 'x', patch: {}, action: { kind: 'take_trim', startMs: 0, endMs: 3000 } }])[0].action.kind, 'take_trim')
})

/** A fake OpenRouter: each request answers with the next scripted SSE reply (or an HTTP error). */
function fakeOpenRouter(replies) {
  const requests = []
  const fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    const next = replies.shift()
    if (typeof next === 'number') return new Response(JSON.stringify({ error: { message: 'Server error' } }), { status: next })
    const chunks = []
    if (next.text) chunks.push({ choices: [{ delta: { content: next.text } }] })
    ;(next.calls ?? []).forEach((call, index) => chunks.push({ choices: [{ delta: { tool_calls: [{ index, id: `call_${index}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }))
    chunks.push({ choices: [], usage: { cost: next.cost ?? 0 } })
    return new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  return { fetch, requests }
}

test('one turn: the take’s words and facts go to the model, its calls come back checked, and the cost is reported', async () => {
  const openrouter = fakeOpenRouter([
    { calls: [{ name: 'trim_my_take', args: { start_ms: 1700, end_ms: 9000, reason: 'to cut your first sentence' } }, { name: 'add_graphic', args: { template: 'stat', at_ms: 500, fields: { value: '$1,200' } } }], cost: 0.002 },
    { calls: [{ name: 'add_graphic', args: { template: 'stat', at_ms: 4100, fields: { value: '$1,200', label: 'a month' } } }], cost: 0.002 },
    { text: 'Cut your first sentence and added the $1,200 stat.', cost: 0.001 }
  ])
  const costs = []
  const words = { take: [['Honestly', 300, 700], ['that', 750, 900], ['scared', 950, 1300], ['me.', 1350, 1600], ['I', 1800, 1900], ['made', 1950, 2200], ['$1,200', 4100, 4700]], theirs: [['Fifteen', 1200, 1600]], quote: '' }
  const deps = { facts: async (id) => { if (id !== 0) throw new Error('That take is no longer in this review.'); return { facts: clipFacts(), words, runId: 'run9' } },
    apiKey: 'sk-or-test', model: 'google/gemini-3.8-flash', fetch: openrouter.fetch, url: 'http://fake/chat/completions', onCost: (usd) => costs.push(usd) }
  await assert.rejects(main.remixChat({ ...state(), draftId: 3 }, 'Hi', deps), /no longer in this review/)
  await assert.rejects(main.remixChat({ ...state(), headline: 'x'.repeat(200) }, 'Hi', deps), /too long/)
  await assert.rejects(main.remixChat({ ...state(), graphics: [{ id: 'g-aaaa1111', template: 'title', at_ms: 100, duration_ms: 2000, placement: 'top', fields: { text: 'Hi' } }] }, 'Hi', deps), /after the “My take” label/)
  const result = await main.remixChat(state(), 'Cut my first sentence and add a stat when I say $1,200', deps)
  assert.equal(result.reply, 'Cut your first sentence and added the $1,200 stat.')
  assert.deepEqual(result.steps.map((s) => s.tool), ['trim_my_take', 'add_graphic'])
  assert.equal(result.steps[1].patch.graphics[0].at_ms, 4100)
  assert.ok(Math.abs(costs.reduce((a, b) => a + b, 0) - 0.005) < 1e-9)
  assert.match(openrouter.requests[0].messages[0].content, /What the member says \(word@ms\): Honestly@300 that@750 scared@950 me\.@1350 I@1800/)
  assert.match(openrouter.requests[0].messages[0].content, /Their part: 1000–7000 ms of their video/)
  // The graphic at 0.5 s came back as an error: the trimmed take starts at 1.7 s.
  assert.match(openrouter.requests[1].messages.at(-1).content, /^Error: at_ms must be at least 3000/)
  assert.deepEqual(main.remixChatHistory('run9', 0).map((m) => m.role), ['user', 'assistant'])
  main.resetRemixChat('run9', 0)
  assert.deepEqual(main.remixChatHistory('run9', 0), [])
  assert.equal(main.remixChatInfo({ apiKey: false, model: 'm' }).reason, 'Add your OpenRouter key in Settings → API keys to chat about your video.')
})
