'use strict'
// The assistant's Remix, brand identity, call-to-action and Avatar Studio tools,
// against fakes of the main modules they call (the real request checks are kept).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMain, tempDir, fakeElectron } = require('../zernio/support/load-main.cjs')

const RUN = '11111111-1111-4111-8111-111111111111'
const REMIX_RUN = `remix-${RUN}`
const CTA = 'a1b2c3d4e5f60718'
const BRAND = 'b1b2c3d4e5f60718'
const AVATAR = 'avatar0001'
const ctx = () => ({ conversationId: 'c', signal: new AbortController().signal })
const plain = (value) => JSON.parse(JSON.stringify(value))

function draft(id, patch = {}) {
  return {
    id, sourceIndex: 0, sourceTitle: 'The original', creator: 'Some Creator', startMs: 12000, endMs: 20000, quote: 'You must lose weight first.', why: 'Common myth',
    style: 'myth_truth', stance: 'disagree_correct', headline: `Take ${id} breaks the myth`, intro: 'Here is the truth.', beats: [{ text: 'Strength comes first.', broll: 'gym' }],
    close: 'Train the pull first.', notes: [], grade: { letter: id === 0 ? 'B' : 'A', score: id === 0 ? 7.5 : 9, verdict: 'Strong', fix: 'Shorter hook', edited: false },
    estimateUsd: 0.03, postCaption: 'My take.', format: 'commentary', cues: [], ...patch
  }
}

function status(patch = {}) {
  return { id: 'r1', phase: 'review', detail: 'Ready for review', percent: 100, folder: `/lib/${REMIX_RUN}`, estimateUsd: 0.06, drafts: [draft(0), draft(1)], outputs: [], costUsd: 0.12, warnings: [], error: null, ...patch }
}

