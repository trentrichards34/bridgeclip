// Clip editor Chat tab: tool validation, applying edits, audio cues, context and
// one OpenRouter turn (mocked) turning tool calls into checked edits.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')
const fixture = require('../fixtures/editor/project.json')

const shared = loadMain("export * from './src/shared/clip-chat'; export { parseCandidateEdit, candidateEdit } from './src/shared/clip-editor'; export { parseGraphics } from './src/shared/motion-graphics'")
const plain = (x) => JSON.parse(JSON.stringify(x))
const project = { duration_ms: 12000, width: 1920, height: 1080, aspect_ratio: '9:16', transcriptCount: 4 }
let ids = 0
const newId = () => `chat-test${String(++ids).padStart(4, '0')}`
const clip = () => plain(shared.parseCandidateEdit(structuredClone(fixture.candidates[0]), 12000, 4))
const toolError = (fn, pattern) => assert.throws(fn, (e) => e.constructor.name === 'ChatToolError' && pattern.test(e.message))

function loadMainChat(dir) {
  const { electron } = fakeElectron(dir)
  return loadMain("export * from './src/main/clip-chat'", { electron })
}

test('range tools move, cut and add source time, and say what changed', () => {
  const c = clip()
  let r = shared.applyChatTool(c, 'extend_start', { to_ms: 400, reason: "to include Joe's 'Wowww.'" }, project, newId)
  assert.deepEqual(r.candidate.ranges, [[400, 5000], [7000, 10000]])
  assert.equal(r.step.summary, "Start moved back 0.6s to include Joe's 'Wowww.'")
  assert.deepEqual([r.step.focus_ms, r.step.play_seconds], [400, 4])
  assert.deepEqual(plain(r.step.patch), { ranges: [[400, 5000], [7000, 10000]] })
  assert.equal(c.ranges[0][0], 1000, 'the clip passed in is not changed')
  r = shared.applyChatTool(c, 'extend_end', { to_ms: 11500 }, project, newId)
  assert.deepEqual(r.candidate.ranges.at(-1), [7000, 11500])
  assert.equal(r.step.summary, 'End moved later by 1.5s.')
  r = shared.applyChatTool(c, 'remove_section', { start_ms: 4500, end_ms: 7500 }, project, newId)
  assert.deepEqual(r.candidate.ranges, [[1000, 4500], [7500, 10000]], 'a cut across a join trims both sides')
  r = shared.applyChatTool(c, 'add_section', { start_ms: 4800, end_ms: 7200 }, project, newId)
  assert.deepEqual(r.candidate.ranges, [[1000, 10000]], 'an added section merges with its neighbors')
  r = shared.applyChatTool(c, 'set_ranges', { ranges: [[3000, 6000], [1000, 3500]] }, project, newId)
  assert.deepEqual(r.candidate.ranges, [[1000, 6000]], 'sorted and merged')
  assert.equal(shared.clipLengthNote(r.candidate), 'Clip is now 4.0s.', 'export speed counts (5 s at 1.25×)')
})

test('invalid tool calls come back as errors the model can fix', () => {
  const c = clip()
  toolError(() => shared.applyChatTool(c, 'extend_start', { to_ms: 99999 }, project, newId), /between 0 and 12000/)
  toolError(() => shared.applyChatTool(c, 'extend_start', { to_ms: '1s' }, project, newId), /number of milliseconds/)
  toolError(() => shared.applyChatTool(c, 'extend_start', { to_ms: 4950 }, project, newId), /must be before 4900/)
  toolError(() => shared.applyChatTool(c, 'remove_section', { start_ms: 0, end_ms: 12000 }, project, newId), /nothing in the clip/)
  toolError(() => shared.applyChatTool(c, 'remove_section', { start_ms: 5200, end_ms: 6800 }, project, newId), /isn’t in the clip/)
  toolError(() => shared.applyChatTool(c, 'set_ranges', { ranges: [[0, 50]] }, project, newId), /at least 100 ms/)
  toolError(() => shared.applyChatTool(c, 'set_hook_text', { text: 'Wow' }, project, newId), /two words/)
  toolError(() => shared.applyChatTool(c, 'set_captions', { preset: 'comic-sans' }, project, newId), /preset must be one of/)
  toolError(() => shared.applyChatTool(c, 'set_layout_at', { at_ms: 2000, layout: 'grid' }, project, newId), /fill, split or fit/)
  toolError(() => shared.applyChatTool(c, 'delete_everything', {}, project, newId), /no tool called/)
})

