// Edit my recording's Chat panel: the tools' checks (cuts, the opening, cards, pop-ups, graphics, the look), merging
// the steps the review applies, and one OpenRouter turn (mocked) turning tool calls into checked changes.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')

const shared = loadMain("export * from './src/shared/edit-chat'; export { parseEditPlan, initialDecisions, reelWordStarts, reelCardWindows, parseEditDecisions } from './src/shared/edit-recording'")
const main = loadMain("export * from './src/main/edit-chat'")
const plain = (x) => JSON.parse(JSON.stringify(x))
let ids = 0
const newId = () => `g-test${String(++ids).padStart(5, '0')}`
const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message), `expected ${pattern}`)

/** A first take with a retake of its opening line, a pricing line with "40%", and the call to action. */
function samplePlan() {
  const words = []
  const say = (text, start, src = 0, cut = null) => text.split(' ').forEach((word, i) => words.push([word, Math.round((start + i * 0.32) * 1000), Math.round((start + i * 0.32 + 0.28) * 1000), src, cut]))
  say('Most coaches lose clients.', 0.2) // 0-3 (said again below)
  say('Most coaches lose so many clients.', 2.0) // 4-9
  say('Raise your price by 40% this month.', 4.5) // 10-16
  say('Here are three steps.', 7.5) // 17-20
  say('Follow me for more.', 10) // 21-24
  return shared.parseEditPlan({
    words, hooks: [{ id: 0, start: 10, end: 16, text: 'Raise your price by 40%', why: 'A number' }], hook: null, cta: { start: 21, end: 24 },
    popups: [{ id: 0, word: 14, text: '40%', kind: 'number' }, { id: 1, word: 17, kind: 'card', seconds: 3, card: { type: 'list', title: 'Three steps', items: ['Price', 'Post'] } }],
    sounds: [{ id: 0, at: 'title', sound: 'whoosh' }], planned: 'ai', notes: [], warnings: []
  }, 1)
}
const plan = samplePlan()
const ctx = { plan, images: [] }
const fresh = () => plain({ ...shared.initialDecisions(plan), look: { ...shared.initialDecisions(plan).look } })

test('cut and keep words, start with a line, and choose a hook', () => {
  const d = fresh()
  let r = shared.applyEditChatTool(d, 'cut_words', { start: 0, end: 3, reason: 'the first take' }, ctx)
  assert.deepEqual(plain(r.step.patch.cut), [0, 1, 2, 3])
  assert.equal(r.step.summary, 'Cut “Most coaches lose clients” (4 words) (the first take).')
  r = shared.applyEditChatTool(r.decisions, 'keep_words', { start: 2, end: 2 }, ctx)
  assert.deepEqual(plain(r.decisions.cut), [0, 1, 3])
  // A hook found on the line opens the reel with its text.
  r = shared.applyEditChatTool(d, 'start_with', { start: 10, end: 16 }, ctx)
  assert.deepEqual([r.decisions.hookId, r.decisions.hookText], [0, 'Raise your price by 40%'])
  // A line without a hook: everything said before it is cut.
  r = shared.applyEditChatTool(d, 'start_with', { start: 17, end: 20 }, ctx)
  assert.deepEqual(plain(r.step.patch.cut), Array.from({ length: 17 }, (_, i) => i))
  assert.match(r.step.summary, /^Starts with “Here are three steps”: cut 17 words before it\.$/)
  r = shared.applyEditChatTool(d, 'choose_hook', { hook_id: null }, ctx)
  assert.equal(r.decisions.hookId, null)
  toolError(() => shared.applyEditChatTool(d, 'choose_hook', { hook_id: 7 }, ctx), /hook_id must be one of 0/)
  toolError(() => shared.applyEditChatTool(d, 'cut_words', { start: 30, end: 31 }, ctx), /word index from 0 to 24/)
  toolError(() => shared.applyEditChatTool(d, 'cut_words', { start: 0, end: 24 }, ctx), /almost empty/)
  toolError(() => shared.applyEditChatTool(d, 'keep_words', { start: 5, end: 6 }, ctx), /already kept/)
})