function load(t) {
  const { dir, cleanup } = tempDir('creatorclips-studio-tools-')
  t.after(cleanup)
  const { electron } = fakeElectron(dir)
  // The real request checks, loaded on their own.
  const real = loadMain("export { parseRemixRequest } from './src/main/remix'; export { parseRenderRequest } from './src/main/avatar-studio'", { electron })
  const calls = { started: [], rendered: [], edited: [], recomposed: [], cta: [], cancelled: 0, saved: [], renders: [], scripts: [] }
  const state = {
    remix: null,
    brands: [],
    ctas: [{ id: CTA, name: 'Comment PLAN', kind: 'video', seconds: 6, path: '/secret/ctas/cta.mp4', createdAt: '2026-10-01T00:00:00Z' }],
    avatars: [{ id: AVATAR, name: 'Ava', kind: 'ai', description: '', voice: { provider: 'elevenlabs', voice: 'Brian' }, clonedVoice: null, consentAt: null, createdAt: '2026-10-01T00:00:00Z',
      portraitPath: '/secret/portrait.jpg', pictures: [{ file: 'p.jpg', path: '/secret/p.jpg', source: 'ai', createdAt: '', active: true, archivedReactions: 0 }],
      reactions: [{ id: 'nod', source: 'ai', path: '/secret/nod.mp4' }] }],
    render: null,
    renderCheck: null,
    outputs: {}
  }
  const remix = {
    parseRemixRequest: real.parseRemixRequest,
    remixStatus: () => state.remix,
    remixFolderInUse: () => null,
    remixStartEstimate: () => 0.4,
    remixRenderCheck: (edits) => state.renderCheck ?? { provider: 'openrouter', estimateUsd: state.remix.drafts.filter((d) => edits.some((e) => e.id === d.id)).reduce((sum, d) => sum + d.estimateUsd, 0) },
    startRemix: async (request) => { calls.started.push(request); state.remix = status({ phase: 'planning', percent: 1, drafts: [] }); return state.remix },
    renderRemix: async (edits) => { calls.rendered.push(edits); state.remix = status({ phase: 'rendering', percent: 1 }); return state.remix },
    editRemixDraft: (edit) => { calls.edited.push(edit); const next = { ...state.remix.drafts.find((d) => d.id === edit.id), ...edit }; return next },
    cancelRemix: () => { calls.cancelled += 1; return true },
    recomposeRemix: async (dir, index, edit) => { calls.recomposed.push({ dir, index, edit }); return null },
    listBrandIdentities: async () => state.brands,
    readBrandIdentity: async (id) => { const brand = state.brands.find((b) => b.id === id); if (!brand) throw new Error('That brand identity could not be found. Choose it again.'); return brand },
    saveBrandIdentity: async (value) => {
      calls.saved.push(value)
      if (String(value.text).trim().length < 40) throw new Error('Paste the brand identity: what the brand believes, its method and its proof.')
      const brand = { id: value.id ?? BRAND, name: value.name, text: value.text, createdAt: 'now', updatedAt: 'now' }
      state.brands = [brand, ...state.brands.filter((b) => b.id !== brand.id)]
      return state.brands
    }
  }
  const clip = (index, patch = {}) => ({ clip_index: index, summary: `Clip ${index}`, s3_url: `file:///lib/run/clip_0${index}.mp4`, duration_ms: 30000, start_time_ms: 0, end_time_ms: 30000, virality_score: 8, tags: [], layout_type: 'fill', cta: null, editable: null, remix_settings: null, headline: null, ...patch })
  state.outputs[RUN] = { job_id: RUN, source_video_title: 'Big podcast', source_video_channel: 'Pod Channel', source_video_url: 'https://www.youtube.com/watch?v=hqP9fivmBqI', total_clips: 2, clips: [clip(0), clip(1, { cta: { id: CTA, name: 'Comment PLAN' } })] }
  state.outputs[REMIX_RUN] = { job_id: REMIX_RUN, source_video_title: 'Remix', source_video_url: '', total_clips: 2, clips: [
    clip(0, { editable: { split: true }, remix_settings: { headline: 'Old hook text here', headline_look: { look: 'black', color: '#FFFFFF', font: 'clean' }, include_captions: true, caption_preset: 'pop', split: 0.45 }, cta: { id: CTA, name: 'Comment PLAN' } }),
    clip(1, { editable: null })
  ] }
  const mocks = {
    '../remix': remix,
    '../ctas': { listCtas: async () => state.ctas, applyRunCta: async (run, choice, indices) => { calls.cta.push({ run, choice, indices }); return { failed: [], cancelled: false } } },
    '../avatars': { listAvatars: async () => state.avatars, readAvatar: (id) => { const avatar = state.avatars.find((a) => a.id === id); if (!avatar) throw new Error('That avatar is no longer in your library.'); return avatar } },
    '../avatar-studio': {
      parseRenderRequest: real.parseRenderRequest,
      SCRIPT_ESTIMATE_USD: 0.01,
      renderSpendCheck: () => state.renderCheck ?? { provider: 'openrouter', estimateUsd: 0.12, openrouterUsd: 0.12 },
      avatarRenderStatus: () => state.render,
      startAvatarRender: async (request) => { calls.renders.push(request); state.render = { id: 'v1', avatarId: request.avatarId, phase: 'voice', detail: 'Recording the voiceover', percent: 1, outputPath: null, error: null, warning: null, estimatedCostUsd: 0.01, startedAt: 'now' }; return state.render },
      writeAvatarScript: async (request) => { calls.scripts.push(request); return { title: 'Lift first', scenes: [{ narration: 'Strength comes before weight loss.', visual: '', featuresAvatar: true }] } }
    },
    '../library-management': {
      setLibraryClipCta: async (dir, index, apply) => { await apply(dir, index); const out = structuredClone(state.outputs[path.basename(dir)]); out.clips[index].cta = calls.cta.at(-1).choice ? { id: CTA, name: 'Comment PLAN' } : null; return out },
      deleteLibraryClips: async () => ({}), deleteLibraryRun: async () => {}, setLibraryFavorite: async () => {}, setLibraryPosted: async () => {}
    },
    '../file-manager': { getJobOutput: async (dir) => state.outputs[path.basename(dir)] ?? null, getJobHistory: async () => [] }
  }
  const mod = loadMain("export * from './src/main/assistant/bridgeclip-tools'; export { validateToolInput } from './src/main/assistant/tool-input'; export { replaceApiKey, saveSpendLimit } from './src/main/settings-store'; export { recordSpend, flushSpending } from './src/main/spending'", { electron: { ...electron, dialog: {} }, ...mocks })
  const host = { changed: [], shown: [] }
  const tools = mod.createBridgeClipTools({ getMainWindow: () => null, dataChanged: (scope) => host.changed.push(scope), navigate: (page, runDir) => host.shown.push([page, runDir]) })
  const tool = (name) => { const found = tools.find((item) => item.name === name); assert.ok(found, name); return found }
  const valid = (name, input) => mod.validateToolInput(input, tool(name).inputSchema)
  return { mod, tools, tool, valid, host, state, calls, dir }
}

const NEW_TOOLS = ['list_brand_identities', 'get_brand_identity', 'save_brand_identity', 'list_ctas', 'set_clip_cta', 'get_remix_options', 'start_remix', 'get_remix_status',
  'list_remix_drafts', 'edit_remix_draft', 'make_remix_videos', 'cancel_remix', 'recompose_remix_video', 'list_avatars', 'write_avatar_script', 'start_avatar_video', 'get_avatar_video_status']