test('hook, captions, title and layout tools give valid edits', () => {
  const c = clip()
  let r = shared.applyChatTool(c, 'set_hook_text', { text: '  He  did NOT see that coming ' }, project, newId)
  assert.equal(r.candidate.hook.text, 'He did NOT see that coming')
  r = shared.applyChatTool(r.candidate, 'set_hook_look', { look: 'brand', color: '#ff0055', font: 'condensed' }, project, newId)
  assert.deepEqual(plain(r.candidate.hook.look), { look: 'brand', color: '#FF0055', font: 'condensed' })
  assert.match(r.step.summary, /Brand color, Bold condensed font, #FF0055/)
  r = shared.applyChatTool(c, 'set_captions', { preset: 'boxed' }, project, newId)
  assert.deepEqual(plain(r.step.patch), { caption_preset: 'boxed', captions: true })
  r = shared.applyChatTool(c, 'set_title', { title: 'Why it worked' }, project, newId)
  assert.equal(r.candidate.title, 'Why it worked')
  // Split from 2 s to the end: the later split change at 8 s is folded in.
  r = shared.applyChatTool(c, 'set_layout_at', { at_ms: 2000, layout: 'split' }, project, newId)
  assert.deepEqual(r.candidate.scenes.map((s) => [s.at_ms, s.layout]), [[0, 'fill'], [2000, 'split']])
  assert.equal(r.candidate.scenes[1].crops.length, 2)
  // Fit for a stretch, then back to what was there.
  r = shared.applyChatTool(c, 'set_layout_at', { at_ms: 2000, layout: 'fit', until_ms: 4000 }, project, newId)
  assert.deepEqual(r.candidate.scenes.map((s) => [s.at_ms, s.layout]), [[0, 'fill'], [2000, 'fit'], [4000, 'fill'], [8000, 'split']])
  // From the clip's start: the layout in use there changes.
  r = shared.applyChatTool(c, 'set_layout_at', { at_ms: 0, layout: 'fit' }, project, newId)
  assert.deepEqual(r.candidate.scenes.map((s) => [s.at_ms, s.layout]), [[0, 'fit']])
  r = shared.applyChatTool(c, 'play', { at_ms: 600, seconds: 40 }, project, newId)
  assert.deepEqual([plain(r.step.patch), r.step.focus_ms, r.step.play_seconds, r.candidate], [{}, 600, 15, c])
})

test('graphics follow the shared contract with origin chat', () => {
  const c = clip()
  let r = shared.applyChatTool(c, 'add_graphic', { template: 'stat', at_ms: 2000, duration_ms: 2500, fields: { value: '3x', label: 'more replies' } }, project, newId)
  const [g] = r.candidate.graphics
  assert.deepEqual(plain(g), { id: g.id, template: 'stat', at_ms: 2000, duration_ms: 2500, placement: 'middle', fields: { value: '3x', label: 'more replies' }, origin: 'chat' })
  assert.deepEqual(plain(shared.parseGraphics(r.candidate.graphics)), plain(r.candidate.graphics))
  r = shared.applyChatTool(r.candidate, 'update_graphic', { id: g.id, placement: 'top', fields: { label: 'more DMs' } }, project, newId)
  assert.deepEqual([r.candidate.graphics[0].placement, r.candidate.graphics[0].fields.label, r.candidate.graphics[0].fields.value], ['top', 'more DMs', '3x'])
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'stat', at_ms: 6000, fields: { value: '1' } }, project, newId), /inside the clip/)
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'logo', at_ms: 2000, fields: { caption: 'x' } }, project, newId), /template must be|can’t add a logo/)
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'stat', at_ms: 2000, duration_ms: 100, fields: { value: '1' } }, project, newId), /between 800 and 8000/)
  toolError(() => shared.applyChatTool(c, 'add_graphic', { template: 'quote', at_ms: 2000, fields: { value: '1' } }, project, newId), /fields text, author/)
  toolError(() => shared.applyChatTool(c, 'remove_graphic', { id: 'nope' }, project, newId), /No graphic/)
  r = shared.applyChatTool(r.candidate, 'remove_graphic', { id: g.id }, project, newId)
  assert.deepEqual(plain(r.candidate.graphics), [])
})

