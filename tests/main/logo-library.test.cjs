// My logos in main: logos copied in once (PNG, JPEG, WebP or SVG drawn to PNG, size cap, checked by their bytes), named
// with the words said for them, renamed, removed, handed to Create and Edit my recording, copied into runs.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
const plain = (value) => JSON.parse(JSON.stringify(value))
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')

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

function setup() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-logos-'))
  const sources = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-logos-src-'))
  const imported = []
  const lib = load('main/logo-library.ts', {
    electron: { app: { getPath: () => userData }, BrowserWindow: function () { throw new Error('no window in tests') }, session: {} },
    './security': { authorizeMedia: (p) => p },
    './graphics-render': {
      graphicImageKind: (bytes) => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : null,
      importGraphicImage: (run, file) => { imported.push([run, file]); return 'name.png' }
    }
  })
  return { userData, sources, imported, lib }
}

const shared = load('shared/logos.ts')

test('names and aliases are cleaned: one line, no repeats, at most six, never the name again', () => {
  assert.equal(shared.cleanLogoName('  Meta\n Ads <b> '), 'Meta Ads b')
  assert.deepEqual(plain(shared.cleanLogoAliases('Facebook, meta, FB, , facebook', 'Meta')), ['Facebook', 'FB'])
  assert.equal(shared.cleanLogoAliases(Array.from({ length: 10 }, (_, i) => `a${i}`)).length, shared.MAX_LOGO_ALIASES)
  assert.ok(shared.isLogoId('0123456789abcdef') && !shared.isLogoId('../x') && !shared.isLogoId(5))
})

test('logos are added (checked by bytes, size cap, SVG drawn to PNG), renamed, removed and handed to the engine', async () => {
  const { sources, imported, lib } = setup()
  const png = path.join(sources, 'meta_logo.png')
  fs.writeFileSync(png, PNG)
  let list = await lib.addLogo(png)
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'meta logo')
  // A file that only says it is a picture, a wrong type, an empty or huge file: refused.
  const fake = path.join(sources, 'fake.png'); fs.writeFileSync(fake, 'hello')
  await assert.rejects(lib.addLogo(fake), /could not be read/)
  const exe = path.join(sources, 'x.exe'); fs.writeFileSync(exe, PNG)
  await assert.rejects(lib.addLogo(exe), /PNG, JPEG, WebP or SVG/)
  const big = path.join(sources, 'big.png'); fs.writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(shared.MAX_LOGO_BYTES)]))
  await assert.rejects(lib.addLogo(big), /under 5 MB/)
  // SVG: only an <svg> document, drawn to a PNG (never stored as SVG).
  assert.equal(lib.svgText(Buffer.from('<html><script>x</script></html>')), null)
  assert.ok(lib.svgText(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')))
  lib.setSvgRasterizer(async () => PNG)
  const svg = path.join(sources, 'claude.svg'); fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')
  list = await lib.addLogo(svg)
  assert.equal(list.length, 2)
  assert.match(list[1].path, /logo\.png$/)
  // Rename and other words for it.
  list = await lib.updateLogo(list[0].id, { name: 'Meta', aliases: ['Facebook', 'meta', 'Instagram ads'] })
  assert.deepEqual(plain(list[0].aliases), ['Facebook', 'Instagram ads'])
  await assert.rejects(lib.updateLogo(list[0].id, { name: '  ' }), /name/)
  await assert.rejects(lib.updateLogo('../../etc', { name: 'x' }), /no longer/)
  // For the engine: Create gets content names, Edit library ids; runs get copies.
  const create = lib.logosForEngine()
  assert.equal(create.length, 2)
  assert.match(create[0].image, /^[0-9a-f]{16}\.png$/)
  assert.deepEqual(plain(create[0].aliases), ['Facebook', 'Instagram ads'])
  assert.deepEqual(plain(lib.logosForEdit().map((l) => l.image)), list.map((l) => l.id))
  assert.equal(lib.copyLogosIntoRun('/run'), 2)
  assert.equal(lib.importLogoIntoRun('/run', list[1].id), 'name.png')
  assert.throws(() => lib.importLogoIntoRun('/run', 'nope'), /no longer/)
  assert.equal(imported.length, 3)
  assert.equal(lib.logoFile(list[0].id).name, 'Meta')
  list = await lib.removeLogo(list[0].id)
  assert.equal(list.length, 1)
  await assert.rejects(lib.removeLogo('../x'), /no longer/)
})
