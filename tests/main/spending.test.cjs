// Month boundaries are on the member's clock: pin a zone that is behind UTC.
process.env.TZ = 'America/New_York'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, AbortSignal, Response, TextDecoder, fetch: (...args) => globalThis.fetch(...args),
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/spending.ts')

const entry = (at, usd, kind = 'create', extra = {}) => ({ at, usd, kind, provider: 'openrouter', label: 'Create run', ...extra })

test('ledger lines: unreadable, unknown and out-of-range entries are skipped; extra fields dropped', () => {
  const text = [
    JSON.stringify(entry('2026-10-03T12:00:00.000Z', 0.42, 'create', { runId: 'abc-1', key: 'sk-or-secret', prompt: 'mine' })),
    '{"at":"2026-10-03T12:00:00Z","kind":"create","provider":"openrouter","usd":0.1,"label":"torn',
    JSON.stringify(entry('not a date', 1)),
    JSON.stringify(entry('2026-10-03T12:00:00Z', -1)),
    JSON.stringify(entry('2026-10-03T12:00:00Z', 1, 'lottery')),
    JSON.stringify({ ...entry('2026-10-03T12:00:00Z', 1), provider: 'elevenlabs' }),
    JSON.stringify(entry('2026-10-04T12:00:00Z', 2, 'remix', { label: 'x'.repeat(200) + '\u0007', estimated: true, backfilled: true, runId: '../../etc' })),
    '',
    'garbage'
  ].join('\n')
  const parsed = plain(shared.parseLedger(text))
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed[0], { at: '2026-10-03T12:00:00.000Z', kind: 'create', provider: 'openrouter', usd: 0.42, label: 'Create run', runId: 'abc-1' })
  assert.equal(parsed[1].label.length, shared.MAX_LABEL_CHARS)
  assert.equal(parsed[1].estimated, true)
  assert.equal(parsed[1].backfilled, true)
  assert.equal('runId' in parsed[1], false)
})

test('summaries: this month, last month and all time follow local month boundaries', () => {
  // 2026-11-01T02:00Z is still October 31 in New York; 2026-10-01T03:00Z is September 30 there.
  const entries = shared.parseLedger([
    entry('2026-11-01T02:00:00Z', 1.0),
    entry('2026-11-01T05:00:00Z', 2.0, 'remix'),
    entry('2026-10-01T03:00:00Z', 4.0, 'avatar'),
    entry('2026-10-01T05:00:00Z', 8.0, 'chat'),
    entry('2025-01-01T12:00:00Z', 16.0, 'create', { provider: 'fal' })
  ].map((value) => JSON.stringify(value)).join('\n'))
  const november = plain(shared.summarizeSpend(entries, new Date('2026-11-15T12:00:00Z')))
  assert.equal(november.thisMonthUsd, 2)
  assert.equal(november.lastMonthUsd, 9) // Oct 31 local + Oct 1 local
  assert.equal(november.allTimeUsd, 31)
  assert.deepEqual(november.byKind.remix, { thisMonthUsd: 2, allTimeUsd: 2 })
  assert.deepEqual(november.byKind.create, { thisMonthUsd: 0, allTimeUsd: 17 })
  assert.equal(november.recent[0].usd, 2)
  assert.equal(november.recent.length, 5)
  // January looks back to December across the year boundary.
  const january = plain(shared.summarizeSpend(shared.parseLedger(JSON.stringify(entry('2026-12-31T23:30:00-05:00', 3))), new Date('2027-01-02T12:00:00Z')))
  assert.deepEqual([january.thisMonthUsd, january.lastMonthUsd], [0, 3])
  // Only the last 20 are listed, newest first.
  const many = Array.from({ length: 25 }, (_, i) => shared.parseSpendEntry(entry(new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), 0.01)))
  const summary = shared.summarizeSpend(many, new Date('2026-10-28T12:00:00Z'))
  assert.equal(summary.recent.length, 20)
  assert.ok(summary.recent[0].at > summary.recent[19].at)
  assert.equal(summary.count, 25)
})

