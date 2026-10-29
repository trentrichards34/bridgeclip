const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function transpile(file) {
  const source = fs.readFileSync(file, 'utf8')
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

// Values built inside the vm sandbox have that realm's Array prototype.
const plain = (value) => JSON.parse(JSON.stringify(value))

function load(userData) {
  const shared = { exports: {} }
  vm.runInNewContext(transpile(path.join(__dirname, '../../src/shared/backgrounds.ts')), { module: shared, exports: shared.exports })
  const main = { exports: {} }
  vm.runInNewContext(transpile(path.join(__dirname, '../../src/main/backgrounds.ts')), {
    module: main,
    exports: main.exports,
    require: (id) => id === 'electron' ? { app: { getPath: () => userData } } : id === '../shared/backgrounds' ? shared.exports : require(id)
  })
  return { ...main.exports, ...shared.exports }
}

test('background names are plain video file names inside the library', () => {
  const { isBackgroundVideoName } = load(os.tmpdir())
  for (const ok of ['gameplay.mp4', 'Minecraft parkour (2).MOV', 'soap_cutting-1.webm']) assert.ok(isBackgroundVideoName(ok), ok)
  for (const bad of ['../x.mp4', 'a/b.mp4', 'a\\b.mp4', '.mp4', '.hidden.mp4', 'x..mp4', 'notes.txt', 'clip', '', 'a'.repeat(121) + '.mp4', 5, null]) {
    assert.equal(isBackgroundVideoName(bad), false, String(bad))
  }
})

test('added videos are copied in under safe, unique names and can be removed', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bg-'))
  const sources = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-src-'))
  const lib = load(userData)
  const a = path.join(sources, 'Subway Surfers #1 ✨.mp4')
  const b = path.join(sources, 'notes.txt')
  const c = path.join(sources, '..weird name.MOV')
  for (const file of [a, b, c]) fs.writeFileSync(file, 'x')

  assert.deepEqual(plain(await lib.listBackgrounds()), [])
  let names = await lib.addBackgrounds([a, b, c])
  assert.deepEqual(plain(names), ['Subway Surfers -1.mp4', 'weird name.mov'])
  names = await lib.addBackgrounds([a])
  assert.deepEqual(plain(names), ['Subway Surfers -1 (2).mp4', 'Subway Surfers -1.mp4', 'weird name.mov'])
  for (const name of names) assert.ok(lib.isBackgroundVideoName(name), name)

  assert.equal(lib.resolveBackground('weird name.mov'), path.join(userData, 'backgrounds', 'weird name.mov'))
  assert.deepEqual(plain(await lib.removeBackground('weird name.mov')), ['Subway Surfers -1 (2).mp4', 'Subway Surfers -1.mp4'])
  assert.throws(() => lib.resolveBackground('weird name.mov'), /no longer in your library/)
  assert.throws(() => lib.resolveBackground('../../etc/passwd.mp4'), /Invalid background/)
  await assert.rejects(lib.removeBackground('../x.mp4'), /Invalid background/)
})
