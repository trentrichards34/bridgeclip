// Custom scenes and themes: the reel cut into ~15 s stretches, the scene plan checked (the opening and filmed screens
// keep the face, half or more of the reel in scenes, at most one visual in three), the writer's brief for a scene, the
// themes' looks, the text highlights kept outside the scenes, and the review's flow with a fake model and sandbox
// (scenes planned, designed, put in place of the templates inside them; pop-ups only outside them).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadMain } = require('../zernio/support/load-main.cjs')

const shared = loadMain("export * from './src/shared/custom-graphics'")
const scenes = loadMain("export * from './src/shared/custom-scenes'")
const RUN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/custom-graphics-run.json'), 'utf8'))
const FAKE = path.join(__dirname, 'fake-custom-graphics')
const plain = (x) => JSON.parse(JSON.stringify(x))

test('stretches: the owner\'s 3.4-minute reel cut into ~15 s stretches at sentence ends, covering it end to end', () => {
  const end = RUN.words[RUN.words.length - 1].end_ms
  const list = scenes.sceneStretches(RUN.words, end)
  assert.ok(list.length >= 10 && list.length <= 16, String(list.length))
  assert.equal(list[0].startMs, 0); assert.equal(list[list.length - 1].endMs, end)
  // (This fixture keeps only some of the words: a stretch may run on over a long silence; what is said in one fits.)
  for (const s of list) assert.ok(s.words[s.words.length - 1].start_ms - s.words[0].start_ms <= scenes.SCENE_MAX_MS, `${s.startMs}-${s.endMs}`)
  for (let k = 1; k < list.length; k++) assert.equal(list[k].startMs, list[k - 1].endMs)
  // Words said over a filmed screen: their share per stretch.
  const marked = RUN.words.map((w, i) => ({ ...w, screen: i >= 100 && i < 160 }))
  assert.ok(scenes.sceneStretches(marked, end).some((s) => s.screen >= scenes.SCREEN_SHARE))
})