test('monthly limit values: empty is none, dollars up to two decimals', () => {
  assert.equal(shared.parseSpendLimit(''), null)
  assert.equal(shared.parseSpendLimit('  '), null)
  assert.equal(shared.parseSpendLimit('25'), 25)
  assert.equal(shared.parseSpendLimit('$12.50'), 12.5)
  assert.equal(shared.parseSpendLimit('1,000'), 1000)
  for (const bad of ['0', '-5', 'abc', '12.345', '1e3', '999999999', {}, true]) assert.equal(shared.parseSpendLimit(bad), undefined, String(bad))
})

test('spending check: the monthly limit blocks first and cannot be skipped; a low balance can', () => {
  const base = { provider: 'openrouter', estimateUsd: 2, monthUsd: 0, limitUsd: null, balanceUsd: null }
  assert.equal(shared.spendGateDecision(base), null)
  // Limit: this month plus the estimate.
  assert.equal(shared.spendGateDecision({ ...base, monthUsd: 7.5, limitUsd: 10 }), null)
  const over = shared.spendGateDecision({ ...base, monthUsd: 8.5, limitUsd: 10 })
  assert.equal(over.reason, 'limit')
  assert.equal(over.canOverride, false)
  assert.match(over.message, /\$10\.00/)
  assert.match(over.message, /Settings → Spending/)
  // No estimate: blocks only once the limit is reached.
  assert.equal(shared.spendGateDecision({ ...base, estimateUsd: null, monthUsd: 9.99, limitUsd: 10 }), null)
  assert.equal(shared.spendGateDecision({ ...base, estimateUsd: null, monthUsd: 10, limitUsd: 10 }).reason, 'limit')
  // fal.ai runs still respect the limit.
  assert.equal(shared.spendGateDecision({ ...base, provider: 'fal', monthUsd: 9, limitUsd: 10 }).reason, 'limit')
  // Balance: below the estimate, or below $1 without one.
  const low = shared.spendGateDecision({ ...base, balanceUsd: 1.5 })
  assert.equal(low.reason, 'balance')
  assert.equal(low.canOverride, true)
  assert.match(low.message, /\$1\.50.*\$2\.00/)
  assert.equal(shared.spendGateDecision({ ...base, balanceUsd: 2.5 }), null)
  assert.equal(shared.spendGateDecision({ ...base, estimateUsd: null, balanceUsd: 0.99 }).reason, 'balance')
  assert.equal(shared.spendGateDecision({ ...base, estimateUsd: null, balanceUsd: 1 }), null)
  // An unknown balance never blocks; fal.ai has no balance check.
  assert.equal(shared.spendGateDecision({ ...base, estimateUsd: 500, balanceUsd: null }), null)
  assert.equal(shared.spendGateDecision({ ...base, provider: 'fal', balanceUsd: 0 }), null)
  // The gate travels through an IPC error message and back.
  const message = `Error invoking remote method 'remix:start': Error: ${shared.encodeSpendGate(low)}`
  assert.deepEqual(plain(shared.decodeSpendGate(message)), plain(low))
  assert.equal(shared.decodeSpendGate('Error: something else'), null)
  assert.equal(shared.decodeSpendGate(`${shared.SPEND_GATE_PREFIX}{"reason":"limit","provider":"openrouter","message":"x","canOverride":true}`).canOverride, false)
})

test('out-of-credit errors read the same everywhere; other errors are unchanged', () => {
  for (const text of [
    'OpenRouter reports insufficient credits. Add credits at openrouter.ai/credits.',
    'OpenRouter account is out of credits. Add credits at openrouter.ai/credits.',
    'Your OpenRouter key is out of credits. Add credits at openrouter.ai/credits or raise the key\'s limit at openrouter.ai/keys.',
    'OpenRouter could not make the image (402). Try again.',
    'Transcription account credit limit reached'
  ]) assert.equal(shared.friendlyCreditError(text), shared.OUT_OF_CREDITS_MESSAGES.openrouter, text)
  assert.equal(shared.creditProblem('Your fal.ai balance is empty. Add credits at fal.ai/dashboard/billing, then try again.'), 'fal')
  for (const text of ['OpenRouter rejected the API key.', 'Zernio needs a payment method for this. Check the billing page in your Zernio dashboard.', 'Add the original creator’s name so the video credits them.', '']) {
    assert.equal(shared.creditProblem(text), null, text)
    assert.equal(shared.friendlyCreditError(text), text)
  }
})

