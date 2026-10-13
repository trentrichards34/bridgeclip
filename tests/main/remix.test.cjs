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
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/remix.ts')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-test-'))
const SETTINGS = { openrouterApiKey: 'or-key', outputDirectory: userData, pythonPath: 'python3' }
const selected = new Set()
const main = load('main/remix.ts', {
  electron: { app: { getPath: () => userData } },
  './avatars': { portraitPath: (id) => path.join(userData, id, 'portrait.jpg'), readAvatar: () => ({}) },
  './logger': { logger: { info() {}, warn() {} } },
  './pipeline-runner': { getBridgeRunnerPath: () => '/x/bridge_runner.py', getEnginePath: () => '/x', resolvePythonPath: () => 'python3', runtimeEnvironment: () => ({}), validatePython: async () => ({ ok: true }) },
  './security': { assertMediaPath: (p) => { if (!selected.has(p)) throw new Error('Invalid media path') } },
  './settings-store': { loadSettings: () => SETTINGS, getSettingsForBridge: () => ({}) },
  './tools': { resolveBinary: (name) => name }
})

const base = {
  source: 'https://www.youtube.com/watch?v=abcdefghijk', creator: '', angle: 'reaction', host: 'lipsync', avatarId: 'a'.repeat(16),
  voice: 'onyx', brandIdentityId: null, count: 3, captionPreset: 'pop', includeCaptions: true, aiLabelAck: true
}

test('remix requests: links or chosen files, a style, a presenter, a voice, and the AI-label promise', () => {
  const { request, sourceIsUrl } = main.parseRemixRequest(base, userData)
  assert.equal(sourceIsUrl, true)
  assert.equal(request.source, 'https://www.youtube.com/watch?v=abcdefghijk')
  assert.equal(main.parseRemixRequest({ ...base, host: 'voice', avatarId: 'junk' }, userData).request.avatarId, null)

  assert.throws(() => main.parseRemixRequest({ ...base, source: '' }, userData), /video link/)
  assert.throws(() => main.parseRemixRequest({ ...base, source: 'https://user:pw@example.com/v' }, userData), /full video link/)
  assert.throws(() => main.parseRemixRequest({ ...base, source: '/etc/passwd' }, userData), /full video link/)
  assert.throws(() => main.parseRemixRequest({ ...base, angle: 'repost' }, userData), /remix style/)
  assert.throws(() => main.parseRemixRequest({ ...base, host: 'clone' }, userData), /presenter/)
  assert.throws(() => main.parseRemixRequest({ ...base, avatarId: null }, userData), /Choose an avatar/)
  assert.throws(() => main.parseRemixRequest({ ...base, voice: 'Morgan Freeman' }, userData), /voice/)
  assert.throws(() => main.parseRemixRequest({ ...base, count: 11 }, userData), /between 1 and 10/)
  assert.throws(() => main.parseRemixRequest({ ...base, captionPreset: 'nope' }, userData), /caption style/)
  assert.throws(() => main.parseRemixRequest({ ...base, aiLabelAck: false }, userData), /AI-content label/)
  assert.throws(() => main.parseRemixRequest({ ...base, brandIdentityId: '../x' }, userData), /brand identity/)

  // A local file must have been chosen in the file dialog and needs the creator's name for the credit.
  const file = path.join(userData, 'clip.mp4')
  selected.add(file)
  assert.throws(() => main.parseRemixRequest({ ...base, source: file }, userData), /original creator/)
  assert.equal(main.parseRemixRequest({ ...base, source: file, creator: ' Coach  Example ' }, userData).request.creator, 'Coach Example')
})

test('brand identities are saved, listed newest first, updated in place and removed', async () => {
  assert.deepEqual(plain(await main.listBrandIdentities()), [])
  await assert.rejects(main.saveBrandIdentity({ name: '', text: 'x'.repeat(100) }), /name/)
  await assert.rejects(main.saveBrandIdentity({ name: 'Pull-Up Lab', text: 'too short' }), /Paste the brand identity/)
  const text = 'We believe strength comes before weight loss. Our clients get their first pull-up in 6 weeks.'
  let list = await main.saveBrandIdentity({ name: '  Pull-Up   Lab ', text })
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'Pull-Up Lab')
  const id = list[0].id
  list = await main.saveBrandIdentity({ id, name: 'Pull-Up Lab v2', text: `${text} Updated.` })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, id)
  assert.equal(list[0].name, 'Pull-Up Lab v2')
  assert.equal((await main.readBrandIdentity(id)).text.endsWith('Updated.'), true)
  await assert.rejects(main.saveBrandIdentity({ id: 'f'.repeat(16), name: 'X', text }), /could not be found/)
  assert.deepEqual(plain(await main.removeBrandIdentity(id)), [])
})

test('brand identity files: text or markdown only', async () => {
  const md = path.join(userData, 'Pull Up Brand.md')
  fs.writeFileSync(md, '# Beliefs\r\nStrength first.\r\n')
  assert.deepEqual(plain(await main.readBrandIdentityFile(md)), { name: 'Pull Up Brand', text: '# Beliefs\nStrength first.' })
  const pdf = path.join(userData, 'brand.pdf')
  fs.writeFileSync(pdf, '%PDF')
  await assert.rejects(main.readBrandIdentityFile(pdf), /\.txt or \.md/)
})

test('engine results are parsed defensively', () => {
  assert.equal(shared.parseRemixOutput(null), null)
  assert.equal(shared.parseRemixOutput({ path: 1 }), null)
  const out = shared.parseRemixOutput({
    path: '/o/01 x.mp4', manifest_path: '/o/01 x.json', headline: '  He   said what ', stance: 'evil', excerpt_seconds: 4.2, duration_seconds: 'x',
    cost_usd: 0.61, checks: [{ id: 'credited', ok: true, label: 'Credited' }, { bogus: 1 }], warnings: ['w', 5]
  })
  assert.deepEqual(plain(out), {
    path: '/o/01 x.mp4', manifestPath: '/o/01 x.json', headline: 'He said what', stance: 'add_nuance', excerptSeconds: 4.2, durationSeconds: 0, costUsd: 0.61,
    checks: [{ id: 'credited', ok: true, label: 'Credited' }], warnings: ['w']
  })
})

test('cost estimate: the on-camera avatar is the main cost, voice-only is cents', () => {
  const lipsync = shared.estimateRemixCost('lipsync', 1, 0.5)
  const voice = shared.estimateRemixCost('voice', 1, 0.5)
  assert.ok(lipsync.perRemix > 0.5 && lipsync.perRemix < 1)
  assert.ok(voice.perRemix < 0.05)
  assert.ok(shared.estimateRemixCost('lipsync', 3, 1).total > lipsync.total)
  assert.equal(shared.remixSourceUrl('ftp://x.com/a'), null)
  assert.equal(shared.remixSourceUrl('https://localhost/a'), null)
})