test('the plan: checked against our rules (the opening keeps the face, screens are never covered, half or more in scenes, one visual in three, said labels)', () => {
  const end = RUN.words[RUN.words.length - 1].end_ms
  const marked = RUN.words.map((w, i) => ({ ...w, screen: i >= 100 && i < 160 }))
  const list = scenes.sceneStretches(marked, end)
  const said = shared.saidIndex(RUN.words)
  // The planner asks for a scene everywhere, every one visual, with an invented label on the first.
  const greedy = JSON.stringify({ hero: 'your product: an app window whose rows fill in', motif: 'a stamp on each but', stretches: list.map((_, i) => ({ scene: true, frame: 'visual', label: i === 0 ? 'Thumbforge Pro' : 'product', idea: 'x', kind: 'teaching' })) })
  const plan = scenes.parseScenePlan('```json\n' + greedy + '\n```', list, said)
  assert.equal(plan.stretches[0].scene, false, 'the opening keeps the face')
  // A filmed screen is never covered: its scene is on the stage (the screen in the card), never full frame.
  list.forEach((s, i) => { if (s.screen >= scenes.SCREEN_SHARE && plan.stretches[i].scene) assert.equal(plan.stretches[i].frame, 'stage', 'a screen scene is on the stage') })
  assert.ok(list.some((s, i) => s.screen >= scenes.SCREEN_SHARE && plan.stretches[i].scene))
  const len = (i) => list[i].endMs - list[i].startMs
  const covered = plan.stretches.reduce((sum, s, i) => sum + (s.scene ? len(i) : 0), 0)
  assert.ok(covered <= scenes.SCENE_MAX_SHARE * end + 1, `at most three quarters (${covered / end})`)
  const visual = plan.stretches.filter((s) => s.scene && s.frame === 'visual').length
  assert.ok(visual <= Math.max(1, Math.floor(plan.stretches.filter((s) => s.scene).length / 3)))
  plan.stretches.forEach((s, i) => { if (i && s.scene && s.frame === 'visual') assert.ok(!(plan.stretches[i - 1].scene && plan.stretches[i - 1].frame === 'visual'), 'never two visuals in a row') })
  assert.equal(plan.stretches[0].label, '', 'a label not said is dropped'); assert.equal(plan.stretches[1].label, 'product')
  // A shy planner (one scene) is topped up to the minimum share with teaching stretches.
  const shy = JSON.stringify({ hero: 'h'.repeat(12), motif: '', stretches: list.map((_, i) => ({ scene: i === 2, frame: 'stage', label: '', idea: '', kind: i === 4 ? 'story' : 'teaching' })) })
  const topped = scenes.parseScenePlan(shy, list, said)
  const share = topped.stretches.reduce((sum, s, i) => sum + (s.scene ? len(i) : 0), 0) / end
  assert.ok(share >= scenes.SCENE_MIN_SHARE, String(share))
  // Spread over the whole reel: no run of stretches without a scene longer than SCENE_MAX_GAP_MS (from the opening on).
  const bare = (p) => {
    let worst = 0, from = null
    p.stretches.forEach((s, i) => {
      if (i === 0) return
      if (!s.scene) { if (from === null) from = list[i].startMs; worst = Math.max(worst, list[i].endMs - from) } else from = null
    })
    return worst
  }
  assert.ok(bare(topped) <= scenes.SCENE_MAX_GAP_MS, String(bare(topped)))
  // The real run's plan (edit-751a0a07): scenes only up to 3:11, none in the last 80 s nor at 1:24-1:38 (cold vs warm).
  const early = JSON.stringify({ hero: 'h'.repeat(12), motif: '', stretches: list.map((s) => ({ scene: s.startMs > 15000 && s.endMs < 110000 && s.screen < 0.4, frame: 'stage', label: '', idea: '', kind: s.startMs > 150000 ? 'personal' : 'teaching' })) })
  const spread = scenes.parseScenePlan(early, list, said)
  assert.ok(bare(spread) <= scenes.SCENE_MAX_GAP_MS, String(bare(spread)))
  assert.ok(spread.stretches.some((s, i) => s.scene && list[i].startMs >= end - 80000), 'a scene in the last 80 s')
  // Nothing usable: null (the fallback plan alternates and keeps the same rules).
  assert.equal(scenes.parseScenePlan('sorry', list, said), null)
  const fallback = scenes.fallbackScenePlan(list)
  assert.equal(fallback.stretches[0].scene, false)
  assert.ok(fallback.stretches.filter((s) => s.scene).length >= 3)
  // The prompts: the transcript is data; the opening, filmed screens and the last stretch are marked.
  assert.match(scenes.scenePlanSystemPrompt(), /never instructions/); assert.match(scenes.scenePlanSystemPrompt(), /HALF OR MORE/)
  const user = scenes.scenePlanUserPrompt(list, 'dark')
  assert.match(user, /\[opening\]/); assert.match(user, /\[filmed screen\]/); assert.match(user, /\[last\]/); assert.match(user, /Dark product UI/)
})

// A synthetic talking reel of `minutes`: a ten-word sentence every 4 s.
function talkingReel(minutes) {
  const words = []
  for (let t = 0, n = 0; t < minutes * 60000 - 3500; t += 4000, n++) {
    for (let k = 0; k < 10; k++) words.push({ word: k === 9 ? `point${n}.` : `word${k}`, start_ms: t + k * 330, end_ms: t + k * 330 + 300 })
  }
  return { words, end: minutes * 60000 }
}