// ---------------------------------------------------------------------------
// The main-process ledger
// ---------------------------------------------------------------------------

function loadMain({ settings, history = [], fetchImpl } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'spending-test-'))
  const state = { settings: { openrouterApiKey: 'sk-or-test', falApiKey: '', outputDirectory: userData, monthlySpendLimitUsd: '', ...settings }, mediaListener: null }
  const main = load('main/spending.ts', {
    electron: { app: { getPath: () => userData } },
    './logger': { logger: { info() {}, warn() {} } },
    './settings-store': { loadSettings: () => state.settings },
    './file-manager': { getJobHistory: async () => history },
    './openrouter-media': { openRouterBase: () => 'https://openrouter.test/api/v1', onMediaCharge: (listener) => { state.mediaListener = listener } }
  })
  if (fetchImpl) globalThis.fetch = fetchImpl
  return { main, userData, state }
}

test('recording: append-only JSON lines, nothing secret, runs recorded once, earlier runs backfilled once', async () => {
  const history = [
    { jobId: '11111111-1111-4111-8111-111111111111', status: 'completed', totalCostUsd: 0.31, finishedAt: '2026-09-02T10:00:00.000Z', date: '2026-09-02T09:00:00.000Z' },
    { jobId: 'remix-22222222-2222-4222-8222-222222222222', status: 'completed', totalCostUsd: 1.2, finishedAt: null, date: '2026-09-03T09:00:00.000Z' },
    { jobId: '33333333-3333-4333-8333-333333333333', status: 'failed', totalCostUsd: null, finishedAt: null, date: '2026-09-04T09:00:00.000Z' }
  ]
  const { main, userData } = loadMain({ history })
  let changes = 0
  main.onSpendingChange(() => changes++)
  // A Create run that finished in this session is recorded once, whatever the number of snapshots.
  const snapshot = { id: '44444444-4444-4444-8444-444444444444', status: 'completed', output: { metrics: { api_costs: { total_estimated_cost_usd: 0.5 } } } }
  main.trackJobSnapshot(snapshot)
  main.trackJobSnapshot({ ...snapshot, revision: 2 })
  await main.flushSpending()
  const overview = plain(await main.spendOverview(new Date('2026-10-20T12:00:00Z')))
  await main.flushSpending()
  const lines = fs.readFileSync(path.join(userData, 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(lines.map((line) => [line.kind, line.usd, line.label, line.backfilled === true]), [
    ['create', 0.5, 'Create run', false],
    ['create', 0.31, 'Create run (earlier run)', true],
    ['remix', 1.2, 'Remix videos (earlier run)', true]
  ])
  assert.ok(!fs.readFileSync(path.join(userData, 'spending', 'ledger.jsonl'), 'utf8').includes('sk-or'))
  assert.equal(overview.summary.allTimeUsd, 2.01)
  assert.equal(overview.summary.thisMonthUsd, 0.5)
  assert.ok(changes >= 3)
  // The backfill does not run twice (a fresh process reads the marker).
  const again = loadMain({ history })
  fs.cpSync(path.join(userData, 'spending'), path.join(again.userData, 'spending'), { recursive: true })
  const second = plain(await again.main.spendOverview(new Date('2026-10-20T12:00:00Z')))
  assert.equal(second.summary.count, 3)
})

test('remix runs record each paid step once: planning, then the videos', async () => {
  const { main } = loadMain()
  const status = { id: 'r1', phase: 'planning', folder: '/out/remix-abc', drafts: [], costUsd: null, error: null }
  main.trackRemixStatus(status)
  main.trackRemixStatus({ ...status, phase: 'review', costUsd: 0.12 })
  main.trackRemixStatus({ ...status, phase: 'review', costUsd: 0.12 })
  main.trackRemixStatus({ ...status, phase: 'rendering', costUsd: 0.12 })
  main.trackRemixStatus({ ...status, phase: 'done', costUsd: 1.62 })
  await main.flushSpending()
  const summary = plain((await main.spendOverview()).summary)
  assert.deepEqual(summary.recent.map((item) => [item.label, Math.round(item.usd * 100) / 100, item.runId]).sort(), [['Remix planning', 0.12, 'remix-abc'], ['Remix videos', 1.5, 'remix-abc']])
})

test('media calls inside a paid action are added up: reported costs, or list-price estimates', async () => {
  const { main, state } = loadMain()
  main.initSpending()
  await main.metered('avatar', 'Avatar pictures', async () => {
    state.mediaListener({ what: 'image', model: 'google/gemini-3.1-flash-image', usd: 0.07 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    state.mediaListener({ what: 'image', model: 'google/gemini-3.1-flash-image', usd: null })
  })
  // A failed action still records what it spent.
  await assert.rejects(main.metered('avatar', 'Voice clone', async () => {
    state.mediaListener({ what: 'speech', model: 'fish-audio/s2.1-pro', usd: null, chars: 2000 })
    throw new Error('stopped')
  }), /stopped/)
  await main.flushSpending()
  const recent = plain((await main.spendOverview()).summary.recent)
  const pictures = recent.find((item) => item.label === 'Avatar pictures')
  assert.equal(Math.round(pictures.usd * 100) / 100, 0.15)
  assert.equal(pictures.estimated, true)
  assert.equal(recent.find((item) => item.label === 'Voice clone').usd, 0.03)
  assert.equal(main.mediaChargeUsd({ what: 'video', model: 'kwaivgi/kling-v3.0-pro', usd: null, seconds: 10 }).usd, 1.12)
})

test('avatar renders are recorded when they finish; a fal.ai recreate at its estimate', async () => {
  const { main, state } = loadMain()
  main.initSpending()
  const running = { id: 'a1', phase: 'voice', estimatedCostUsd: 0.9, error: null }
  const started = await main.meteredAvatarRender(false, async () => {
    setTimeout(() => state.mediaListener({ what: 'video', model: 'kwaivgi/kling-v3.0-std', usd: 0.5, seconds: 5 }), 1)
    return running
  })
  assert.equal(started.id, 'a1')
  await new Promise((resolve) => setTimeout(resolve, 20))
  main.trackAvatarStatus({ ...running, phase: 'done' })
  await main.meteredAvatarRender(true, async () => ({ id: 'f1', phase: 'scenes', estimatedCostUsd: 2.4, error: null }))
  main.trackAvatarStatus({ id: 'f1', phase: 'done', estimatedCostUsd: 2.4, error: null })
  await new Promise((resolve) => setTimeout(resolve, 20))
  await main.flushSpending()
  const recent = plain((await main.spendOverview()).summary.recent)
  assert.deepEqual(recent.map((item) => [item.label, item.provider, item.usd]).sort(), [['Avatar recreate', 'fal', 2.4], ['Avatar video', 'openrouter', 0.5]])
})

test('balance: account credits and key limit, the lower is used; failures never block', async () => {
  const calls = []
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  let credits = () => reply({ data: { total_credits: 10, total_usage: 7.25 } })
  let key = () => reply({ data: { limit: 5, limit_remaining: 4, usage: 1 } })
  const fetchImpl = async (url, init) => {
    calls.push([url, init.headers.Authorization])
    return url.endsWith('/credits') ? credits() : key()
  }
  const { main, state } = loadMain({ fetchImpl })
  const both = plain(await main.fetchOpenRouterBalance('sk-or-test', { fetch: fetchImpl }))
  assert.deepEqual([both.remainingUsd, both.accountRemainingUsd, both.keyRemainingUsd, both.note], [2.75, 2.75, 4, null])
  assert.ok(calls.every(([url, auth]) => url.startsWith('https://openrouter.test/api/v1/') && auth === 'Bearer sk-or-test'))
  // A regular key may not read the account: the key's own limit is used, and said so.
  credits = () => reply({ error: { message: 'Only management keys can perform this operation' } }, 403)
  const keyOnly = plain(await main.fetchOpenRouterBalance('k', { fetch: fetchImpl }))
  assert.equal(keyOnly.remainingUsd, 4)
  assert.match(keyOnly.note, /key’s own spending limit/)
  key = () => reply({ data: { limit: null, limit_remaining: null, usage: 3 } })
  const unknown = plain(await main.fetchOpenRouterBalance('k', { fetch: fetchImpl }))
  assert.equal(unknown.remainingUsd, null)
  assert.match(unknown.note, /can’t read your account balance/)
  const offline = plain(await main.fetchOpenRouterBalance('k', { fetch: async () => { throw new TypeError('fetch failed') } }))
  assert.match(offline.note, /could not be reached/)

  // The check before a run: unknown balance passes; a low one blocks until "Start anyway".
  await main.assertSpendAllowed('job:start', 'openrouter', null)
  credits = () => reply({ data: { total_credits: 1, total_usage: 0.6 } })
  key = () => reply({ data: { limit: null, limit_remaining: null } })
  main.resetSpendingForTests()
  await assert.rejects(main.assertSpendAllowed('job:start', 'openrouter', null), (error) => {
    const gate = shared.decodeSpendGate(error.message)
    assert.equal(gate.reason, 'balance')
    return true
  })
  main.allowOnce('job:start')
  await main.assertSpendAllowed('job:start', 'openrouter', null)
  // Used once: the next run is checked again.
  await assert.rejects(main.assertSpendAllowed('job:start', 'openrouter', null), /SPEND_GATE/)
  assert.throws(() => main.allowOnce('settings:save'), /Invalid/)
  // The monthly limit is never skipped.
  state.settings.monthlySpendLimitUsd = '1'
  await main.recordSpend({ kind: 'chat', provider: 'openrouter', usd: 0.9, label: 'Chat message' })
  main.allowOnce('remix:start')
  await assert.rejects(main.assertSpendAllowed('remix:start', 'openrouter', 0.2), (error) => shared.decodeSpendGate(error.message).reason === 'limit')
  // IPC errors: credit wording replaced, the spending check passed through as is.
  const friendly = main.friendlyIpcError(new Error('OpenRouter reports insufficient credits. Check your OpenRouter account.'))
  assert.equal(friendly.message, shared.OUT_OF_CREDITS_MESSAGES.openrouter)
  const gateError = new Error(shared.encodeSpendGate({ reason: 'balance', provider: 'openrouter', message: 'insufficient credits', canOverride: true, estimateUsd: null }))
  assert.equal(main.friendlyIpcError(gateError), gateError)
})

test('every channel that goes through paid() can take "Start anyway"', () => {
  const { main } = loadMain()
  const source = fs.readFileSync(path.join(ROOT, 'main/ipc-handlers.ts'), 'utf8')
  const channels = [...source.matchAll(/\bpaid\(\s*'([^']+)'/g)].map((match) => match[1])
  assert.ok(channels.length >= 10, 'found the paid channels')
  for (const channel of channels) {
    assert.ok(main.GATED_CHANNELS.has(channel), `${channel} is in GATED_CHANNELS`)
    assert.equal(main.allowOnce(channel), true)
  }
})

test('editor bakes that translate captions pass the spending check and can take "Start anyway"', () => {
  const { main } = loadMain()
  const preload = fs.readFileSync(path.join(ROOT, 'preload/index.ts'), 'utf8')
  const channels = [...preload.matchAll(/\bpaid\(\s*'([^']+)'/g)].map((match) => match[1])
  assert.ok(channels.includes('editor:run'), 'the editor run goes through the gate dialog')
  for (const channel of channels) assert.ok(main.GATED_CHANNELS.has(channel), `${channel} is in GATED_CHANNELS`)
  const handlers = fs.readFileSync(path.join(ROOT, 'main/ipc-handlers.ts'), 'utf8')
  assert.match(handlers, /assertSpendAllowed\('editor:run', 'openrouter', translating\.estimateUsd\)/)
  // A review and hook ideas are paid too: they pass the check, through the gate dialog.
  assert.match(handlers, /if \(action === 'review'\) \{\s*await assertSpendAllowed\('editor:run', 'openrouter', await editorCallEstimate\(path, 'review'\)/)
  assert.match(handlers, /assertSpendAllowed\('editor:suggestHooks', 'openrouter', await editorCallEstimate\(path, 'suggest-hooks'\)/)
  assert.ok(channels.includes('editor:suggestHooks'), 'hook ideas go through the gate dialog')
  assert.match(handlers, /recordSpend\(\{ kind: 'create', provider: 'openrouter', usd, label \}\)/)
  assert.match(handlers, /onEditorSpend\(\(usd, label\) => recordSpend\(\{ kind: 'create'/)
})
