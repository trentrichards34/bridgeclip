// HeyGen (Beta): the API client, the avatar flow, spending and settings, with every network call mocked.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))
const KEY = 'hg-secret-key-0123456789abcdef'

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

/** Load a src module in a sandbox; `mocks` replaces imports by specifier. */
function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  vm.runInNewContext(transpile(path.join(ROOT, relative)), {
    module, exports: module.exports, URL, URLSearchParams, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval, process, DOMException, AbortSignal, AbortController,
    Response, FormData, Blob, TextEncoder, TextDecoder,
    fetch: () => { throw new Error('unexpected network call') },
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/heygen.ts')
const spendingShared = load('shared/spending.ts')

function logCapture() {
  const lines = []
  return { lines, logger: { info: (...args) => lines.push(args), warn: (...args) => lines.push(args), error: (...args) => lines.push(args) } }
}

function client(extra = {}) {
  const log = logCapture()
  const mod = load('main/heygen.ts', {
    electron: { app: { isPackaged: true } },
    './logger': { logger: log.logger },
    './network-policy': { assertPublicWebUrl: async (url) => { if (/\/\/(10\.|127\.|192\.168\.)/.test(url)) throw new Error('Local network sources are not allowed') } },
    ...extra
  })
  return { mod, log }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/** A fetch stand-in: each call is recorded; `routes` answers by "METHOD path". */
function fakeFetch(routes) {
  const calls = []
  const doFetch = async (url, init = {}) => {
    const parsed = new URL(url)
    const key = `${init.method ?? 'GET'} ${parsed.pathname}`
    const headers = init.headers ?? {}
    calls.push({ url, key, headers, body: init.body, search: parsed.search })
    const route = routes[key] ?? routes[`${init.method ?? 'GET'} ${parsed.origin}${parsed.pathname}`]
    if (!route) return new Response('not found', { status: 404 })
    return typeof route === 'function' ? route({ url, init, calls }) : route.shift()()
  }
  return { calls, fetch: doFetch }
}


// ---------------------------------------------------------------------------
// The API client
// ---------------------------------------------------------------------------

test('every call goes to api.heygen.com with the key in x-api-key (never Authorization)', async () => {
  const { mod } = client()
  const { calls, fetch } = fakeFetch({ 'GET /v3/users/me': () => json({ data: { username: 'maya', first_name: 'Maya', last_name: null, email: null, billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance: 125.5 } } }) })
  const user = await mod.getCurrentUser({ key: KEY, fetch })
  assert.equal(calls[0].url, 'https://api.heygen.com/v3/users/me')
  assert.equal(calls[0].headers['x-api-key'], KEY)
  assert.equal(calls[0].headers.Authorization, undefined)
  assert.deepEqual(plain(shared.parseHeygenAccount(user, new Date('2026-10-19T00:00:00Z'))), { name: 'Maya', billingType: 'wallet', remaining: '$125.50 left in your HeyGen wallet', checkedAt: '2026-10-19T00:00:00.000Z' })
})

test('the balance is told in plain words for wallet, subscription and usage-based accounts', () => {
  assert.equal(shared.heygenRemaining({ billing_type: 'wallet', wallet: { currency: 'credits', remaining_balance: 1200 } }), '1,200 credits left')
  assert.equal(shared.heygenRemaining({ billing_type: 'subscription', subscription: { plan: 'pro', credits: { premium_credits: { remaining: 30 }, add_on_credits: null } } }), '30 premium credits left (pro plan)')
  assert.equal(shared.heygenRemaining({ billing_type: 'usage_based', usage_based: { spending_current_usd: 4, spending_cap_usd: 50 } }), '$4.00 of your $50.00 cap used')
  assert.equal(shared.heygenRemaining({ billing_type: null }), null)
})

test('uploads are multipart with one "file" field and an idempotency key', async () => {
  const { mod } = client()
  const { calls, fetch } = fakeFetch({ 'POST /v3/assets': () => json({ data: { asset_id: 'ast_123', url: 'https://files.heygen.ai/a.jpg', mime_type: 'image/jpeg', size_bytes: 3 } }) })
  const asset = await mod.uploadAsset(new Uint8Array([1, 2, 3]), 'photo.jpg', 'image/jpeg', { key: KEY, fetch })
  assert.equal(asset.assetId, 'ast_123')
  assert.equal(calls[0].body.constructor.name, 'FormData')
  const file = calls[0].body.get('file')
  assert.equal(file.type, 'image/jpeg')
  assert.equal(file.size, 3)
  assert.match(calls[0].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/)
  assert.equal(calls[0].headers['Content-Type'], undefined, 'fetch sets the multipart boundary itself')
})

test('avatars are created from an uploaded asset; a twin returns its group, cloned voice and consent link', async () => {
  const { mod } = client()
  const { calls, fetch } = fakeFetch({
    'POST /v3/avatars': () => json({ data: {
      avatar_item: { id: 'look_1', name: 'Me', avatar_type: 'digital_twin', group_id: 'ag_1', default_voice_id: 'voice_clone', status: 'processing', supported_api_engines: ['avatar_iv'] },
      avatar_group: { id: 'ag_1', name: 'Me', created_at: 1, looks_count: 1, consent_status: null, status: 'processing' }
    } }),
    'POST /v3/avatars/ag_1/consent': () => json({ data: { avatar_group: { id: 'ag_1', consent_status: 'pending', status: 'pending_consent', name: 'Me', created_at: 1, looks_count: 1 }, url: 'https://app.heygen.com/consent/abc' } })
  })
  const made = await mod.createAvatar('digital_twin', 'Me', 'ast_9', { key: KEY, fetch })
  assert.deepEqual(JSON.parse(calls[0].body), { type: 'digital_twin', name: 'Me', file: { type: 'asset_id', asset_id: 'ast_9' } })
  assert.equal(made.look.id, 'look_1'); assert.equal(made.look.groupId, 'ag_1'); assert.equal(made.look.defaultVoiceId, 'voice_clone')
  const consent = await mod.createConsent('ag_1', { key: KEY, fetch })
  assert.equal(consent.url, 'https://app.heygen.com/consent/abc')
  assert.equal(consent.group.consentStatus, 'pending')
  // Ids from HeyGen are never trusted into a path unchecked.
  await assert.rejects(mod.getGroup('../users/me', { key: KEY, fetch }), /unexpected id/)
  // A photo avatar has the same shape with type "photo".
  const photo = fakeFetch({ 'POST /v3/avatars': () => json({ data: { avatar_item: { id: 'look_p', name: 'P', avatar_type: 'photo_avatar', status: 'processing' }, avatar_group: { id: 'ag_p', name: 'P', created_at: 1, looks_count: 1 } } }) })
  await mod.createAvatar('photo', 'P', 'ast_p', { key: KEY, fetch: photo.fetch })
  assert.equal(JSON.parse(photo.calls[0].body).type, 'photo')
})

test('video requests ask for vertical 1080p (1080x1920), lip-synced to audio or spoken in a voice', () => {
  const { mod } = client()
  const audio = mod.videoBody({ avatarId: 'look_1', audioAssetId: 'ast_audio' })
  assert.deepEqual(plain(audio), { type: 'avatar', avatar_id: 'look_1', aspect_ratio: '9:16', resolution: '1080p', fit: 'cover', output_format: 'mp4', audio_asset_id: 'ast_audio' })
  const spoken = mod.videoBody({ avatarId: 'look_1', script: ' Hello there. ', voiceId: 'voice_1', engine: 'avatar_v', title: 'Hook\u0007' })
  assert.equal(spoken.script, 'Hello there.'); assert.equal(spoken.voice_id, 'voice_1'); assert.deepEqual(plain(spoken.engine), { type: 'avatar_v' }); assert.equal(spoken.title, 'Hook ')
  assert.equal(spoken.audio_asset_id, undefined)
  assert.throws(() => mod.videoBody({ avatarId: 'look_1', script: '' }), /Write a script/)
  assert.throws(() => mod.videoBody({ avatarId: 'look 1', script: 'x' }), /Choose a HeyGen avatar/)
})

test('a 429 waits for Retry-After and tries again; a spent quota does not', async () => {
  const { mod } = client()
  const waits = []
  const sleep = async (ms) => { waits.push(ms) }
  const { calls, fetch } = fakeFetch({ 'GET /v3/videos/v_1': [
    () => json({ error: { code: 'rate_limit_exceeded', message: 'slow down' } }, 429, { 'Retry-After': '2' }),
    () => json({ data: { id: 'v_1', status: 'processing' } })
  ] })
  const video = await mod.getVideo('v_1', { key: KEY, fetch, sleep })
  assert.equal(video.status, 'processing')
  assert.deepEqual(waits, [2000])
  assert.equal(calls.length, 2)
  // A create retried after a 429 keeps the same idempotency key (no second video).
  const create = fakeFetch({ 'POST /v3/videos': [
    () => json({ error: { code: 'rate_limit_exceeded' } }, 429),
    () => json({ data: { video_id: 'v_2', status: 'waiting' } })
  ] })
  assert.equal((await mod.createVideo({ avatarId: 'look_1', script: 'Hi', voiceId: 'v' }, { key: KEY, fetch: create.fetch, sleep })).videoId, 'v_2')
  assert.equal(create.calls[0].headers['Idempotency-Key'], create.calls[1].headers['Idempotency-Key'])
  const quota = fakeFetch({ 'GET /v3/users/me': [() => json({ error: { code: 'quota_exceeded', message: 'quota' } }, 429)] })
  await assert.rejects(mod.getCurrentUser({ key: KEY, fetch: quota.fetch, sleep }), /HeyGen balance is too low/)
  assert.equal(quota.calls.length, 1)
  assert.equal(mod.retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT', 0, Date.parse('Wed, 21 Oct 2026 07:27:58 GMT')), 2000)
  assert.equal(mod.retryAfterMs('9999', 0), 60000)
})

test('HeyGen errors become plain messages; the key never appears in messages or logs', async () => {
  const { mod, log } = client()
  const cases = [
    [401, 'unauthorized', /rejected the API key/],
    [402, 'insufficient_credit', /HeyGen balance is too low/],
    [400, 'avatar_consent_required', /consent recording/],
    [409, 'resource_not_ready', /still preparing/],
    [400, 'content_policy_violation', /content check/],
    [400, 'resolution_not_allowed', /plan doesn’t allow/],
    [500, 'internal_error', /HeyGen had a problem \(500\)/]
  ]
  for (const [status, code, pattern] of cases) {
    const { fetch } = fakeFetch({ 'POST /v3/videos': () => json({ error: { code, message: `bad key ${KEY} see https://x.example/doc` } }, status) })
    const error = await mod.createVideo({ avatarId: 'look_1', script: 'Hi', voiceId: 'v' }, { key: KEY, fetch, sleep: async () => {} }).catch((e) => e)
    assert.match(error.message, pattern, code)
    assert.ok(!error.message.includes(KEY), code)
  }
  const odd = fakeFetch({ 'POST /v3/videos': () => json({ error: { code: 'invalid_parameter', message: `nope ${KEY}` } }, 400) })
  const error = await mod.createVideo({ avatarId: 'look_1', script: 'Hi', voiceId: 'v' }, { key: KEY, fetch: odd.fetch }).catch((e) => e)
  assert.equal(error.message, 'HeyGen could not do that (invalid_parameter). HeyGen says: nope [key]')
  const offline = await mod.getCurrentUser({ key: KEY, fetch: async () => { throw new TypeError(`fetch failed ${KEY}`) }, sleep: async () => {} }).catch((e) => e)
  assert.match(offline.message, /could not be reached/)
  assert.ok(log.lines.length > 0)
  assert.ok(!JSON.stringify(log.lines).includes(KEY), 'the key is never logged')
  assert.ok(!JSON.stringify(log.lines).includes('look_1'), 'ids are not logged either')
})

test('downloads: https to public hosts only, every redirect re-checked, no key sent, size capped', async () => {
  const { mod } = client()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-dl-'))
  try {
    const dest = path.join(dir, 'out.mp4')
    await assert.rejects(mod.downloadHeygenFile('http://files.heygen.ai/v.mp4', dest, { fetch: async () => { throw new Error('should not fetch') } }), /isn’t secure/)
    await assert.rejects(mod.downloadHeygenFile('https://10.0.0.5/v.mp4', dest, { fetch: async () => { throw new Error('should not fetch') } }), /unexpected place/)
    const seen = []
    const fetch = async (url, init) => {
      seen.push({ url, headers: init.headers })
      if (url.startsWith('https://files.heygen.ai/')) return new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/v.mp4' } })
      return new Response('video-bytes', { status: 200 })
    }
    assert.equal(await mod.downloadHeygenFile('https://files.heygen.ai/v.mp4', dest, { fetch }), 11)
    assert.equal(fs.readFileSync(dest, 'utf8'), 'video-bytes')
    assert.deepEqual(seen.map((item) => item.url), ['https://files.heygen.ai/v.mp4', 'https://cdn.example.com/v.mp4'])
    assert.ok(seen.every((item) => item.headers === undefined), 'no key or headers go to the file host')
    const toPrivate = async () => new Response(null, { status: 302, headers: { location: 'https://192.168.1.2/v.mp4' } })
    await assert.rejects(mod.downloadHeygenFile('https://files.heygen.ai/v.mp4', path.join(dir, 'b.mp4'), { fetch: toPrivate }), /unexpected place/)
    await assert.rejects(mod.downloadHeygenFile('https://files.heygen.ai/v.mp4', path.join(dir, 'c.mp4'), { fetch: async () => new Response('x'.repeat(50)), maxBytes: 10 }), /too large/)
    assert.equal(fs.existsSync(path.join(dir, 'c.mp4.part')), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the API base can only be moved to a local stand-in in unpackaged end-to-end builds', () => {
  const previous = process.env.BRIDGECLIP_E2E_HEYGEN_URL
  process.env.BRIDGECLIP_E2E_HEYGEN_URL = 'http://127.0.0.1:4567'
  try {
    assert.equal(client().mod.heygenBase(), 'https://api.heygen.com', 'packaged builds ignore it')
    const dev = load('main/heygen.ts', { electron: { app: { isPackaged: false } }, './logger': { logger: logCapture().logger }, './network-policy': { assertPublicWebUrl: async () => {} } })
    assert.equal(dev.heygenBase(), 'http://127.0.0.1:4567')
    assert.equal(dev.isConsentUrl('http://127.0.0.1:4567/consent/x'), true)
    process.env.BRIDGECLIP_E2E_HEYGEN_URL = 'http://evil.example.com'
    assert.equal(dev.heygenBase(), 'https://api.heygen.com')
    assert.equal(dev.isConsentUrl('http://evil.example.com/consent'), false)
    assert.equal(dev.isConsentUrl('https://app.heygen.com/consent/abc'), true)
  } finally { if (previous === undefined) delete process.env.BRIDGECLIP_E2E_HEYGEN_URL; else process.env.BRIDGECLIP_E2E_HEYGEN_URL = previous }
})

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

test('stored HeyGen links are validated; the stage follows training and consent', () => {
  assert.equal(shared.parseHeygenLink({ provider: 'heygen', source: 'twin', lookId: '../x' }), null)
  assert.equal(shared.parseHeygenLink({ provider: 'other', source: 'twin', lookId: 'look_1' }), null)
  const link = shared.parseHeygenLink({ provider: 'heygen', source: 'twin', lookId: 'look_1', groupId: 'ag_1', status: 'weird', consentStatus: 'pending', consentUrl: 'javascript:alert(1)', voiceId: 'voice_1', voice: 'heygen', engines: ['avatar_iv', 'BAD ENGINE'], error: 'x\u0000y' })
  assert.deepEqual(plain(link), { provider: 'heygen', source: 'twin', lookId: 'look_1', groupId: 'ag_1', status: 'processing', consentStatus: 'pending', consentUrl: null, consentUrlAt: null, voiceId: 'voice_1', voice: 'heygen', engines: ['avatar_iv'], error: 'x y', checkedAt: null })
  const stage = (patch) => shared.heygenStage({ source: 'twin', status: 'completed', consentStatus: 'accepted', ...patch })
  assert.equal(stage({}), 'ready')
  assert.equal(stage({ consentStatus: null }), 'consent')
  assert.equal(stage({ consentStatus: 'pending', status: 'processing' }), 'consent')
  assert.equal(stage({ consentStatus: 'rejected', status: 'failed' }), 'consent-rejected')
  assert.equal(stage({ status: 'processing' }), 'training')
  assert.equal(stage({ status: 'failed' }), 'failed')
  assert.equal(shared.heygenStage({ source: 'photo', status: 'processing', consentStatus: null }), 'training')
  assert.equal(shared.heygenStage({ source: 'photo', status: 'completed', consentStatus: null }), 'ready')
  assert.equal(shared.heygenStage({ source: 'stock', status: 'completed', consentStatus: null }), 'ready')
  assert.equal(shared.consentLinkFresh({ consentUrl: 'https://a', consentUrlAt: new Date(Date.now() - 60_000).toISOString() }), true)
  assert.equal(shared.consentLinkFresh({ consentUrl: 'https://a', consentUrlAt: new Date(Date.now() - 24 * 3600_000).toISOString() }), false)
})

test('estimates come only from the published Engine IV price, kept with the date it was read', () => {
  assert.equal(shared.HEYGEN_PRICES.source, 'https://developers.heygen.com/docs/pricing')
  assert.match(shared.HEYGEN_PRICES.checkedOn, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(shared.estimateHeygenVideoUsd(30), 30 * shared.HEYGEN_PRICES.avatarIvPerSecond)
  assert.equal(shared.estimateHeygenVideoUsd(30, 'avatar_v'), null, 'no published price kept for other engines')
  assert.equal(shared.heygenEngine([]), null)
  assert.equal(shared.heygenEngine(['avatar_iii', 'avatar_iv']), null)
  assert.equal(shared.heygenEngine(['avatar_iii']), 'avatar_iii')
  assert.equal(shared.pricesCheckedOn(), 'Oct 19, 2026')
})

test('spending: HeyGen is a ledger provider, its gate decodes, and its out-of-credit message is recognized', () => {
  const entry = spendingShared.parseSpendEntry({ at: '2026-10-19T10:00:00Z', kind: 'avatar', provider: 'heygen', usd: 1.5, label: 'HeyGen avatar video', estimated: true })
  assert.equal(entry.provider, 'heygen')
  assert.equal(spendingShared.SPEND_PROVIDER_LABELS.heygen, 'HeyGen')
  const gate = spendingShared.spendGateDecision({ provider: 'heygen', estimateUsd: 3, monthUsd: 9, limitUsd: 10, balanceUsd: null })
  assert.equal(gate.reason, 'limit')
  assert.equal(spendingShared.decodeSpendGate(spendingShared.encodeSpendGate(gate)).provider, 'heygen')
  assert.equal(spendingShared.spendGateDecision({ provider: 'heygen', estimateUsd: 3, monthUsd: 0, limitUsd: null, balanceUsd: 0 }), null, 'only OpenRouter has a balance check')
  const { mod } = client()
  assert.equal(spendingShared.creditProblem(mod.HEYGEN_OUT_OF_CREDIT), 'heygen')
  assert.match(spendingShared.friendlyCreditError(mod.HEYGEN_OUT_OF_CREDIT), /Settings → Spending has the link/)
})

// ---------------------------------------------------------------------------
// Avatars and takes (heygen-avatar.ts)
// ---------------------------------------------------------------------------

function avatarFlow({ avatar = null, routes = {}, settings = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-avatar-'))
  const drafts = path.join(dir, 'drafts')
  fs.mkdirSync(drafts, { recursive: true })
  const saved = new Map()
  if (avatar) saved.set(avatar.id, avatar)
  const spend = []
  const log = logCapture()
  const net = fakeFetch(routes)
  const heygen = load('main/heygen.ts', { electron: { app: { isPackaged: true } }, './logger': { logger: log.logger }, './network-policy': { assertPublicWebUrl: async () => {} } })
  const wrapped = { ...heygen }
  for (const name of ['getCurrentUser', 'uploadAsset', 'createAvatar', 'getLook', 'getGroup', 'listPublicLooks', 'createConsent', 'createVideo', 'getVideo']) {
    wrapped[name] = (...args) => { const last = args.length - 1; args[last] = { ...args[last], fetch: net.fetch, sleep: async () => {} }; return heygen[name](...args) }
  }
  wrapped.downloadHeygenFile = (url, dest, opts) => heygen.downloadHeygenFile(url, dest, { ...opts, fetch: net.fetch, sleep: async () => {} })
  const mod = load('main/heygen-avatar.ts', {
    electron: { nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }), toJPEG: () => Buffer.from('jpeg') }) } },
    './heygen': wrapped,
    './logger': { logger: log.logger },
    './settings-store': { loadSettings: () => ({ heygenApiKey: KEY, ...settings }) },
    './spending': { recordSpend: async (entry) => { spend.push(entry); return entry } },
    './security': { authorizeMedia: (p) => p },
    './tools': { resolveBinary: (name) => name },
    './avatars': {
      draftsDir: () => drafts, avatarDir: (id) => path.join(dir, id), isDraftId: (value) => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value),
      newId: (bytes) => 'a'.repeat(bytes * 2),
      readAvatar: (id) => { const found = saved.get(id); if (!found) throw new Error('That avatar is no longer in your library.'); return JSON.parse(JSON.stringify(found)) },
      writeAvatar: async (next) => { saved.set(next.id, JSON.parse(JSON.stringify(next))) },
      writePicturesMeta: async () => {},
      listAvatars: async () => [...saved.values()]
    }
  })
  return { mod, dir, drafts, saved, spend, calls: net.calls, log, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

const VOICE = { provider: 'elevenlabs', voice: 'Brian' }
const READY_TWIN = { id: 'abcdef1234567890', name: 'Me', kind: 'self', description: '', voice: VOICE, clonedVoice: null, consentAt: '2026-10-19T00:00:00Z', createdAt: '2026-10-19T00:00:00Z',
  heygen: { provider: 'heygen', source: 'twin', lookId: 'look_1', groupId: 'ag_1', status: 'completed', consentStatus: 'accepted', consentUrl: null, consentUrlAt: null, voiceId: 'voice_clone', voice: 'heygen', engines: ['avatar_iv'], error: null, checkedAt: null } }

test('a twin or photo avatar is only made of the member ("This is me"); stock AI people need no consent', async () => {
  const flow = avatarFlow({ routes: { 'GET /v3/avatars/looks/look_stock': () => json({ data: { id: 'look_stock', name: 'Anna', avatar_type: 'studio_avatar', default_voice_id: 'voice_anna', supported_api_engines: ['avatar_iv'] } }) } })
  try {
    for (const source of ['twin', 'photo']) {
      await assert.rejects(flow.mod.createHeygenAvatar({ source, name: 'Me', draftId: 'b'.repeat(16), consent: false, voice: VOICE }), /can only be of you/)
    }
    assert.equal(flow.calls.length, 0, 'nothing is sent to HeyGen without the confirmation')
    const list = await flow.mod.createHeygenAvatar({ source: 'stock', name: 'Anna', lookId: 'look_stock', consent: false, voice: VOICE })
    // No preview link: a plain stand-in picture would be made with ffmpeg; this test only checks the record.
    const made = list[0]
    assert.equal(made.kind, 'ai'); assert.equal(made.consentAt, null)
    assert.deepEqual([made.heygen.source, made.heygen.status, made.heygen.voice, made.heygen.voiceId], ['stock', 'completed', 'heygen', 'voice_anna'])
    assert.deepEqual(flow.spend, [], 'adding a stock avatar costs nothing')
  } finally { flow.cleanup() }
})

test('a photo avatar: the photo is uploaded, HeyGen makes it, the $1 creation is recorded as an estimate', async () => {
  const flow = avatarFlow({ routes: {
    'POST /v3/assets': () => json({ data: { asset_id: 'ast_photo', url: 'https://files.heygen.ai/p.jpg', mime_type: 'image/jpeg', size_bytes: 4 } }),
    'POST /v3/avatars': () => json({ data: { avatar_item: { id: 'look_p', name: 'Me', avatar_type: 'photo_avatar', group_id: 'ag_p', status: 'processing' }, avatar_group: { id: 'ag_p', name: 'Me', created_at: 1, looks_count: 1, consent_status: null } } })
  } })
  try {
    const draft = 'c'.repeat(16)
    fs.writeFileSync(path.join(flow.drafts, `${draft}.jpg`), 'jpeg')
    const list = await flow.mod.createHeygenAvatar({ source: 'photo', name: 'Me', draftId: draft, consent: true, voice: VOICE, useHeygenVoice: true })
    assert.deepEqual(flow.calls.map((call) => call.key), ['POST /v3/assets', 'POST /v3/avatars'])
    assert.equal(JSON.parse(flow.calls[1].body).type, 'photo')
    const made = list[0]
    assert.equal(made.kind, 'self'); assert.ok(made.consentAt)
    assert.deepEqual([made.heygen.source, made.heygen.status, made.heygen.voice, made.heygen.consentStatus], ['photo', 'processing', 'app', null])
    assert.deepEqual(plain(flow.spend), [{ kind: 'avatar', provider: 'heygen', usd: 1, label: 'HeyGen photo avatar', estimated: true }])
    assert.ok(fs.existsSync(path.join(flow.dir, made.id, 'portrait.jpg')))
  } finally { flow.cleanup() }
})

test('a twin avatar asks HeyGen for its consent link right away; the link is reused for 24 hours, then renewed', async () => {
  let consents = 0
  const flow = avatarFlow({ routes: {
    'POST /v3/assets': () => json({ data: { asset_id: 'ast_v', url: 'https://files.heygen.ai/v.mp4', mime_type: 'video/mp4', size_bytes: 4 } }),
    'POST /v3/avatars': () => json({ data: { avatar_item: { id: 'look_t', name: 'Me', avatar_type: 'digital_twin', group_id: 'ag_t', default_voice_id: 'voice_t', status: 'processing' }, avatar_group: { id: 'ag_t', name: 'Me', created_at: 1, looks_count: 1, consent_status: null } } }),
    'POST /v3/avatars/ag_t/consent': () => { consents++; return json({ data: { avatar_group: { id: 'ag_t', name: 'Me', created_at: 1, looks_count: 1, consent_status: 'pending' }, url: `https://app.heygen.com/consent/${consents}` } }) }
  } })
  try {
    const draft = 'd'.repeat(16)
    fs.writeFileSync(path.join(flow.drafts, `${draft}.jpg`), 'jpeg')
    fs.writeFileSync(path.join(flow.drafts, `${draft}.mp4`), 'mp4!')
    const [made] = await flow.mod.createHeygenAvatar({ source: 'twin', name: 'Me', draftId: draft, consent: true, voice: VOICE })
    assert.equal(JSON.parse(flow.calls[1].body).type, 'digital_twin')
    assert.deepEqual([made.heygen.voice, made.heygen.voiceId, made.heygen.consentStatus, made.heygen.consentUrl], ['heygen', 'voice_t', 'pending', 'https://app.heygen.com/consent/1'])
    assert.equal(fs.existsSync(path.join(flow.drafts, `${draft}.mp4`)), false, 'the footage draft is removed once sent')
    assert.equal(await flow.mod.heygenConsentUrl(made.id), 'https://app.heygen.com/consent/1')
    assert.equal(consents, 1)
    const stale = flow.saved.get(made.id)
    stale.heygen.consentUrlAt = new Date(Date.now() - 25 * 3600_000).toISOString()
    assert.equal(await flow.mod.heygenConsentUrl(made.id), 'https://app.heygen.com/consent/2')
    assert.equal(consents, 2)
  } finally { flow.cleanup() }
})

test('a take: audio uploaded, 9:16 video created, polled to completion, downloaded, and its cost recorded (an estimate as it starts, then its length)', async () => {
  let polls = 0
  const flow = avatarFlow({ avatar: { ...READY_TWIN, heygen: { ...READY_TWIN.heygen, voice: 'app' } }, routes: {
    'POST /v3/assets': () => json({ data: { asset_id: 'ast_audio', url: 'https://files.heygen.ai/a.mp3', mime_type: 'audio/mpeg', size_bytes: 5 } }),
    'POST /v3/videos': () => json({ data: { video_id: 'v_9', status: 'waiting' } }),
    'GET /v3/videos/v_9': () => { polls++; return json({ data: polls < 3 ? { id: 'v_9', status: polls === 1 ? 'pending' : 'processing' } : { id: 'v_9', status: 'completed', video_url: 'https://files.heygen.ai/v_9.mp4', duration: 12.5 } }) },
    'GET https://files.heygen.ai/v_9.mp4': () => new Response('finished-video')
  } })
  try {
    const audio = path.join(flow.dir, 'narration.mp3')
    fs.writeFileSync(audio, 'mp3!!')
    const statuses = []
    const take = await flow.mod.renderHeygenTake({ avatarId: READY_TWIN.id, audioPath: audio, outPath: path.join(flow.dir, 'take.mp4'), pollMs: 1, onStatus: (detail) => statuses.push(detail), sleep: async () => {} })
    assert.deepEqual(plain(take), { videoId: 'v_9', path: path.join(flow.dir, 'take.mp4'), seconds: 12.5, estimatedUsd: 1.25 })
    assert.equal(fs.readFileSync(take.path, 'utf8'), 'finished-video')
    const body = JSON.parse(flow.calls.find((call) => call.key === 'POST /v3/videos').body)
    assert.deepEqual(body, { type: 'avatar', avatar_id: 'look_1', aspect_ratio: '9:16', resolution: '1080p', fit: 'cover', output_format: 'mp4', audio_asset_id: 'ast_audio' })
    assert.equal(flow.calls.find((call) => call.key === 'POST /v3/assets').body.get('file').type, 'audio/mpeg')
    assert.ok(statuses.includes('Waiting in HeyGen’s queue') && statuses.includes('HeyGen is animating your avatar'))
    // Recorded the moment HeyGen accepts it (the audio couldn't be measured here: at least a second), then replaced by the finished length.
    assert.deepEqual(plain(flow.spend), [
      { kind: 'avatar', provider: 'heygen', ref: 'heygen:v_9', estimated: true, usd: 0.1, label: 'HeyGen avatar video' },
      { kind: 'avatar', provider: 'heygen', ref: 'heygen:v_9', estimated: true, usd: 1.25, label: 'HeyGen avatar video' }
    ])
    assert.deepEqual(flow.calls.find((call) => call.url.startsWith('https://files.heygen.ai/')).headers, {}, 'the download carries no key')
  } finally { flow.cleanup() }
})

test('a take spoken by HeyGen sends the script and the avatar’s voice; Remix can record it under its own kind', async () => {
  const flow = avatarFlow({ avatar: READY_TWIN, routes: {
    'POST /v3/videos': () => json({ data: { video_id: 'v_s', status: 'waiting' } }),
    'GET /v3/videos/v_s': () => json({ data: { id: 'v_s', status: 'completed', video_url: 'https://files.heygen.ai/v_s.mp4', duration: 4 } }),
    'GET https://files.heygen.ai/v_s.mp4': () => new Response('v')
  } })
  try {
    await flow.mod.renderHeygenTake({ avatarId: READY_TWIN.id, text: 'Say this.', outPath: path.join(flow.dir, 's.mp4'), spendKind: 'remix', sleep: async () => {} })
    const body = JSON.parse(flow.calls[0].body)
    assert.deepEqual([body.script, body.voice_id, body.audio_asset_id], ['Say this.', 'voice_clone', undefined])
    assert.deepEqual(flow.spend.map((entry) => [entry.kind, entry.ref, entry.usd]), [['remix', 'heygen:v_s', 0.1], ['remix', 'heygen:v_s', 0.4]], 'two words: at least a second; then 4 seconds')
  } finally { flow.cleanup() }
})

test('a failed video gives HeyGen’s reason; its started estimate is removed; an empty balance says so plainly', async () => {
  for (const [failure, pattern] of [[{ failure_code: 'insufficient_credit', failure_message: 'Need 10 credits' }, /HeyGen balance is too low/], [{ failure_code: 'video_too_long', failure_message: 'Too long' }, /could not make this video \(video_too_long\)\. HeyGen says: Too long/]]) {
    const flow = avatarFlow({ avatar: READY_TWIN, routes: {
      'POST /v3/videos': () => json({ data: { video_id: 'v_f', status: 'waiting' } }),
      'GET /v3/videos/v_f': () => json({ data: { id: 'v_f', status: 'failed', ...failure } })
    } })
    try {
      await assert.rejects(flow.mod.renderHeygenTake({ avatarId: READY_TWIN.id, text: 'Hi', outPath: path.join(flow.dir, 'f.mp4'), sleep: async () => {} }), (error) => pattern.test(error.message) && error.videoFailed === true)
      assert.deepEqual(flow.spend.map((entry) => [entry.ref, entry.usd]), [['heygen:v_f', 0.1], ['heygen:v_f', 0]], 'HeyGen doesn’t bill a video that fails there')
    } finally { flow.cleanup() }
  }
})

test('nothing is created on HeyGen while consent is pending, rejected, or the avatar is still training', async () => {
  for (const [group, look, pattern] of [
    [{ consent_status: 'pending', status: 'pending_consent' }, { status: 'completed' }, /needs your consent recording/],
    [{ consent_status: 'rejected', status: 'failed', error: { code: 'consent_rejected', message: 'Please make sure your consent video is under 35s.' } }, { status: 'completed' }, /didn’t accept the consent recording: Please make sure your consent video is under 35s\./],
    [{ consent_status: 'accepted', status: 'processing' }, { status: 'processing' }, /still training/]
  ]) {
    const flow = avatarFlow({ avatar: { ...READY_TWIN, heygen: { ...READY_TWIN.heygen, status: 'processing', consentStatus: null } }, routes: {
      'GET /v3/avatars/looks/look_1': () => json({ data: { id: 'look_1', name: 'Me', avatar_type: 'digital_twin', ...look } }),
      'GET /v3/avatars/ag_1': () => json({ data: { id: 'ag_1', name: 'Me', created_at: 1, looks_count: 1, ...group } })
    } })
    try {
      await assert.rejects(flow.mod.renderHeygenTake({ avatarId: READY_TWIN.id, text: 'Hi', outPath: path.join(flow.dir, 'x.mp4'), sleep: async () => {} }), pattern)
      assert.ok(!flow.calls.some((call) => call.key === 'POST /v3/videos'))
    } finally { flow.cleanup() }
  }
})

test('a canceled take stops polling (HeyGen has no cancel call) and keeps the estimate recorded when HeyGen accepted it', async () => {
  const controller = new AbortController()
  const flow = avatarFlow({ avatar: READY_TWIN, routes: {
    'POST /v3/videos': () => json({ data: { video_id: 'v_c', status: 'waiting' } }),
    'GET /v3/videos/v_c': () => { controller.abort(); return json({ data: { id: 'v_c', status: 'processing' } }) }
  } })
  try {
    const sleep = (ms, signal) => signal?.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve()
    const started = []
    await assert.rejects(flow.mod.renderHeygenTake({ avatarId: READY_TWIN.id, text: 'Hi', outPath: path.join(flow.dir, 'c.mp4'), signal: controller.signal, sleep, onStarted: (id) => started.push(id) }), { name: 'AbortError' })
    assert.deepEqual(started, ['v_c'])
    // HeyGen may still finish and bill it: the started estimate stays in the ledger.
    assert.deepEqual(plain(flow.spend), [{ kind: 'avatar', provider: 'heygen', ref: 'heygen:v_c', estimated: true, usd: 0.1, label: 'HeyGen avatar video' }])
  } finally { flow.cleanup() }
})

test('a take whose wait fails (deadline, download) after HeyGen accepted it keeps its estimate; nothing is recorded before HeyGen accepts', async () => {
  const flow = avatarFlow({ avatar: READY_TWIN, routes: {
    'POST /v3/videos': () => json({ data: { video_id: 'v_d', status: 'waiting' } }),
    'GET /v3/videos/v_d': () => json({ data: { id: 'v_d', status: 'processing' } })
  } })
  try {
    const words = Array.from({ length: 26 }, () => 'word').join(' ')
    await assert.rejects(flow.mod.renderHeygenTake({ avatarId: READY_TWIN.id, text: words, outPath: path.join(flow.dir, 'd.mp4'), timeoutMs: -1, sleep: async () => {} }), /taking unusually long/)
    assert.deepEqual(flow.spend.map((entry) => [entry.ref, entry.usd]), [['heygen:v_d', 1]], 'about 10 seconds of speech at the published price')
  } finally { flow.cleanup() }
  const refused = avatarFlow({ avatar: READY_TWIN, routes: { 'POST /v3/videos': () => json({ error: { code: 'invalid_parameter', message: 'Bad' } }, 400) } })
  try {
    await assert.rejects(refused.mod.renderHeygenTake({ avatarId: READY_TWIN.id, text: 'Hi', outPath: path.join(refused.dir, 'r.mp4'), sleep: async () => {} }))
    assert.deepEqual(refused.spend, [])
  } finally { flow.cleanup() }
})

test('the HeyGen voice can only be chosen once HeyGen has one for the avatar', async () => {
  const flow = avatarFlow({ avatar: { ...READY_TWIN, heygen: { ...READY_TWIN.heygen, voiceId: null, voice: 'app' } } })
  try {
    await assert.rejects(flow.mod.setHeygenVoice(READY_TWIN.id, 'heygen'), /no voice for this avatar yet/)
    await assert.rejects(flow.mod.setHeygenVoice(READY_TWIN.id, 'other'), /Choose a voice/)
    const [after] = await flow.mod.setHeygenVoice(READY_TWIN.id, 'app')
    assert.equal(after.heygen.voice, 'app')
  } finally { flow.cleanup() }
})

test('without a HeyGen key nothing is attempted', async () => {
  const flow = avatarFlow({ avatar: READY_TWIN, settings: { heygenApiKey: '' } })
  try {
    await assert.rejects(flow.mod.heygenAccount(), /Add your HeyGen key/)
    await assert.rejects(flow.mod.renderHeygenTake({ avatarId: READY_TWIN.id, text: 'Hi', outPath: path.join(flow.dir, 'x.mp4') }), /Add your HeyGen key/)
    assert.equal(flow.calls.length, 0)
  } finally { flow.cleanup() }
})

test('twin footage gets a bitrate that keeps the upload under HeyGen’s 32 MB limit', () => {
  const flow = avatarFlow()
  try {
    for (const seconds of [15, 60, 120, 180]) {
      const kbps = flow.mod.twinBitrateKbps(seconds)
      assert.ok(((kbps + 128) * 1000 / 8) * seconds < 32 * 1024 * 1024, `${seconds}s at ${kbps}k`)
    }
  } finally { flow.cleanup() }
})

// ---------------------------------------------------------------------------
// Settings: the key is stored encrypted like the others
// ---------------------------------------------------------------------------

test('the HeyGen key is saved encrypted, read back, shown only as "configured", and redactable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-settings-'))
  const userData = path.join(root, 'user-data')
  const store = load('main/settings-store.ts', { electron: {
    app: { getPath: (name) => ({ home: root, appData: root, userData }[name]), isReady: () => true },
    safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: (value) => Buffer.from(`enc:${value}`), decryptString: (value) => value.toString().slice(4) }
  } })
  try {
    const view = store.replaceApiKey('heygenApiKey', `  ${KEY}  `)
    assert.equal(view.heygenConfigured, true)
    assert.ok(!JSON.stringify(view).includes(KEY))
    const file = fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')
    assert.ok(!file.includes(KEY), 'never stored in plain text')
    assert.equal(JSON.parse(file).heygenApiKey.scheme, 'safeStorage')
    assert.equal(store.loadSettings().heygenApiKey, KEY)
    assert.ok(!JSON.stringify(store.getSettingsForBridge(store.loadSettings())).includes(KEY), 'never passed to the engine')
    assert.equal(store.replaceApiKey('heygenApiKey', '').heygenConfigured, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// The spending check before paid HeyGen work
// ---------------------------------------------------------------------------

test('making a HeyGen avatar is a gated channel; the monthly limit stops it before HeyGen is called', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-spend-'))
  try {
    const main = load('main/spending.ts', {
      electron: { app: { getPath: () => userData } },
      './logger': { logger: { info() {}, warn() {} } },
      './settings-store': { loadSettings: () => ({ openrouterApiKey: '', heygenApiKey: KEY, outputDirectory: userData, monthlySpendLimitUsd: '1.50' }) },
      './file-manager': { getJobHistory: async () => [] },
      './openrouter-media': { openRouterBase: () => 'https://openrouter.test/api/v1', onMediaCharge: () => {} }
    })
    assert.ok(main.GATED_CHANNELS.has('heygen:createAvatar'))
    assert.ok(main.GATED_CHANNELS.has('avatars:render'))
    await main.assertSpendAllowed('heygen:createAvatar', 'heygen', shared.HEYGEN_PRICES.avatarCreation)
    await main.recordSpend({ kind: 'avatar', provider: 'heygen', usd: 1, label: 'HeyGen photo avatar', estimated: true })
    const blocked = await main.assertSpendAllowed('heygen:createAvatar', 'heygen', shared.HEYGEN_PRICES.avatarCreation).catch((error) => error)
    const gate = spendingShared.decodeSpendGate(blocked.message)
    assert.deepEqual([gate.reason, gate.provider, gate.canOverride], ['limit', 'heygen', false])
    const overview = plain(await main.spendOverview())
    assert.equal(overview.heygenConfigured, true)
    assert.equal(overview.summary.recent[0].provider, 'heygen')
  } finally { fs.rmSync(userData, { recursive: true, force: true }) }
})

test('the check before a render: HeyGen-voiced talking heads are priced per second on HeyGen; other styles are unchanged', () => {
  const settings = { openrouterApiKey: 'or-key', heygenApiKey: KEY, outputDirectory: os.tmpdir(), pythonPath: 'python3' }
  const studio = (avatar) => load('main/avatar-studio.ts', {
    electron: { app: { isPackaged: true } },
    './avatars': { portraitInput: async () => 'data:', readAvatar: () => avatar },
    './heygen-avatar': { heygenKey: () => KEY, renderHeygenTake: async () => ({}), heygenRenderEstimate: (a, seconds) => shared.estimateHeygenVideoUsd(seconds, shared.heygenEngine(a.heygen.engines)) },
    './backgrounds': { resolveBackground: (name) => `/library/${name}` },
    './logger': { logger: { warn() {}, info() {} } },
    './pipeline-runner': { getBridgeRunnerPath: () => '/b/bridge_runner.py', getEnginePath: () => '/engine', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
    './settings-store': { loadSettings: () => settings },
    './tools': { resolveBinary: (name) => name }
  })
  // 26 words is about 10 seconds of speech: $1.00 at $0.10 a second.
  const narration = Array.from({ length: 26 }, () => 'word').join(' ')
  const request = { avatarId: READY_TWIN.id, style: 'talking', captionPreset: 'beast', script: { title: 'Hook', scenes: [{ narration }] } }
  assert.deepEqual(plain(studio(READY_TWIN).renderSpendCheck(request)), { provider: 'heygen', estimateUsd: 1, openrouterUsd: null })
  const appVoice = plain(studio({ ...READY_TWIN, heygen: { ...READY_TWIN.heygen, voice: 'app' } }).renderSpendCheck(request))
  assert.equal(appVoice.provider, 'openrouter')
  assert.ok(appVoice.estimateUsd > 1 && appVoice.estimateUsd < 1.1, 'HeyGen plus the voice on OpenRouter')
  assert.ok(appVoice.openrouterUsd > 0 && appVoice.openrouterUsd < 0.1, 'only the voice is compared with the OpenRouter balance')
  assert.deepEqual(plain(studio({ ...READY_TWIN, heygen: { ...READY_TWIN.heygen, engines: ['avatar_iii'] } }).renderSpendCheck(request)), { provider: 'heygen', estimateUsd: null, openrouterUsd: null }, 'billed by HeyGen: no number')
  const plainAvatar = { ...READY_TWIN, heygen: null }
  assert.equal(studio(plainAvatar).renderSpendCheck(request).provider, 'openrouter')
  const cinematic = { ...request, style: 'cinematic', script: { title: '', scenes: [{ narration: 'Hi there.', visual: 'A desk', featuresAvatar: true }] } }
  assert.equal(studio(READY_TWIN).renderSpendCheck(cinematic).provider, 'openrouter', 'cinematic scenes stay on OpenRouter')
})