test('the new tools are listed with strict schemas; anything that spends, saves or replaces asks first', (t) => {
  const { tools, tool } = load(t)
  const names = tools.map((item) => item.name)
  for (const name of NEW_TOOLS) assert.ok(names.includes(name), name)
  assert.equal(new Set(names).size, names.length)
  for (const name of ['save_brand_identity', 'set_clip_cta', 'start_remix', 'make_remix_videos', 'cancel_remix', 'recompose_remix_video', 'write_avatar_script', 'start_avatar_video']) {
    assert.equal(typeof tool(name).confirm, 'function', `${name} asks first`)
    assert.notEqual(tool(name).readOnly, true, name)
  }
  for (const name of ['list_brand_identities', 'get_brand_identity', 'list_ctas', 'get_remix_options', 'get_remix_status', 'list_remix_drafts', 'list_avatars', 'get_avatar_video_status']) {
    assert.equal(tool(name).readOnly, true, name)
  }
  assert.equal(tool('recompose_remix_video').destructive, true, 'it replaces the video')
  // Never: adding files the member must choose, deleting brands or avatars, cloning voices.
  for (const forbidden of ['add_cta', 'remove_brand_identity', 'clone_voice', 'create_avatar', 'remove_avatar']) assert.ok(!names.includes(forbidden), forbidden)
})