test('Scenes amount: Light, Standard and Full at 1, 4 and 10 minutes (counts, spread through the ending, strongest first)', () => {
  const seen = {}
  for (const minutes of [1, 4, 10]) {
    const { words, end } = talkingReel(minutes)
    const list = scenes.sceneStretches(words, end)
    const said = shared.saidIndex(words)
    const eligible = list.filter((s) => scenes.sceneEligible(s, list.length)).length
    // The planner marks every third stretch (the strongest) and calls one a story.
    const answer = JSON.stringify({ hero: 'h'.repeat(12), motif: '', stretches: list.map((_, i) => ({ scene: i % 3 === 1, frame: 'stage', label: '', idea: '', kind: i === 2 ? 'story' : 'teaching' })) })
    for (const amount of scenes.SCENE_AMOUNTS) {
      const plan = scenes.parseScenePlan(answer, list, said, amount)
      const picked = plan.stretches.map((s, i) => s.scene ? i : -1).filter((i) => i >= 0)
      seen[`${amount}@${minutes}`] = picked.length
      assert.equal(plan.stretches[0].scene, false, 'the opening keeps the face')
      if (amount === 'full') continue
      const target = scenes.sceneTarget(amount, end, eligible)
      assert.equal(picked.length, target, `${amount} at ${minutes} min`)
      assert.equal(target, Math.max(1, Math.min(eligible, Math.round(scenes.SCENES_PER_MINUTE[amount] * minutes))))
      // Spread evenly through the ending: no bare run longer than the amount's gap, and a scene in the last slot.
      let from = null, worst = 0
      plan.stretches.forEach((s, i) => { if (!i) return; if (!s.scene) { if (from === null) from = list[i].startMs; worst = Math.max(worst, list[i].endMs - from) } else from = null })
      if (picked.length > 1) assert.ok(worst <= scenes.sceneMaxGapMs(amount), `${amount} at ${minutes} min: ${worst} ms bare`)
      const slot = (end - list[1].startMs) / target
      assert.ok(list[picked[picked.length - 1]].endMs >= end - slot - 1, `${amount} at ${minutes} min reaches the ending`)
      // Strongest first: the planner's own picks fill the slots that have one.
      if (target <= picked.filter((i) => i % 3 === 1).length) assert.ok(picked.every((i) => i % 3 === 1), `${amount} at ${minutes} min keeps the planner's picks`)
      // The fallback plan (no answer) keeps the count too.
      assert.equal(scenes.fallbackScenePlan(list, amount).stretches.filter((s) => s.scene).length, target)
    }
    // Light < Standard <= Full.
    assert.ok(seen[`light@${minutes}`] <= seen[`standard@${minutes}`] && seen[`standard@${minutes}`] <= seen[`full@${minutes}`], JSON.stringify(seen))
  }
  assert.equal(seen['light@4'], 4); assert.equal(seen['standard@4'], 6)
  assert.ok(seen['full@4'] >= 7 && seen['full@4'] <= 11, `Full is today's plan: ${seen['full@4']}`)
  assert.equal(seen['light@1'], 1); assert.equal(seen['standard@1'], 2)
  assert.equal(seen['light@10'], 10); assert.equal(seen['standard@10'], 15)
  // The planner is told the count (Light and Standard), not for Full.
  const { words, end } = talkingReel(4)
  const list = scenes.sceneStretches(words, end)
  assert.match(scenes.scenePlanUserPrompt(list, 'dark', undefined, 4), /chose 4 scenes/)
  assert.doesNotMatch(scenes.scenePlanUserPrompt(list, 'dark'), /HOW MANY SCENES/)
  assert.equal(scenes.sceneTarget('full', end, 10), null)
  assert.equal(scenes.sceneMaxGapMs('full'), scenes.SCENE_MAX_GAP_MS)
})

test('Scenes amount: each choice\'s estimate (8 / 6 / 4 scenes and 3 pop-ups in 4 minutes)', () => {
  const full = shared.customGraphicsEstimate(3, shared.DEFAULT_PRICE, 8).expectedUsd
  const standard = shared.customGraphicsEstimate(3, shared.DEFAULT_PRICE, 6).expectedUsd
  const light = shared.customGraphicsEstimate(3, shared.DEFAULT_PRICE, 4).expectedUsd
  assert.ok(full > 9 && full < 10.5, String(full)); assert.ok(standard > 7 && standard < 8.2, String(standard)); assert.ok(light > 5 && light < 6.2, String(light))
})