test('the renderer merges steps into one valid patch and refuses anything else', () => {
  const c = clip()
  const a = shared.applyChatTool(c, 'extend_start', { to_ms: 400 }, project, newId)
  const b = shared.applyChatTool(a.candidate, 'set_title', { title: 'New' }, project, newId)
  const patch = shared.mergeChatSteps(c, [a.step, b.step], project)
  assert.deepEqual(plain(patch), { ranges: [[400, 5000], [7000, 10000]], title: 'New' })
  assert.deepEqual(plain(shared.patchValues(c, ['ranges', 'title'])), { ranges: [[1000, 5000], [7000, 10000]], title: 'The result' })
  assert.throws(() => shared.mergeChatSteps(c, [{ ...a.step, patch: { status: 'baked' } }], project), /invalid edit/)
  assert.throws(() => shared.mergeChatSteps(c, [{ ...a.step, patch: { ranges: [[5000, 1000]] } }], project), /doesn’t fit this clip/)
  assert.throws(() => shared.mergeChatSteps(c, 'nope', project), /invalid edit/)
  assert.equal(shared.parseChatSteps([{ tool: 'x' }, a.step]).length, 1)
  assert.equal(shared.chatCostNote(null), 'Each message uses your OpenRouter credit.')
  assert.equal(shared.chatCostNote(0.011), 'Each message costs about 1¢ of your OpenRouter credit.')
  assert.equal(shared.chatCostNote(0.001), 'Each message costs less than a cent of your OpenRouter credit.')
  // Graphics now save with the clip.
  assert.deepEqual(plain(shared.candidateEdit({ ...c, graphics: [] })).graphics, [])
})

test('loud moments stand out from the talking around them; context lists words, tags and cues', () => {
  const { dir, cleanup } = tempDir('bridgeclip-chat-')
  try {
    const chat = loadMainChat(dir)
    // 5 s at 8 kHz: steady talking level, one loud burst at 2.0–2.3 s.
    const pcm = Buffer.alloc(8000 * 5 * 2)
    for (let i = 0; i < 8000 * 5; i++) {
      const loud = i >= 16000 && i < 18400
      pcm.writeInt16LE(Math.round(Math.sin(i / 3) * (loud ? 20000 : 2000)), i * 2)
    }
    const moments = chat.findLoudMoments(pcm, 60000)
    assert.equal(moments.length, 1)
    assert.deepEqual([moments[0].start_ms, moments[0].end_ms], [62000, 62300])
    assert.ok(moments[0].db_above >= 15)
    const c = clip()
    const segments = [
      { start_ms: 0, end_ms: 900, text: 'Wowww.', speaker: 'speaker_0', words: [{ word: 'Wowww.', start_ms: 300, end_ms: 800 }], events: [] },
      { start_ms: 1000, end_ms: 4000, text: 'The event happened.', speaker: 'speaker_1', words: [{ word: 'The', start_ms: 1000, end_ms: 1200 }, { word: '(laughter)', start_ms: 1300, end_ms: 1500 }], events: ['laughter'] }
    ]
    const context = chat.buildChatContext({ ...fixture, transcript: fixture.transcript }, c, segments, moments)
    assert.match(context, /\[before clip\] 0–900, speaker_0: Wowww\.@300/)
    assert.match(context, /\[in clip\] 1000–4000, speaker_1: The@1000 \(laughter\)@1300/)
    assert.match(context, /Sound tags from the transcript: laughter in the line at 1000–4000 ms; \(laughter\) at 1300–1500 ms\./)
    assert.match(context, /Loud moments .*62000–62300 ms \(\+\d+ dB, 1:02\.0\)/)
    assert.match(context, /Sections kept \(source ms\): \[1000, 5000\], \[7000, 10000\]/)
    assert.match(chat.buildChatContext(fixture, c, null, null), /no word times saved[\s\S]*\[partly in clip\] 6000–8000[\s\S]*Loud moments: not available/)
    assert.equal(chat.chatModel({ clippingMode: 'advanced', plannerModel: 'anthropic/claude-x' }), 'anthropic/claude-x')
    assert.equal(chat.chatModel({ clippingMode: 'quality', plannerModel: 'anthropic/claude-x' }), chat.DEFAULT_CHAT_MODEL)
    assert.ok(Math.abs(chat.chatEstimateUsd({ inputPrice: 0.0000003, outputPrice: 0.0000025 }) - 0.00715) < 1e-9)
    assert.equal(chat.chatEstimateUsd({ inputPrice: null, outputPrice: 1 }), null)
  } finally { cleanup() }
})