test('schemas refuse ids that aren’t ids and values out of range', (t) => {
  const { valid } = load(t)
  assert.throws(() => valid('get_brand_identity', { brandIdentityId: '../../etc' }), /invalid format/)
  assert.throws(() => valid('set_clip_cta', { runId: RUN, clipIndex: 0, ctaId: '../x' }), /invalid format/)
  assert.doesNotThrow(() => valid('set_clip_cta', { runId: RUN, clipIndex: 0, ctaId: 'none' }))
  assert.doesNotThrow(() => valid('set_clip_cta', { runId: REMIX_RUN, clipIndex: 0, ctaId: CTA }), 'Remix runs are Library runs')
  assert.throws(() => valid('recompose_remix_video', { runId: RUN, clipIndex: 0 }), /invalid format/, 'only Remix runs are re-made')
  assert.throws(() => valid('recompose_remix_video', { runId: REMIX_RUN, clipIndex: 0, boxSize: 0.9 }), /at most 0.7/)
  assert.throws(() => valid('recompose_remix_video', { runId: REMIX_RUN, clipIndex: 0, hookLook: { look: 'neon' } }), /must be one of/)
  assert.throws(() => valid('start_remix', { sources: ['https://a.com/1'], count: 11 }), /at most 10/)
  assert.throws(() => valid('start_remix', { sources: ['https://a.com/1'], presenter: 'lipsync' }), /must be one of/, 'lip-sync isn’t available')
  assert.throws(() => valid('start_remix', { sources: Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`) }), /at most 10/)
  assert.throws(() => valid('start_remix', { sources: ['https://a.com'], surprise: true }), /Unknown field/)
  assert.throws(() => valid('edit_remix_draft', { draftId: 0, beats: ['a', 'b', 'c', 'd', 'e'] }), /at most 4/)
  assert.throws(() => valid('start_avatar_video', { avatarId: 'A!', style: 'talking', script: { title: 'x', scenes: [{ narration: 'hi' }] } }), /invalid format/)
  assert.throws(() => valid('write_avatar_script', { topic: 'lifting', seconds: 20 }), /must be one of/)
  assert.throws(() => valid('save_brand_identity', { name: 'Brand', text: 'too short' }), /must not be empty/)
})

test('brand identities: nothing saved explains how, saving asks first and reads back summarized', async (t) => {
  const { tool, calls } = load(t)
  const empty = await tool('list_brand_identities').run({}, ctx())
  assert.deepEqual(empty.brands, [])
  assert.match(empty.note, /never invent/)
  assert.match(empty.template, /^BRAND: \[name\]/)
  const text = 'BRAND: Lift Lab\nWHO WE HELP: busy parents\nWHAT WE BELIEVE (3)\n1. Belief: strength first\nVOICE\n- Tone: direct\nCALL TO ACTION: "Comment PLAN for the free plan"'
  const lines = await tool('save_brand_identity').confirm({ name: 'Lift Lab', text })
  assert.match(lines[0], /Save a new brand identity “Lift Lab”/)
  assert.match(lines[1], /keyword PLAN/)
  await assert.rejects(tool('save_brand_identity').confirm({ name: 'Lift Lab', text: 'x'.repeat(10) }), /too short/)
  await assert.rejects(tool('save_brand_identity').confirm({ brandIdentityId: 'ffffffffffffffff', name: 'Lift Lab', text }), /could not be found/)
  const saved = await tool('save_brand_identity').run({ name: 'Lift Lab', text }, ctx())
  assert.equal(saved.brandIdentityId, BRAND)
  assert.equal(calls.saved.length, 1)
  const replace = await tool('save_brand_identity').confirm({ brandIdentityId: BRAND, name: 'Lift Lab 2', text })
  assert.match(replace[0], /Replace the brand identity “Lift Lab”, renamed “Lift Lab 2”/)
  const listed = await tool('list_brand_identities').run({}, ctx())
  assert.deepEqual(plain(listed.brands[0]), { brandIdentityId: BRAND, name: 'Lift Lab', characters: text.length, updatedAt: 'now', ctaKeyword: 'PLAN', firstLine: 'BRAND: Lift Lab' })
  const read = await tool('get_brand_identity').run({ brandIdentityId: BRAND, maxChars: 500 }, ctx())
  assert.deepEqual(plain(read.sections), ['BRAND', 'WHO WE HELP', 'WHAT WE BELIEVE', 'VOICE', 'CALL TO ACTION'])
  assert.equal(read.truncated, false)
})

test('calls to action: listed without file paths; changing a clip’s asks first and uses the Library function', async (t) => {
  const { tool, calls, host, state, dir } = load(t)
  const list = await tool('list_ctas').run({}, ctx())
  assert.deepEqual(plain(list.ctas), [{ ctaId: CTA, name: 'Comment PLAN', kind: 'video', seconds: 6, createdAt: '2026-10-01T00:00:00Z' }])
  assert.ok(!JSON.stringify(list).includes('/secret'), 'no file paths')
  const add = await tool('set_clip_cta').confirm({ runId: RUN, clipIndex: 0, ctaId: CTA })
  assert.match(add[0], /Add “Comment PLAN” \(video, 6s\) to the end of “Clip 0”/)
  await assert.rejects(tool('set_clip_cta').confirm({ runId: RUN, clipIndex: 1, ctaId: CTA }), /already ends with/)
  await assert.rejects(tool('set_clip_cta').confirm({ runId: RUN, clipIndex: 0, ctaId: 'none' }), /nothing to remove/)
  await assert.rejects(tool('set_clip_cta').confirm({ runId: RUN, clipIndex: 0, ctaId: 'ffffffffffffffff' }), /list_ctas/)
  await assert.rejects(tool('set_clip_cta').confirm({ runId: RUN, clipIndex: 7, ctaId: CTA }), /clipIndex/)
  const result = await tool('set_clip_cta').run({ runId: RUN, clipIndex: 0, ctaId: CTA }, ctx())
  assert.deepEqual(plain(result.callToAction), { ctaId: CTA, name: 'Comment PLAN' })
  assert.equal(calls.cta[0].choice, CTA)
  assert.deepEqual(calls.cta[0].indices, [0])
  assert.ok(calls.cta[0].run.startsWith(dir) && calls.cta[0].run.endsWith(RUN), 'inside the Library folder')
  assert.deepEqual(host.changed, ['library'])
  const removed = await tool('set_clip_cta').run({ runId: RUN, clipIndex: 1, ctaId: 'none' }, ctx())
  assert.equal(removed.callToAction, null)
  assert.equal(calls.cta[1].choice, null)
  state.ctas = []
  assert.match((await tool('list_ctas').run({}, ctx())).note, /Add call to action/)
})

test('start_remix: shows the estimate and the promises it makes, then starts with the Remix page’s request', async (t) => {
  const { mod, tool, calls, state } = load(t)
  const input = { sources: ['https://www.youtube.com/watch?v=hqP9fivmBqI'], style: 'myth_truth', count: 2, ctaKeyword: 'plan', ctaOffer: 'my free plan' }
  await assert.rejects(tool('start_remix').confirm(input), /No OpenRouter key/)
  mod.replaceApiKey('openrouterApiKey', 'sk-or-test')
  const lines = await tool('start_remix').confirm(input)
  const text = lines.join('\n')
  assert.match(text, /Video: https:\/\/www\.youtube\.com/)
  assert.match(text, /Voiced take · Myth vs\. truth · Moment first · 2 takes per video/)
  assert.match(text, /Ava’s photo · Ava’s own voice/)
  assert.match(text, /Comment PLAN and I'll send you my free plan/)
  assert.match(text, /about \$0\.35 per hour of video/)
  assert.match(text, /\$0\.03 to make/)
  assert.match(text, /AI-content label/)
  assert.ok(!/replaces/.test(text), 'nothing waiting for review')
  const started = await tool('start_remix').run(input, ctx())
  assert.equal(started.started, true)
  assert.equal(started.phase, 'planning')
  assert.deepEqual(plain(calls.started[0]), {
    sources: input.sources, creator: '', angle: 'myth_truth', order: 'moment_first', host: 'still', avatarId: AVATAR, voice: 'avatar', brandIdentityId: null, count: 2,
    captionPreset: 'pop', includeCaptions: true, aiLabelAck: true, clipRightsAck: false, ctaKeyword: 'PLAN', ctaOffer: 'my free plan', format: 'commentary',
    headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }
  })
  // While it plans, another can't start.
  await assert.rejects(tool('start_remix').confirm(input), /already being planned/)
  // Waiting for review: starting again says it replaces those takes.
  state.remix = status()
  assert.match((await tool('start_remix').confirm(input)).join('\n'), /replaces the 2 takes waiting for review/)
})

test('start_remix: Silent react confirms clip rights; no avatars falls back to a preset voice or explains', async (t) => {
  const { mod, tool, state, calls } = load(t)
  mod.replaceApiKey('openrouterApiKey', 'sk-or-test')
  const silent = (await tool('start_remix').confirm({ sources: ['https://a.com/v'], format: 'silent' })).join('\n')
  assert.match(silent, /Ava’s reactions, behind the moment/)
  assert.match(silent, /allowed to use these clips/)
  assert.match(silent, /free: the avatar’s reactions are reused/)
  state.avatars = []
  await assert.rejects(tool('start_remix').confirm({ sources: ['https://a.com/v'] }), /no avatars yet/)
  const voiceOnly = (await tool('start_remix').confirm({ sources: ['https://a.com/v'], presenter: 'voice' })).join('\n')
  assert.match(voiceOnly, /Voice-over only · Brian \(preset\)/)
  await tool('start_remix').run({ sources: ['https://a.com/v'], presenter: 'voice' }, ctx())
  assert.deepEqual([calls.started[0].avatarId, calls.started[0].voice], [null, 'Brian'])
  state.remix = null
  // The Remix request checks still apply (a bad keyword, a missing call to action).
  await assert.rejects(tool('start_remix').confirm({ sources: ['https://a.com/v'], presenter: 'voice', ctaKeyword: 'two words' }), /one word/)
  await assert.rejects(tool('start_remix').confirm({ sources: ['https://a.com/v'], presenter: 'voice', ctaId: 'ffffffffffffffff' }), /list_ctas/)
  await assert.rejects(tool('start_remix').confirm({}), /video links/)
  await assert.rejects(tool('start_remix').confirm({ sources: ['https://a.com/v'], runId: RUN, clipIndex: 0 }), /not both/)
})

test('start_remix from a Library clip credits its channel and uses the clip file', async (t) => {
  const { mod, tool, calls, state, dir } = load(t)
  mod.replaceApiKey('openrouterApiKey', 'sk-or-test')
  const run = path.join(dir, 'home', 'CreatorClips', RUN)
  fs.mkdirSync(run, { recursive: true })
  const file = path.join(run, 'clip_00.mp4')
  fs.writeFileSync(file, 'x')
  state.outputs[RUN].clips[0].s3_url = `file://${file}`
  const lines = await tool('start_remix').confirm({ runId: RUN, clipIndex: 0, presenter: 'voice', voice: 'Sarah' })
  assert.match(lines[0], /Library clip: “Clip 0” from “Big podcast”/)
  await tool('start_remix').run({ runId: RUN, clipIndex: 0, presenter: 'voice', voice: 'Sarah' }, ctx())
  assert.deepEqual([calls.started[0].sources[0], calls.started[0].creator], [file, 'Pod Channel'])
  state.remix = null
  state.outputs[RUN].source_video_channel = null
  await assert.rejects(tool('start_remix').confirm({ runId: RUN, clipIndex: 0, presenter: 'voice' }), /who made the original video/)
})

test('recording flows (Me, on camera; Article or post) open Remix instead of starting', async (t) => {
  const { tool, host, calls } = load(t)
  for (const input of [{ sources: ['https://a.com/v'], presenter: 'camera' }, { format: 'image' }]) {
    assert.equal(await tool('start_remix').confirm(input), null, 'nothing is spent, so no approval')
    const result = await tool('start_remix').run(input, ctx())
    assert.equal(result.started, false)
    assert.equal(result.needsMember, true)
    assert.match(result.message, /Remix is open/)
  }
  assert.deepEqual(host.shown, [['remix', undefined], ['remix', undefined]])
  assert.equal(calls.started.length, 0)
})

test('remix status, drafts, edits and making: plain when there is nothing, best grade first, paid making asks first', async (t) => {
  const { tool, state, calls, host } = load(t)
  assert.equal((await tool('get_remix_status').run({}, ctx())).phase, 'none')
  assert.deepEqual((await tool('list_remix_drafts').run({}, ctx())).drafts, [])
  assert.throws(() => tool('make_remix_videos').confirm({ draftIds: [0] }), /no takes waiting/)
  await assert.rejects(tool('edit_remix_draft').run({ draftId: 0, headline: 'New one here' }, ctx()), /no takes waiting/)
  assert.throws(() => tool('cancel_remix').confirm({}), /No remix is being planned/)

  state.remix = status()
  const drafts = await tool('list_remix_drafts').run({}, ctx())
  assert.deepEqual(drafts.drafts.map((item) => item.draftId), [1, 0], 'best grade first')
  assert.deepEqual(plain(drafts.drafts[0].grade), { letter: 'A', score: 9, verdict: 'Strong', fix: 'Shorter hook', gradedBeforeEdits: false })
  assert.deepEqual(plain(drafts.drafts[0].beats), ['Strength comes first.'])
  assert.equal(drafts.drafts[0].style, 'Myth vs. truth')
  const brief = await tool('list_remix_drafts').run({ brief: true }, ctx())
  assert.equal('intro' in brief.drafts[0], false)

  // Edits: only what changed, beats keep their B-roll; spoken lines refused on a silent take.
  await tool('edit_remix_draft').run({ draftId: 0, headline: 'Lose weight first? Not true', beats: ['Strength comes first, always.'] }, ctx())
  assert.deepEqual(plain(calls.edited[0]), { id: 0, headline: 'Lose weight first? Not true', beats: [{ text: 'Strength comes first, always.', broll: 'gym' }] })
  await assert.rejects(tool('edit_remix_draft').run({ draftId: 9, headline: 'x y z' }, ctx()), /draftId 9/)
  await assert.rejects(tool('edit_remix_draft').run({ draftId: 0 }, ctx()), /Nothing to change/)
  state.remix = status({ drafts: [draft(0, { format: 'silent', intro: '', beats: [], close: '' })] })
  await assert.rejects(tool('edit_remix_draft').run({ draftId: 0, intro: 'Hello there' }, ctx()), /no spoken lines/)

  state.remix = status()
  const lines = tool('make_remix_videos').confirm({ draftIds: [1] })
  assert.deepEqual(lines, ['Make 1 video:', '• A · “Take 1 breaks the myth”', 'Uses your OpenRouter credit: about $0.03 in all.', 'The other 1 take won’t be made.'])
  assert.throws(() => tool('make_remix_videos').confirm({ draftIds: [5] }), /draftId 5/)
  const made = await tool('make_remix_videos').run({ draftIds: [1] }, ctx())
  assert.equal(made.phase, 'rendering')
  assert.deepEqual(plain(calls.rendered[0]), [{ id: 1, headline: 'Take 1 breaks the myth', intro: 'Here is the truth.', beats: [{ text: 'Strength comes first.', broll: 'gym' }], close: 'Train the pull first.', postCaption: 'My take.' }])
  assert.match(tool('cancel_remix').confirm({})[0], /making videos/)
  await tool('cancel_remix').run({}, ctx())
  assert.equal(calls.cancelled, 1)

  // On camera: the member records first, so making opens Remix.
  state.remix = status({ onCamera: true })
  assert.equal(tool('make_remix_videos').confirm({ draftIds: [0] }), null)
  assert.equal((await tool('make_remix_videos').run({ draftIds: [0] }, ctx())).needsMember, true)
  assert.deepEqual(host.shown.at(-1), ['remix', undefined])
  assert.equal(calls.rendered.length, 1)

  // Done: the videos and their Library run, without file paths.
  state.remix = status({ phase: 'done', drafts: [], outputs: [{ path: `/lib/${REMIX_RUN}/clip_03.mp4`, manifestPath: '/lib/m.json', headline: 'Hook', stance: 'add_nuance', excerptSeconds: 4, durationSeconds: 31.4, costUsd: 0.034, checks: [], warnings: [], style: 'science', grade: 'A', creator: 'X', postCaption: '' }] })
  const done = await tool('get_remix_status').run({ waitSeconds: 1 }, ctx())
  assert.equal(done.runId, REMIX_RUN)
  assert.deepEqual(plain(done.videos[0]), { clipIndex: 3, headline: 'Hook', style: 'The science behind it', stance: 'Adds nuance', grade: 'A', durationSeconds: 31, costUsd: 0.03, warnings: [] })
  assert.ok(!JSON.stringify(done).includes('/lib/'), 'no file paths')
})

test('recompose_remix_video: keeps what isn’t changed, says what is, and is refused for old videos', async (t) => {
  const { tool, calls, host } = load(t)
  const lines = await tool('recompose_remix_video').confirm({ runId: REMIX_RUN, clipIndex: 0, hookText: 'Lose weight first? Not true', boxSize: 0.6 })
  assert.match(lines[0], /Re-make “Clip 0”\. It replaces the current video/)
  assert.ok(lines.includes('Hook text: “Old hook text here” → “Lose weight first? Not true”'))
  assert.ok(lines.includes('Clip box: 45% → 60% of the height'))
  assert.ok(lines.some((line) => /call to action “Comment PLAN” is added back/.test(line)))
  assert.ok(lines.some((line) => /no AI cost/.test(line)))
  await assert.rejects(tool('recompose_remix_video').confirm({ runId: REMIX_RUN, clipIndex: 0 }), /Nothing to change/)
  await assert.rejects(tool('recompose_remix_video').confirm({ runId: REMIX_RUN, clipIndex: 1, hookText: 'A new hook here' }), /before re-editing was possible/)
  await assert.rejects(tool('recompose_remix_video').confirm({ runId: REMIX_RUN, clipIndex: 0, hookText: 'Too short' }), /at least 3 words/)
  const result = await tool('recompose_remix_video').run({ runId: REMIX_RUN, clipIndex: 0, captions: false }, ctx())
  assert.equal(result.remade, true)
  assert.equal(path.basename(calls.recomposed[0].dir), REMIX_RUN)
  assert.deepEqual(plain(calls.recomposed[0].edit), { headline: 'Old hook text here', headlineLook: { look: 'black', color: '#FFFFFF', font: 'clean' }, includeCaptions: false, captionPreset: 'pop', split: 0.45 })
  assert.deepEqual(host.changed, ['library'])
})

test('avatars: readiness without file paths; scripts and videos ask first with the estimate', async (t) => {
  const { mod, tool, calls, state } = load(t)
  const listed = await tool('list_avatars').run({}, ctx())
  assert.ok(!JSON.stringify(listed).includes('/secret'), 'no file paths')
  const ava = listed.avatars[0]
  assert.deepEqual(plain(ava.reactions.made), ['Nodding'])
  assert.equal(ava.reactions.missing.length, 5)
  assert.deepEqual(plain(ava.readyFor), { avatarVideo: true, remixPresenter: true, silentReact: true })
  assert.equal(ava.voice, 'Brian (preset)')

  const script = { title: 'Lift first', scenes: [{ narration: 'Strength comes before weight loss. Here is why.' }] }
  await assert.rejects(tool('start_avatar_video').confirm({ avatarId: AVATAR, style: 'talking', script }), /No OpenRouter key/)
  await assert.rejects(Promise.resolve().then(() => tool('write_avatar_script').confirm({ topic: 'lifting' })), /No OpenRouter key/)
  mod.replaceApiKey('openrouterApiKey', 'sk-or-test')
  assert.match((await tool('write_avatar_script').confirm({ topic: 'lifting first', seconds: 15 }))[0], /15-second talking-head script about “lifting first”/)
  const written = await tool('write_avatar_script').run({ topic: 'lifting first' }, ctx())
  assert.equal(written.script.title, 'Lift first')
  assert.deepEqual(plain(calls.scripts[0]), { topic: 'lifting first', niche: '', seconds: 30, style: 'talking', brandIdentityId: null })

  const lines = await tool('start_avatar_video').confirm({ avatarId: AVATAR, style: 'talking', script })
  assert.match(lines[0], /talking-head video with Ava/)
  assert.match(lines.join('\n'), /Estimated cost about \$0\.\d\d on OpenRouter/)
  await assert.rejects(tool('start_avatar_video').confirm({ avatarId: 'nobody0000', style: 'talking', script }), /list_avatars/)
  await assert.rejects(tool('start_avatar_video').confirm({ avatarId: AVATAR, style: 'cinematic', script }), /Describe what scene 1 shows/)
  const started = await tool('start_avatar_video').run({ avatarId: AVATAR, style: 'talking', script: { title: 'Lift first', scenes: [{ narration: 'One.' }, { narration: 'Two.' }] } }, ctx())
  assert.equal(started.started, true)
  assert.deepEqual(plain(calls.renders[0].script.scenes), [{ narration: 'One. Two.', visual: '', featuresAvatar: true }], 'a talking head is one scene')
  await assert.rejects(tool('start_avatar_video').confirm({ avatarId: AVATAR, style: 'talking', script }), /already being made/)
  state.render = { ...state.render, phase: 'done', percent: 100, outputPath: '/secret/Avatar Studio/x/final.mp4' }
  const done = await tool('get_avatar_video_status').run({}, ctx())
  assert.deepEqual([done.phase, done.file, done.avatar, done.running], ['done', 'final.mp4', 'Ava', false])
  assert.ok(!JSON.stringify(done).includes('/secret'))
  state.avatars = []
  assert.match((await tool('list_avatars').run({}, ctx())).note, /Avatar Studio/)
})

test('show_in_bridgeclip can open Remix and Avatar Studio', async (t) => {
  const { tool, host } = load(t)
  await tool('show_in_bridgeclip').run({ page: 'remix' }, ctx())
  await tool('show_in_bridgeclip').run({ page: 'avatar' }, ctx())
  assert.deepEqual(host.shown, [['remix', undefined], ['avatar', undefined]])
})

test('paid chat tools pass the same spending check as the app’s pages: the monthly limit stops them before anything is spent', async (t) => {
  const { mod, tool, state, calls } = load(t)
  mod.replaceApiKey('openrouterApiKey', 'sk-or-test')
  await mod.recordSpend({ kind: 'remix', provider: 'openrouter', usd: 5, label: 'Remix videos' })
  mod.saveSpendLimit('5')
  const script = { title: 'Lift first', scenes: [{ narration: 'Strength comes before weight loss.' }] }
  await assert.rejects(tool('start_remix').run({ sources: ['https://www.youtube.com/watch?v=hqP9fivmBqI'] }, ctx()), /monthly AI spending limit of \$5\.00/)
  assert.equal(calls.started.length, 0)
  await assert.rejects(tool('write_avatar_script').run({ topic: 'lifting first' }, ctx()), /monthly AI spending limit/)
  assert.equal(calls.scripts.length, 0)
  await assert.rejects(tool('start_avatar_video').run({ avatarId: AVATAR, style: 'talking', script }, ctx()), /monthly AI spending limit/)
  assert.equal(calls.renders.length, 0)
  state.remix = status()
  await assert.rejects(tool('make_remix_videos').run({ draftIds: [1] }, ctx()), /monthly AI spending limit/)
  assert.equal(calls.rendered.length, 0)
  // Raised: they go ahead.
  mod.saveSpendLimit('')
  assert.equal((await tool('make_remix_videos').run({ draftIds: [1] }, ctx())).started, true)
})

test('a HeyGen avatar’s video is priced and billed on HeyGen in the chat’s confirmation, as in Avatar Studio and Remix', async (t) => {
  const { mod, tool, state } = load(t)
  const script = { title: 'Lift first', scenes: [{ narration: 'Strength comes before weight loss.' }] }
  // HeyGen speaks in its own voice: no OpenRouter key needed, billed on HeyGen.
  state.renderCheck = { provider: 'heygen', estimateUsd: 1, openrouterUsd: null }
  assert.match((await tool('start_avatar_video').confirm({ avatarId: AVATAR, style: 'talking', script })).join('\n'), /about \$1\.00 on your HeyGen account/)
  mod.replaceApiKey('openrouterApiKey', 'sk-or-test')
  state.renderCheck = { provider: 'openrouter', estimateUsd: 1.05, openrouterUsd: 0.05 }
  assert.match((await tool('start_avatar_video').confirm({ avatarId: AVATAR, style: 'talking', script })).join('\n'), /about \$1\.05: \$0\.05 on OpenRouter for the voice, the rest on your HeyGen account/)
  state.renderCheck = { provider: 'heygen', estimateUsd: null, openrouterUsd: null }
  assert.match((await tool('start_avatar_video').confirm({ avatarId: AVATAR, style: 'talking', script })).join('\n'), /billed on your HeyGen account at HeyGen’s own price/)
  // Remix with Avatar on camera.
  state.remix = status()
  state.renderCheck = { provider: 'openrouter', estimateUsd: 1.2, openrouterUsd: 0.2 }
  assert.match(tool('make_remix_videos').confirm({ draftIds: [1] }).join('\n'), /About \$1\.20 in all: \$0\.20 of OpenRouter credit for the voice, the rest on your HeyGen account/)
})
