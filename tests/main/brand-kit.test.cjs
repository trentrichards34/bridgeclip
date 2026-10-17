const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))

function load(relative, mocks = {}) {
  const module = { exports: {} }
  const dir = path.dirname(path.join(ROOT, relative))
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, {
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const kit = load('shared/brand-kit.ts')
const prefs = load('shared/member-prefs.ts')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-kit-test-'))
const brands = load('main/brands.ts', {
  electron: { app: { getPath: () => userData } },
  './security': { authorizeMedia: (p) => p },
  './tools': { resolveBinary: (name) => name }
})
const ID = 'a1b2c3d4e5f60718'
const TEXT = 'Core promise: pull-ups for busy parents. Voice: plain and warm. Proof: Dana did 5 pull-ups.'
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('brand files saved before the kit still read, with an empty look', async () => {
  const dir = path.join(userData, 'brand-identities')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${ID}.json`), JSON.stringify({ id: ID, name: 'Old brand', text: TEXT, createdAt: '2026-01-01', updatedAt: '2026-01-01' }))
  const brand = await brands.readBrandIdentity(ID)
  assert.deepEqual([brand.name, brand.text, plain(brand.look)], ['Old brand', TEXT, {}])
  assert.equal('logoPath' in brand, false)
  // A damaged look field is dropped, not the brand.
  fs.writeFileSync(path.join(dir, `${ID}.json`), JSON.stringify({ id: ID, name: 'Old brand', text: TEXT, look: { color: 'red', handle: '@coach', captionPreset: 'nope', handlePosition: 'top-left', logo: '../x.png' } }))
  assert.deepEqual(plain((await brands.readBrandIdentity(ID)).look), { handle: '@coach', handlePosition: 'top-left' })
})

test('saving a look: validated field by field, brand color carried into the hook bar', async () => {
  const list = await brands.saveBrandIdentity({
    id: ID, name: 'Pull-Up Lab', text: TEXT,
    look: { color: '#ff8800', headlineLook: { look: 'brand', color: '#000000', font: 'serif' }, captionPreset: 'boxed', ctaId: 'b1b2c3d4e5f60718',
      ctaKeyword: 'pull', ctaOffer: '  my   4-week plan ', handle: '  @pullup lab ', handlePosition: 'top-right' }
  })
  const saved = list.find((item) => item.id === ID)
  assert.deepEqual(plain(saved.look), {
    color: '#FF8800', headlineLook: { look: 'brand', color: '#FF8800', font: 'serif' }, captionPreset: 'boxed', ctaId: 'b1b2c3d4e5f60718',
    ctaKeyword: 'PULL', ctaOffer: 'my 4-week plan', handle: '@pullup lab', handlePosition: 'top-right'
  })
  const bad = [
    [{ color: 'orange' }, /brand color/], [{ headlineLook: { look: 'neon' } }, /hook text/], [{ captionPreset: 'comic' }, /caption style/],
    [{ ctaId: '../etc' }, /call to action/], [{ ctaKeyword: 'two words' }, /one word/], [{ ctaOffer: 'x'.repeat(81) }, /under 80/],
    [{ handle: 'x'.repeat(31) }, /30 characters/], [{ handle: 'a\nb' }, /30 characters/], [{ handlePosition: 'middle' }, /corner/],
    [{ logo: 'logo.png' }, /logo again/], [{ logo: 'abcdefabcdefabcd.png' }, /logo is missing/], [{ extra: true }, /look/], ['red', /look/]
  ]
  for (const [look, message] of bad) {
    await assert.rejects(brands.saveBrandIdentity({ id: ID, name: 'Pull-Up Lab', text: TEXT, look }), message, JSON.stringify(look))
  }
})

test('a logo: PNG, JPG or WebP under 5 MB, read as an image, stored as a PNG and removed with the brand', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-logo-src-'))
  await assert.rejects(brands.importBrandLogo(path.join(dir, 'logo.gif')), /PNG, JPG or WebP/)
  const big = path.join(dir, 'big.png')
  fs.writeFileSync(big, Buffer.alloc(0)); fs.truncateSync(big, 5 * 1024 * 1024 + 1)
  await assert.rejects(brands.importBrandLogo(big), /under 5 MB/)
  const fake = path.join(dir, 'fake.png')
  fs.writeFileSync(fake, 'not an image')
  await assert.rejects(brands.importBrandLogo(fake), /could not be read/)
  const real = path.join(dir, 'logo.png')
  fs.writeFileSync(real, PNG)
  const { logo, path: stored } = await brands.importBrandLogo(real)
  assert.match(logo, /^[a-f0-9]{16}\.png$/)
  assert.equal(stored, path.join(userData, 'brand-logos', logo))
  assert.ok(fs.existsSync(stored))
  const list = await brands.saveBrandIdentity({ id: ID, name: 'Pull-Up Lab', text: TEXT, look: { logo, handlePosition: 'bottom-left' } })
  assert.equal(list.find((item) => item.id === ID).logoPath, stored)
  // The run's own copy of the logo, for re-making videos later; nothing when the toggle is off.
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-run-'))
  const brand = await brands.readBrandIdentity(ID)
  assert.equal(await brands.brandMarkForRun(brand, false, run), null)
  assert.deepEqual(plain(await brands.brandMarkForRun(brand, true, run)), { handle: '', logo_path: path.join(run, '.brand-logo.png'), position: 'bottom-left' })
  assert.deepEqual(plain(brands.brandForJob(ID, true).mark), { handle: '', logo_path: stored, position: 'bottom-left' })
  assert.equal(brands.brandForJob(ID, false).mark, null)
  assert.equal(brands.brandForJob(ID, true).text, TEXT)
  // Create runs get their own copy of the logo in the run folder, like Remix.
  const createRun = path.join(run, 'create-run')
  assert.deepEqual(plain(brands.brandForJob(ID, true, createRun).mark), { handle: '', logo_path: path.join(createRun, '.brand-logo.png'), position: 'bottom-left' })
  assert.deepEqual(fs.readFileSync(path.join(createRun, '.brand-logo.png')), fs.readFileSync(stored))
  // Replacing the logo removes the old file; deleting the brand removes its logo.
  const second = await brands.importBrandLogo(real)
  await brands.saveBrandIdentity({ id: ID, name: 'Pull-Up Lab', text: TEXT, look: { logo: second.logo } })
  assert.equal(fs.existsSync(stored), false)
  await brands.removeBrandIdentity(ID)
  assert.equal(fs.existsSync(second.path), false)
  assert.throws(() => brands.brandForJob(ID, true), /was deleted/)
  // The run's copy is untouched by the change.
  assert.ok(fs.existsSync(path.join(createRun, '.brand-logo.png')))
})

test('picking a brand fills only the fields it sets', () => {
  const form = {
    headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, captionPreset: 'pop', ctaId: null, ctaKeyword: '', ctaOffer: '', showHandle: false,
    camera: { layout: 'cutout', backdrop: 'brand', backdropColor: '#111111', talk: false }, imageCamera: { layout: 'greenscreen', backdrop: 'blur', backdropColor: '#111111', talk: true }
  }
  assert.deepEqual(plain(kit.brandFormPatch(undefined, form)), {})
  assert.deepEqual(plain(kit.brandFormPatch({}, form)), {})
  assert.deepEqual(plain(kit.brandFormPatch({ color: '#FF8800' }, form)), {
    headlineLook: { look: 'white', color: '#FF8800', font: 'clean' },
    camera: { ...form.camera, backdropColor: '#FF8800' }, imageCamera: { ...form.imageCamera, backdropColor: '#FF8800' }
  })
  const full = kit.brandFormPatch({ color: '#FF8800', headlineLook: { look: 'brand', color: '#000000', font: 'serif' }, captionPreset: 'boxed', ctaId: 'b1b2c3d4e5f60718',
    ctaKeyword: 'PULL', handle: '@coach' }, { ...form, camera: undefined, imageCamera: undefined })
  assert.deepEqual(plain(full), {
    headlineLook: { look: 'brand', color: '#FF8800', font: 'serif' }, captionPreset: 'boxed', ctaId: 'b1b2c3d4e5f60718', ctaKeyword: 'PULL', ctaOffer: '', showHandle: true
  })
  assert.equal(kit.hasBrandMark({ logo: 'abcdefabcdefabcd.png' }), true)
  assert.equal(kit.hasBrandMark({ color: '#FFFFFF' }), false)
  assert.equal(kit.normalizeHandle('  @coach   name '), '@coach name')
  assert.equal(kit.normalizeHandle('x'.repeat(31)), null)
  // The same words Remix ends with.
  assert.equal(kit.createCtaLine('PULL', 'my plan.'), 'Comment PULL and I\'ll send you my plan.')
  assert.equal(kit.createCtaLine('', 'my plan'), '')
})

test('Create remembers its brand, keyword and handle choice', () => {
  const style = prefs.parseCreateStyle({ brandIdentityId: ID, ctaKeyword: 'PULL', ctaOffer: 'my plan', showHandle: true, captionPreset: 'pop' })
  assert.deepEqual(plain(style), { captionPreset: 'pop', brandIdentityId: ID, ctaKeyword: 'PULL', ctaOffer: 'my plan', showHandle: true })
  assert.deepEqual(plain(prefs.parseCreateStyle({ brandIdentityId: '../x', ctaKeyword: 'two words', ctaOffer: 'a\nb', showHandle: 'yes' })), {})
  assert.equal(prefs.parseCreateStyle({ brandIdentityId: null }).brandIdentityId, null)
  assert.equal(prefs.parseRemixStyle({ showHandle: true }).showHandle, true)
  const known = { ctaIds: new Set(), avatarIds: new Set(), brandIds: new Set(), backgrounds: new Set() }
  const parsed = prefs.parseMemberPrefs({ create: { brandIdentityId: ID }, presets: { create: [{ id: 'c'.repeat(16), name: 'Mine', style: { brandIdentityId: ID } }] } })
  const dropped = prefs.dropMissing(parsed, known)
  assert.equal(dropped.create.brandIdentityId, null)
  assert.equal(dropped.presets.create[0].style.brandIdentityId, null)
  assert.equal(prefs.dropMissing(parsed, { ...known, brandIds: new Set([ID]) }).create.brandIdentityId, ID)
})

test('Create requests: brand id, keyword and handle are checked', () => {
  const { validateJobConfig } = load('main/validation.ts', { './security': { isWebUrl: (url) => /^https?:\/\//.test(url) } })
  const base = {
    workflow: 'automatic', videoUrl: 'https://example.com/v', maxClips: null, autoClipCount: true, durationRanges: null, aspectRatio: '9:16', layoutStyle: 'auto',
    layoutVision: false, pacing: 'tight', includeCaptions: true, captionPreset: 'pop', startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null
  }
  const config = validateJobConfig({ ...base, brandIdentityId: ID, ctaKeyword: ' pull ', ctaOffer: '  my   plan ', showHandle: true })
  assert.deepEqual([config.brandIdentityId, config.ctaKeyword, config.ctaOffer, config.showHandle], [ID, 'PULL', 'my plan', true])
  const none = validateJobConfig({ ...base, ctaKeyword: '', ctaOffer: 'ignored', showHandle: false })
  assert.deepEqual(['ctaKeyword' in none, 'ctaOffer' in none, 'showHandle' in none], [false, false, false])
  assert.throws(() => validateJobConfig({ ...base, brandIdentityId: '../brand' }), /brand identity/)
  assert.throws(() => validateJobConfig({ ...base, ctaKeyword: 'two words' }), /one word/)
  assert.throws(() => validateJobConfig({ ...base, ctaKeyword: 'PULL', ctaOffer: 'x'.repeat(81) }), /under 80/)
  assert.throws(() => validateJobConfig({ ...base, showHandle: true }), /needs a brand/)
  assert.throws(() => validateJobConfig({ ...base, workflow: 'review', ctaKeyword: 'PULL' }), /Automatic/)
  // Brand text guides review projects too.
  assert.equal(validateJobConfig({ ...base, workflow: 'review', brandIdentityId: ID }).brandIdentityId, ID)
})