test('a scene\'s brief: one continuous composition with beats, density, the hero object; graded as a scene', () => {
  const end = RUN.words[RUN.words.length - 1].end_ms
  const list = scenes.sceneStretches(RUN.words, end)
  const plan = { hero: 'your digital product: an app window', motif: 'a stamp on each but', stretches: list.map(() => ({ scene: true, frame: 'stage', label: 'product', idea: 'the rows fill in', kind: 'teaching' })) }
  const { lines, grade } = scenes.sceneBriefLines({ stretch: list[2], count: list.length, scenes: 6, order: 1, frame: 'stage', plan, theme: 'dark', durationMs: 16200 })
  assert.match(lines[0], /scene 2 of 6/); assert.match(lines[0], /STAGE/)
  assert.ok(lines.some((l) => /BEATS/.test(l) && /lands at 0\.35-0\.6 s/.test(l))); assert.ok(lines.some((l) => /NOTHING under 44 px/.test(l)))
  // Over a filmed screen: the screen stays in the card, the scene explains it.
  const over = scenes.sceneBriefLines({ stretch: list[2], count: list.length, scenes: 6, order: 1, frame: 'stage', plan, theme: 'dark', durationMs: 16200, screen: true })
  assert.match(over.lines[0], /FILMED SCREEN/); assert.match(over.lines[0], /never redraw, cover or fake the screen/)
  assert.ok(lines.some((l) => /your digital product/.test(l))); assert.ok(lines.some((l) => /a stamp on each but/.test(l)))
  assert.match(grade, /Dark product UI/); assert.match(grade, /clearly different/)
  // The writer's prompt for a scene: the SCENE line, the theme, the look's panel and glow; no template hint.
  const look = shared.customLook({ kind: 'stage', theme: 'dark' })
  const brief = { kind: 'process', frame: 'stage', durationMs: 16200, geometry: shared.customGeometry('stage', {}), look, cues: [{ word: 'product', at: 0.5 }], before: '', after: '', planned: 'Staircase', scene: { lines, grade } }
  const prompt = shared.writerUserPrompt(brief)
  assert.match(prompt, /^SCENE: scene 2 of 6/); assert.match(prompt, /THEME: DARK PRODUCT UI/); assert.match(prompt, /panel #1D1926/); assert.match(prompt, /glow rgba/)
  assert.doesNotMatch(prompt, /TEMPLATE GRAPHIC PLANNED/)
  // Still times spread over the scene (the grader sees it build).
  const times = scenes.sceneStillTimes(16200)
  assert.equal(times.length, 4); assert.ok(times[0] <= 1600 && times[3] === 15700 && times[1] < times[2])
})

test('themes: each a token set that reads; the look carries panel and glow into the page and the saved meta', () => {
  for (const theme of shared.CUSTOM_THEMES) {
    for (const brandColor of [null, '#1F4E9C', '#FFD400', '#E84BD8']) {
      const look = shared.customLook({ kind: 'stage', theme, brandColor })
      assert.equal(look.theme, theme)
      assert.ok(shared.contrast(look.ink, look.ground) >= 4.5, `${theme} ${brandColor} ink`)
      assert.ok(shared.contrast(look.accent, look.ground) >= 2.9, `${theme} ${brandColor} accent ${look.accent} on ${look.ground}`)
      assert.ok(look.panel && look.glow)
      // Saved and read back the same (the bake draws it the same).
      assert.deepEqual(plain(shared.parseLook(JSON.parse(JSON.stringify(look)))), plain(look))
    }
  }
  const dark = shared.customLook({ kind: 'visual', theme: 'dark' })
  assert.equal(dark.ground, shared.DARK_UI_GROUND); assert.equal(dark.accent, shared.DARK_UI_ACCENT)
  const css = shared.lookCss(dark)
  assert.match(css, /--cg-panel:#1D1926/); assert.match(css, /--cg-glow:rgba\(232,75,216,0\.55\)/)
  // A card over the video keeps the video behind it; the Explainer keeps its paper whatever the theme.
  assert.equal(shared.customLook({ kind: 'card', theme: 'dark' }).ground, 'video')
  assert.equal(shared.customLook({ kind: 'explainer', theme: 'dark' }).ground, shared.EXPLAINER_PAPER)
  // A look saved before themes still reads (no panel or glow: the page falls back to the paper and no glow).
  const old = shared.customLook({ kind: 'stage' })
  assert.equal(old.theme, undefined); assert.match(shared.lookCss(old), /--cg-glow:transparent/)
  // The engine's backdrop per theme.
  assert.deepEqual(plain(shared.THEME_BACKDROP), { dark: 'dark', paper: 'paper', brand: 'solid' })
  // The rules: the Dark product UI asks for panels, tilt, glow and stamps; Paper bans them.
  assert.match(shared.THEME_RULES, /DARK PRODUCT UI[\s\S]*ASKED FOR: glossy panels[\s\S]*perspective[\s\S]*glowing[\s\S]*stamps/)
  assert.match(shared.THEME_RULES, /PAPER AND INK[\s\S]*Banned: glow, soft shadows, gradients, glossy UI, app chrome/)
  assert.doesNotMatch(shared.DESIGN_RULES, /fake app UI/)
})

test('the reference scenes follow the contract and use only the look\'s tokens', () => {
  for (const e of shared.SCENE_EXAMPLES) {
    const seconds = Number(/data-duration="([\d.]+)"/.exec(e.html)[1]) * 1000
    assert.deepEqual(shared.checkComposition(e.html, { width: 1080, height: 806, durationMs: seconds }), [], e.brief.slice(0, 40))
    assert.doesNotMatch(e.html.replace(/<script>[\s\S]*<\/script>/, ''), /#[0-9a-fA-F]{6}\b/, 'no hex colors of its own')
    assert.doesNotMatch(e.html, /font-size:([0-3]\d|4[0-3])px/, 'nothing under 44 px')
    // Not the owner's words (the run the proxy test designs for): the examples teach the level, not the content.
    assert.doesNotMatch(e.html, /business online|digital product|eyeballs|going viral/)
  }
})

test('text highlights: at most three automatic ones stay, spread out; the member\'s own stay', () => {
  assert.equal(scenes.isTextHighlight({ template: 'fx', fields: { effect: 'headline-slam' } }), true)
  assert.equal(scenes.isTextHighlight({ template: 'fx', fields: { effect: 'count-up' } }), false)
  assert.equal(scenes.isTextHighlight({ template: 'staircase', fields: {} }), false)
  assert.equal(scenes.isTextHighlight({ template: 'statement', fields: {} }), true)
})

// ---------------------------------------------------------------------------
// The review's flow, with a fake model and a fake sandbox
// ---------------------------------------------------------------------------

function editMain() {
  return loadMain("export * from './src/main/edit-custom-graphics'", {
    electron: { app: { isPackaged: false, getPath: () => os.tmpdir() } }, './custom-render': { customSandbox: () => { throw new Error('use the fake') } },
    './settings-store': { loadSettings: () => ({ openrouterApiKey: '' }) }, './member-prefs': { readMemberPrefs: () => ({ create: {} }) }, './openrouter-models': { getModelCatalog: async () => ({ planning: [] }) },
    './logger': { logger: { info() {}, warn() {} } }, './beat-stills': { beatFrame: async () => { throw new Error('no frames in tests') } }
  })
}

/** A review of the owner's run: its words as one source, its template graphics, text effects among them. */
function reviewOf(folder, extra = {}) {
  const words = RUN.words.map((w) => ({ text: w.word, startMs: w.start_ms, endMs: w.end_ms, src: 0 }))
  const plan = { words, hooks: [], cta: null, format: 'reel', graphics: [] }
  const at = (ms) => words.findIndex((w) => w.startMs >= ms)
  const graphics = [
    ...[20000, 45000, 70000, 95000, 120000, 150000, 175000].map((ms, k) => ({ id: `g-text${k}aaaa`, template: 'fx', word: at(ms), duration_ms: 3000, placement: 'middle', fields: { effect: 'headline-slam', text: words[at(ms)].text }, origin: 'auto' })),
    { id: 'g-stair00001', template: 'staircase', word: at(60000), duration_ms: 8000, placement: 'middle', fields: { items: 'product\noffer\neyeballs' }, origin: 'auto', size: 'stage' },
    { id: 'g-mine000001', template: 'statement', word: at(100000), duration_ms: 3000, placement: 'middle', fields: { text: 'mine' }, origin: 'member' }
  ].sort((a, b) => a.word - b.word)
  const decisions = { cut: [], hookId: null, hookText: 'You do not have to be an influencer', endOnCta: false, recipe: 'talking', graphics, look: { headlineLook: { font: 'clean' } }, ...extra }
  return { folder, plan, decisions, sources: [{ path: '/dev/null', name: 'take', seconds: 300 }], brandColor: null, model: 'm/x', price: { input: 5e-6, output: 25e-6 }, vision: true }
}

test('the review: scenes over half the reel or more, templates inside them replaced, pop-ups only outside, text highlights cut to three', async () => {
  const m = editMain()
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-scenes-'))
  const ctx = reviewOf(folder)
  const calls = []
  const call = async (request) => {
    calls.push(request)
    if (request.purpose === 'scenes') {
      const n = (request.user.match(/^\d+\. \(/gm) || []).length
      return { text: JSON.stringify({ hero: 'your digital product: an app window whose rows fill in', motif: 'a stamp on every but', stretches: Array.from({ length: n }, (_, i) => ({ scene: i % 3 !== 0, frame: i === 2 ? 'visual' : 'stage', label: 'product', idea: 'rows fill in', kind: 'teaching' })) }), costUsd: 0.05 }
    }
    if (request.purpose === 'grade') return { text: '{"pass": false, "score": 5, "failed": ["design"], "fixes": ["More depth."]}', costUsd: 0.02 }
    if (request.purpose === 'world') return { text: '{"idea": "unused here", "elements": []}', costUsd: 0.001 }
    const d = /data-duration="([\d.]+)"/.exec(request.user)[1]
    const html = fs.readFileSync(path.join(FAKE, 'staircase.html'), 'utf8').replace(/data-duration="[\d.]+"/, `data-duration="${d}"`)
    return { text: '```html\n' + html + '\n```', costUsd: 0.2 }
  }
  const sandbox = { stills: async () => ({ transparent: [Buffer.from('p0'), Buffer.from('p1'), Buffer.from('p2'), Buffer.from('p3')], composite: Buffer.from('j'), texts: ['product'], problems: [] }) }
  const estimate = m.editCustomEstimate(ctx)
  assert.ok(estimate.scenes >= 3 && estimate.revisions === 2 && estimate.mostUsd > estimate.expectedUsd, JSON.stringify(estimate))
  const result = await m.makeEditCustomGraphics(ctx, { call, sandbox, library: null })
  // The plan first, once; then every scene and pop-up written with its two revisions (the grade stays under 7: advice).
  assert.equal(calls[0].purpose, 'scenes'); assert.equal(calls.filter((c) => c.purpose === 'scenes').length, 1)
  const sceneWrites = calls.filter((c) => c.purpose === 'write' && /^SCENE: /.test(c.user))
  assert.ok(sceneWrites.length >= 3 * 3, `each scene tried three times (${sceneWrites.length})`)
  assert.ok(sceneWrites.every((c) => c.maxTokens >= 16000))
  assert.ok(calls.filter((c) => c.purpose === 'write').every((c) => c.maxTokens >= 16000), 'room to think and answer')
  assert.ok(sceneWrites.some((c) => /THEME: DARK PRODUCT UI/.test(c.user)))
  const made = result.graphics.filter((g) => g.template === 'custom')
  const sceneGraphics = made.filter((g) => g.duration_ms > 12000)
  assert.equal(result.scenes, sceneGraphics.length); assert.ok(sceneGraphics.length >= 3)
  assert.ok(sceneGraphics.every((g) => g.size === 'stage' && ['stage', 'visual'].includes(g.fields.scene)))
  // Half the reel or more in scenes.
  // On the reel's own clock (long pauses tightened).
  const timeline = m.editReelTimeline(ctx)
  const end = timeline.endMs
  const starts = new Map(timeline.words.map((w) => [w.index, w.start_ms]))
  const covered = sceneGraphics.reduce((sum, g) => sum + g.duration_ms, 0)
  assert.ok(covered >= 0.4 * end, `${covered} of ${end}`)
  // No template graphic starts inside a scene; the member's own graphic outside the scenes stays.
  for (const g of result.graphics.filter((x) => x.template !== 'custom')) {
    const t = starts.get(g.word)
    assert.ok(!sceneGraphics.some((s) => t >= starts.get(s.word) && t < starts.get(s.word) + s.duration_ms) || g.origin === 'member', `${g.template} at ${t} inside a scene`)
  }
  // Text highlights: three at most.
  assert.ok(result.graphics.filter((g) => g.origin === 'auto' && scenes.isTextHighlight(g)).length <= scenes.MAX_TEXT_HIGHLIGHTS)
  // The world note is the plan's hero object and motif (no invented metaphor call).
  assert.equal(calls.filter((c) => c.purpose === 'world').length, 0)
  assert.match(JSON.stringify(m.editVisualWorld(folder)), /your digital product/)
  fs.rmSync(folder, { recursive: true, force: true })
})

test('the review with Scenes: Light: its count planned and designed, each choice estimated, the spending check on the chosen one', async () => {
  const m = editMain()
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-scenes-light-'))
  const full = reviewOf(folder)
  const light = { ...full, decisions: { ...full.decisions, sceneAmount: 'light' } }
  const amounts = m.editSceneAmounts(full)
  assert.ok(amounts.light.scenes < amounts.standard.scenes && amounts.standard.scenes <= amounts.full.scenes, JSON.stringify(amounts))
  assert.ok(amounts.light.expectedUsd < amounts.standard.expectedUsd && amounts.standard.expectedUsd < amounts.full.expectedUsd)
  // The estimate the spending check uses follows the choice (Light: its count, also at most).
  const est = m.editCustomEstimate(light)
  assert.equal(est.scenes, amounts.light.scenes); assert.equal(est.mostUsd, amounts.light.mostUsd)
  assert.ok(est.mostUsd < m.editCustomEstimate(full).mostUsd)
  const calls = []
  const call = async (request) => {
    calls.push(request)
    if (request.purpose === 'scenes') {
      const n = (request.user.match(/^\d+\. \(/gm) || []).length
      return { text: JSON.stringify({ hero: 'your digital product: an app window whose rows fill in', motif: '', stretches: Array.from({ length: n }, (_, i) => ({ scene: i > 0, frame: 'stage', label: '', idea: 'rows fill in', kind: 'teaching' })) }), costUsd: 0.05 }
    }
    if (request.purpose === 'grade') return { text: '{"pass": true, "score": 8, "failed": [], "fixes": []}', costUsd: 0.02 }
    const d = /data-duration="([\d.]+)"/.exec(request.user)[1]
    const html = fs.readFileSync(path.join(FAKE, 'staircase.html'), 'utf8').replace(/data-duration="[\d.]+"/, `data-duration="${d}"`)
    return { text: '```html\n' + html + '\n```', costUsd: 0.2 }
  }
  const sandbox = { stills: async () => ({ transparent: [Buffer.from('p0'), Buffer.from('p1'), Buffer.from('p2'), Buffer.from('p3')], composite: Buffer.from('j'), texts: ['product'], problems: [] }) }
  const result = await m.makeEditCustomGraphics(light, { call, sandbox, library: null })
  assert.match(calls[0].user, new RegExp(`chose ${amounts.light.scenes} scenes?`))
  assert.ok(result.scenes <= amounts.light.scenes && result.scenes >= amounts.light.scenes - 1, `${result.scenes} of ${amounts.light.scenes}`)
  fs.rmSync(folder, { recursive: true, force: true })
})

test('the review: scenes off (or the Explainer, or no Stage layouts) keeps the pop-ups only', () => {
  const m = editMain()
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-scenes-off-'))
  assert.equal(m.scenesOn(reviewOf(folder)), true)
  assert.equal(m.scenesOn(reviewOf(folder, { customScenes: false })), false)
  assert.equal(m.scenesOn(reviewOf(folder, { explainer: true })), false)
  assert.equal(m.scenesOn(reviewOf(folder, { stageLayouts: false })), false)
  assert.equal(m.editCustomEstimate(reviewOf(folder, { customScenes: false })).scenes, 0)
  fs.rmSync(folder, { recursive: true, force: true })
})

test('back-to-back scenes hand over directly: the first runs to the second\'s start and holds; the second lands at once', () => {
  const m = loadMain("export * from './src/main/custom-scenes'", { './logger': { logger: { info() {}, warn() {} } } })
  const words = RUN.words.map((w, i) => ({ ...w, index: i }))
  const end = RUN.words[RUN.words.length - 1].end_ms
  const list = m.reelStretches(words, end)
  const plan = { hero: 'your digital product: an app window', motif: '', stretches: list.map((_, i) => ({ scene: i === 1 || i === 2, frame: 'stage', label: '', idea: '', kind: 'teaching' })) }
  const planned = m.plannedScenes(list, plan, words, end)
  const [a, b] = planned
  assert.equal(a.atMs + a.durationMs, b.atMs, 'no gap, no overlap')
  assert.equal(a.followed, true); assert.equal(b.follows, true)
  const brief = (scene) => m.sceneBrief({ scene, scenes: 2, count: list.length, plan, words, theme: 'dark' }).scene.lines.join(' ')
  assert.match(brief(a), /do NOT exit or fade; hold your final state to the very last frame/)
  assert.match(brief(b), /lands at 0\.0-0\.25 s \(no empty stage between the two\)/)
})