test('hook text, pop-ups, cards, sounds, the style, extras, openings and the look', () => {
  const d = fresh()
  let r = shared.applyEditChatTool(d, 'set_hook_text', { text: '  Charge 40% more  this month ' }, ctx)
  assert.equal(r.decisions.hookText, 'Charge 40% more this month')
  toolError(() => shared.applyEditChatTool(d, 'set_hook_text', { text: 'Punchy' }, ctx), /at least two words/)
  toolError(() => shared.applyEditChatTool(d, 'set_hook_text', { text: 'Use <b>bold</b> now' }, ctx), /plain text/)
  r = shared.applyEditChatTool(d, 'set_popup', { id: 0, on: false }, ctx)
  assert.equal(r.decisions.popups.find((p) => p.id === 0).on, false)
  toolError(() => shared.applyEditChatTool(d, 'set_popup', { id: 1, on: false }, ctx), /cards use set_card/)
  r = shared.applyEditChatTool(d, 'set_card', { id: 1, on: true, items: ['Price higher', 'Post daily', 'Follow up'] }, ctx)
  assert.deepEqual(plain(r.decisions.popups.find((p) => p.id === 1).card.items), ['Price higher', 'Post daily', 'Follow up'])
  r = shared.applyEditChatTool(d, 'set_sound', { id: 0, on: false }, ctx)
  assert.equal(r.step.summary, 'Soft whoosh off.')
  r = shared.applyEditChatTool(d, 'set_style', { style: 'fast' }, ctx)
  assert.deepEqual([r.decisions.recipe, plain(r.decisions.lookExtras)], ['fast', ['keyword_pill', 'progress_bar']])
  r = shared.applyEditChatTool(d, 'set_extras', { extras: ['progress_bar'] }, ctx)
  assert.deepEqual(plain(r.decisions.lookExtras), ['progress_bar'])
  toolError(() => shared.applyEditChatTool(d, 'set_extras', { extras: ['confetti'] }, ctx), /extras may only be/)
  r = shared.applyEditChatTool({ ...d, cutoutIntro: true }, 'set_openings', { cutout_intro: false }, ctx)
  assert.deepEqual([r.decisions.cutoutIntro, r.step.summary], [false, 'Cut-out opening off.'])
  r = shared.applyEditChatTool(d, 'set_captions', { preset: 'boxed' }, ctx)
  assert.deepEqual([r.decisions.look.includeCaptions, r.decisions.look.captionPreset], [true, 'boxed'])
  r = shared.applyEditChatTool(d, 'set_hook_look', { look: 'brand', color: '#ff0055' }, ctx)
  assert.deepEqual(plain(r.decisions.look.headlineLook), { look: 'brand', color: '#FF0055', font: 'clean' })
  toolError(() => shared.applyEditChatTool(d, 'set_hook_look', { color: 'red' }, ctx), /#RRGGBB/)
  r = shared.applyEditChatTool(d, 'set_hook_look', { look: 'floating', text_bg: 'light', hide_after_s: 5 }, ctx)
  assert.deepEqual(plain(r.decisions.look.headlineLook), { look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'light', hideAfterS: 5 })
  assert.match(r.step.summary, /hides after 5 s/)
  toolError(() => shared.applyEditChatTool(d, 'set_hook_look', { hide_after_s: 4 }, ctx), /hide_after_s/)
  toolError(() => shared.applyEditChatTool(d, 'shout', {}, ctx), /no tool called shout/)
})

test('graphics start on a kept word, carry only their template’s words and never play during a card', () => {
  const d = fresh()
  let r = shared.applyEditChatTool(d, 'add_graphic', { template: 'stat', word: 14, fields: { value: '40%', label: 'price raise' } }, ctx, newId)
  const g = r.decisions.graphics[0]
  assert.deepEqual([g.template, g.word, g.duration_ms, g.placement, g.origin], ['stat', 14, 3000, 'top', 'chat'])
  assert.deepEqual(plain(g.fields), { value: '40%', label: 'price raise' })
  assert.equal(r.step.summary, 'Added a stat counter on “40%”.')
  r = shared.applyEditChatTool(r.decisions, 'update_graphic', { id: g.id, duration_ms: 2000, placement: 'bottom' }, ctx)
  assert.deepEqual([r.decisions.graphics[0].duration_ms, r.decisions.graphics[0].placement], [2000, 'bottom'])
  r = shared.applyEditChatTool(r.decisions, 'remove_graphic', { id: g.id }, ctx)
  assert.deepEqual(plain(r.decisions.graphics), [])
  toolError(() => shared.applyEditChatTool(d, 'add_graphic', { template: 'logo', word: 14, fields: { caption: 'x' } }, ctx), /template must be one of/)
  toolError(() => shared.applyEditChatTool(d, 'add_graphic', { template: 'stat', word: 14, fields: { text: '40%' } }, ctx), /has the fields value, label/)
  toolError(() => shared.applyEditChatTool(d, 'add_graphic', { template: 'title', word: 14, fields: {} }, ctx), /Give the title graphic its text/)
  const cut = shared.applyEditChatTool(d, 'cut_words', { start: 14, end: 14 }, ctx).decisions
  toolError(() => shared.applyEditChatTool(cut, 'add_graphic', { template: 'title', word: 14, fields: { text: 'Raise it' } }, ctx), /That word is cut/)
  // With the card on: a graphic on its words would play during it.
  const carded = shared.applyEditChatTool(d, 'set_card', { id: 1, on: true }, ctx).decisions
  assert.equal(shared.reelCardWindows(plan, carded).length, 1)
  toolError(() => shared.applyEditChatTool(carded, 'add_graphic', { template: 'title', word: 18, fields: { text: 'Three steps' } }, ctx), /during a card/)
})

test('the review checks the steps again before applying them, and the context lists the words with their indexes', () => {
  const d = fresh()
  const a = shared.applyEditChatTool(d, 'cut_words', { start: 0, end: 3 }, ctx)
  const b = shared.applyEditChatTool(a.decisions, 'set_hook_text', { text: 'Raise your price' }, ctx)
  const patch = shared.mergeEditChatSteps(d, [a.step, b.step], ctx)
  assert.deepEqual(plain(patch), { cut: [0, 1, 2, 3], hookText: 'Raise your price' })
  assert.deepEqual(plain(shared.editPatchValues(d, ['cut', 'hookText'])), { cut: [], hookText: 'Raise your price by 40%' })
  assert.throws(() => shared.mergeEditChatSteps(d, [{ patch: { sources: [] } }], ctx), /invalid edit/)
  assert.throws(() => shared.mergeEditChatSteps(d, [{ patch: { cut: Array.from({ length: 24 }, (_, i) => i) } }], ctx), /doesn’t fit your edit anymore/)
  assert.deepEqual(shared.parseEditChatSteps([{ tool: 'cut_words', summary: 'Cut.', patch: { cut: [1] } }, { tool: 1 }]).length, 1)
  const text = shared.editChatContext(a.decisions, ctx, [{ name: 'take one.mp4' }])
  assert.match(text, /0:~Most~ 1:~coaches~ 2:~lose~ 3:~clients\.~/)
  assert.match(text, /14:40%/)
  assert.match(text, /Hooks found \(choose_hook\): id 0: words 10–16 “Raise your price by 40%”/)
  assert.match(text, /Half-screen cards \(set_card\): id 1 list on word 17: title “Three steps”/)
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

const status = () => ({ id: 'run1', phase: 'review', detail: '', percent: 100, sources: [{ path: '/a.mp4', name: 'take.mp4', seconds: 12 }], folder: '/x/edit-1', plan,
  transcriber: 'scribe', output: null, costUsd: 0, estimateUsd: null, error: null, warnings: [], images: [] })

test('one turn: tool calls become checked changes, errors go back to the model, the cost is reported, and the thread is remembered', async () => {
  const openrouter = fakeOpenRouter([
    { calls: [{ name: 'cut_words', args: { start: 0, end: 99 } }], cost: 0.002 },
    { calls: [{ name: 'cut_words', args: { start: 0, end: 3, reason: 'the first take' } }, { name: 'add_graphic', args: { template: 'stat', word: 14, fields: { value: '40%' } } }], cost: 0.003 },
    { text: 'Done: the retake is gone and a stat shows on “40%”.', cost: 0.001 }
  ])
  const costs = []
  const deps = { status: status(), apiKey: 'sk-or-test', model: 'google/gemini-3.8-flash', fetch: openrouter.fetch, url: 'http://fake/chat/completions', onCost: (usd) => costs.push(usd) }
  await assert.rejects(main.editRecordingChat(fresh(), 'x'.repeat(1001), deps), /up to 1000 characters/)
  await assert.rejects(main.editRecordingChat(fresh(), 'Hi', { ...deps, status: null }), /no edit waiting/)
  await assert.rejects(main.editRecordingChat({ ...fresh(), cut: [99] }, 'Hi', deps), /can’t read/)
  await assert.rejects(main.editRecordingChat(fresh(), 'Hi', { ...deps, apiKey: '' }), /OpenRouter key/)
  const result = await main.editRecordingChat(fresh(), 'Remove the first take and add a stat card when I say 40%', deps)
  assert.equal(result.error, undefined)
  assert.equal(result.reply, 'Done: the retake is gone and a stat shows on “40%”.')
  assert.deepEqual(result.steps.map((s) => s.tool), ['cut_words', 'add_graphic'])
  assert.deepEqual(plain(result.steps[0].patch.cut), [0, 1, 2, 3])
  assert.equal(result.steps[1].patch.graphics[0].word, 14)
  assert.ok(Math.abs(costs.reduce((a, b) => a + b, 0) - 0.006) < 1e-9)
  // The model saw the words with their indexes, and its bad call came back as an error it could fix.
  assert.match(openrouter.requests[0].messages[0].content, /10:Raise 11:your 12:price 13:by/)
  assert.match(openrouter.requests[1].messages.at(-1).content, /^Error: end must be a word index from 0 to 24/)
  assert.deepEqual(openrouter.requests[0].tools.map((t) => t.function.name).sort(), plain(shared.EDIT_CHAT_TOOLS.map((t) => t.name).filter((name) => !shared.COMBINE_CHAT_TOOLS.includes(name))).sort())
  const history = main.editChatHistory('run1')
  assert.deepEqual(history.map((m) => m.role), ['user', 'assistant'])
  assert.match(history[1].content, /\[Edits made: Cut “Most coaches lose clients” \(4 words\) \(the first take\)\. Added a stat counter on “by”\.\]|\[Edits made: Cut/)
  main.resetEditChat('run1')
  assert.deepEqual(main.editChatHistory('run1'), [])
  // A rejected key is reported plainly.
  const denied = await main.editRecordingChat(fresh(), 'Hi', { ...deps, fetch: fakeOpenRouter([401]).fetch })
  assert.match(denied.error, /rejected your API key/)
  assert.equal(main.editChatInfo({ apiKey: false, model: 'm' }).reason, 'Add your OpenRouter key in Settings → API keys to chat about your edit.')
})