/** A fake OpenRouter: each request answers with the next scripted SSE reply (or an HTTP error). */
function fakeOpenRouter(replies) {
  const requests = []
  const fetch = async (url, init) => {
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

const turn = (chat, c, openrouter, extra = {}) => chat.runClipChat({
  apiKey: 'sk-or-test', model: 'google/gemini-3.8-flash', project: { ...project, title: fixture.title, transcript: fixture.transcript },
  candidate: c, message: 'Start with the wow before she answers', history: [], segments: null, loud: [], signal: new AbortController().signal,
  fetch: openrouter.fetch, url: 'http://fake/chat/completions', newId, ...extra
})

test('one turn: tool calls become checked edits, errors go back to the model, cost is recorded', async () => {
  const { dir, cleanup } = tempDir('bridgeclip-chat-')
  try {
    const chat = loadMainChat(dir)
    const openrouter = fakeOpenRouter([
      { calls: [{ name: 'extend_start', args: { to_ms: 99999 } }], cost: 0.002 },
      { calls: [{ name: 'extend_start', args: { to_ms: 300, reason: 'to include the "Wowww."' } }], cost: 0.003 },
      { text: 'Done. The clip now opens on the wow.', cost: 0.001 }
    ])
    const costs = []
    const result = await turn(chat, clip(), openrouter, { onCost: (usd) => costs.push(usd) })
    assert.equal(result.error, undefined)
    assert.equal(result.reply, 'Done. The clip now opens on the wow.')
    assert.equal(result.steps.length, 1)
    assert.equal(result.steps[0].summary, 'Start moved back 0.7s to include the "Wowww."')
    assert.deepEqual(plain(result.steps[0].patch.ranges), [[300, 5000], [7000, 10000]])
    assert.equal(costs.length, 1)
    assert.ok(Math.abs(costs[0] - 0.006) < 1e-9)
    // The model saw the tool error and the clip's context.
    const second = openrouter.requests[1].messages
    assert.match(second.at(-1).content, /^Error: to_ms must be between 0 and 12000/)
    assert.match(second[0].content, /Sections kept \(source ms\): \[1000, 5000\], \[7000, 10000\]/)
    assert.deepEqual(openrouter.requests[0].tools.map((t) => t.function.name).sort(), plain(shared.CHAT_TOOLS.map((t) => t.name)).sort())
    assert.equal(openrouter.requests[0].model, 'google/gemini-3.8-flash')
    // Edits from the third reply's tool results reach the model as the new state.
    assert.match(openrouter.requests[2].messages.at(-1).content, /"sections":\[\[300,5000\],\[7000,10000\]\]/)
  } finally { cleanup() }
})

test('a turn that fails part way keeps its checked edits and still records what it cost', async () => {
  const { dir, cleanup } = tempDir('bridgeclip-chat-')
  try {
    const chat = loadMainChat(dir)
    const openrouter = fakeOpenRouter([{ calls: [{ name: 'set_title', args: { title: 'Better title' } }], cost: 0.004 }, 500])
    const costs = []
    const result = await turn(chat, clip(), openrouter, { onCost: (usd) => costs.push(usd) })
    assert.match(result.error, /OpenRouter returned an error \(500\)/)
    assert.equal(result.steps.length, 1)
    assert.deepEqual(costs, [0.004])
    // A rejected key is reported plainly.
    const denied = await turn(chat, clip(), fakeOpenRouter([401]))
    assert.match(denied.error, /rejected your API key/)
    // Edits with no words are still an answer.
    const silent = await turn(chat, clip(), fakeOpenRouter([{ calls: [{ name: 'set_captions', args: { on: false } }] }, { text: '' }]))
    assert.equal(silent.error, undefined)
    assert.equal(silent.steps[0].summary, 'Captions turned off.')
  } finally { cleanup() }
})

test('editorChat checks the request, reads the run transcript and remembers the conversation per clip', async () => {
  const { dir, cleanup } = tempDir('bridgeclip-chat-')
  try {
    const chat = loadMainChat(dir)
    const run = path.join(dir, 'run')
    fs.mkdirSync(run)
    fs.writeFileSync(path.join(run, 'transcript.json'), JSON.stringify({ segments: [
      { start_time_ms: 0, end_time_ms: 900, text: 'Wowww.', speaker_label: 'speaker_0', words: [{ word: 'Wowww.', start_time_ms: 250, end_time_ms: 800 }], audio_events: [] },
      { start_time_ms: 1000, end_time_ms: 5000, text: 'Here it is.', words: [{ word: 'Here', start_time_ms: 1000, end_time_ms: 1300 }] }
    ] }))
    const segments = await chat.readChatTranscript(run, 0, 12000)
    assert.deepEqual(plain(segments[0].words), [{ word: 'Wowww.', start_ms: 250, end_ms: 800 }])
    const proj = { ...structuredClone(fixture) }
    const originalFetch = globalThis.fetch
    const openrouter = fakeOpenRouter([{ text: 'Is it the “Wowww.” at 0:00.3?', calls: [{ name: 'play', args: { at_ms: 250, seconds: 2 } }] }, { text: '' }, { text: 'OK.' }])
    globalThis.fetch = openrouter.fetch
    try {
      const deps = { session: { run, project: proj, sourcePath: '', previewPath: '' }, apiKey: 'sk-or-test', model: 'google/gemini-3.8-flash', ffmpeg: 'ffmpeg', url: 'http://fake/chat/completions' }
      await assert.rejects(chat.editorChat(fixture.candidates[0], 'x'.repeat(1001), deps), /up to 1000 characters/)
      await assert.rejects(chat.editorChat({ ...fixture.candidates[0], id: 'other' }, 'Hi', deps), /no longer in the project/)
      await assert.rejects(chat.editorChat({ ...fixture.candidates[0], ranges: [[5, 1]] }, 'Hi', deps), /can’t read/)
      await assert.rejects(chat.editorChat(fixture.candidates[0], 'Hi', { ...deps, apiKey: '' }), /OpenRouter key/)
      const first = await chat.editorChat(fixture.candidates[0], 'Start with the wow', deps)
      assert.equal(first.steps[0].tool, 'play')
      assert.match(openrouter.requests[0].messages[0].content, /Wowww\.@250/)
      await chat.editorChat(fixture.candidates[0], 'Yes, that one', deps)
      const third = openrouter.requests[2].messages
      assert.deepEqual(third.slice(1).map((m) => m.role), ['user', 'assistant', 'user'])
      assert.equal(third[1].content, 'Start with the wow')
      chat.resetChat(run, 'candidate-1')
      assert.deepEqual(chat.chatHistory(`${run}\ncandidate-1`), [])
    } finally { globalThis.fetch = originalFetch }
  } finally { cleanup() }
})

test('a chat message takes at most six round trips and ends once the tool limit is reached', async () => {
  const { dir, cleanup } = tempDir('bridgeclip-chat-')
  try {
    const chat = loadMainChat(dir)
    // Thirteen edits at once: past the limit of twelve, so the next round trip is the last and text-only.
    const many = Array.from({ length: 13 }, (_, i) => ({ name: 'set_title', args: { title: `Title ${i}` } }))
    const busy = fakeOpenRouter([{ calls: many, cost: 0.01 }, { calls: many, text: 'Done.', cost: 0.01 }, { text: 'never asked' }])
    const result = await turn(chat, clip(), busy)
    assert.equal(busy.requests.length, 2, 'no paid round trips after the limit')
    assert.deepEqual(busy.requests.map((r) => r.tool_choice), ['auto', 'none'])
    assert.equal(result.steps.length, 12)
    assert.equal(result.reply, 'Done.')
    assert.equal(result.error, undefined)
    // A model that keeps calling one tool: six round trips, the last one text-only.
    const loop = fakeOpenRouter(Array.from({ length: 30 }, () => ({ calls: [{ name: 'set_captions', args: { on: false } }] })))
    const looped = await turn(chat, clip(), loop)
    assert.equal(loop.requests.length, 6)
    assert.equal(loop.requests[5].tool_choice, 'none')
    assert.equal(looped.steps.length, 5)
    // The price note says what one message can cost at most.
    const model = { inputPrice: 0.0000003, outputPrice: 0.0000025 }
    assert.ok(Math.abs(chat.chatEstimateUsd(model, true) - (6 * 9000 * 0.0000003 + 6 * 700 * 0.0000025)) < 1e-9)
    assert.equal(shared.chatCostNote(0.00715, chat.chatEstimateUsd(model, true)), 'Each message costs about 1¢ of your OpenRouter credit, up to 3¢ when it makes many changes.')
    assert.equal(shared.chatCostNote(0.001, 0.003), 'Each message costs less than a cent of your OpenRouter credit.')
  } finally { cleanup() }
})
