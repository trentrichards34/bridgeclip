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

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-memory-test-'))
const memory = load('main/hook-memory.ts', { electron: { app: { getPath: () => userData } } })
const FILE = path.join(userData, 'hook-headlines.json')
const RUN = 'edit-12345678-1234-1234-1234-123456789abc'
const RUN2 = 'edit-87654321-1234-1234-1234-123456789abc'
const key = (n) => `takes:${String(n).padStart(64, '0')}`

function video(name, bytes) {
  const file = path.join(userData, name)
  fs.writeFileSync(file, bytes)
  return file
}

test('a recording is known by its bytes and length, not its name or place; retakes and clips are kept apart', async () => {
  const big = Buffer.alloc(3 * 1024 * 1024, 7)
  const a = video('take.mp4', big)
  const copy = video('renamed copy.mov', big)
  const other = video('other.mp4', Buffer.concat([big.subarray(0, big.length - 1), Buffer.from([8])]))
  const second = video('second.mp4', Buffer.alloc(2048, 3))
  const first = await memory.sourcesKey('takes', [{ path: a, seconds: 12.3456 }])
  assert.match(first, /^takes:[0-9a-f]{64}$/)
  assert.equal(await memory.sourcesKey('takes', [{ path: copy, seconds: 12.3456 }]), first)
  // A change in its last MB, or a different length, is a different recording.
  assert.notEqual(await memory.sourcesKey('takes', [{ path: other, seconds: 12.3456 }]), first)
  assert.notEqual(await memory.sourcesKey('takes', [{ path: a, seconds: 13 }]), first)
  // Several files: the same set in any order; the same files combined are a different video.
  const pair = await memory.sourcesKey('combine', [{ path: a, seconds: 1 }, { path: second, seconds: 2 }])
  assert.equal(await memory.sourcesKey('combine', [{ path: second, seconds: 2 }, { path: a, seconds: 1 }]), pair)
  assert.match(pair, /^combine:/)
  assert.notEqual(await memory.sourcesKey('takes', [{ path: a, seconds: 1 }, { path: second, seconds: 2 }]), pair)
  // Unreadable or none: no key (nothing is kept).
  assert.equal(await memory.sourcesKey('takes', [{ path: path.join(userData, 'missing.mp4'), seconds: 1 }]), null)
  assert.equal(await memory.sourcesKey('takes', []), null)
})

test('a headline is saved for its recordings, replaced by the member’s change, and found again from a run', () => {
  fs.rmSync(FILE, { force: true })
  assert.equal(memory.savedHeadline(key(1)), null)
  assert.equal(memory.savedHeadline(null), null)
  memory.rememberHeadline(key(1), '  Most coaches   charge too little ', RUN)
  assert.equal(memory.savedHeadline(key(1)), 'Most coaches charge too little')
  // An empty headline (the member chose none) leaves the saved one.
  memory.rememberHeadline(key(1), '   ', RUN)
  assert.equal(memory.savedHeadline(key(1)), 'Most coaches charge too little')
  // Changed in the clip editor or the Library: found by its run, saved for its recordings.
  assert.equal(memory.rememberRunHeadline(RUN, 'Coaches undercharge'), true)
  assert.equal(memory.savedHeadline(key(1)), 'Coaches undercharge')
  assert.equal(memory.rememberRunHeadline(RUN2, 'Not one of ours'), false)
  assert.equal(memory.rememberRunHeadline('../edit-x', 'Bad run'), false)
  // Written whole (no temp files left), versioned.
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.entries.map((entry) => [entry.key, entry.headline, entry.runs]), [[key(1), 'Coaches undercharge', [RUN]]])
  assert.deepEqual(fs.readdirSync(userData).filter((name) => name.endsWith('.tmp')), [])
  // An unreadable file is an empty memory (and is replaced on the next save).
  fs.writeFileSync(FILE, '{nope')
  assert.equal(memory.savedHeadline(key(1)), null)
  memory.rememberHeadline(key(2), 'Fresh start', RUN2)
  assert.equal(memory.savedHeadline(key(2)), 'Fresh start')
})

test('the saved file is checked, and keeps only the last 500 recordings', () => {
  const parsed = memory.parseHookMemory({ version: 1, entries: [
    { key: key(1), headline: 'Kept', runs: [RUN, '../../etc', 5], updatedAt: '2026-10-01T00:00:00.000Z' },
    { key: 'takes:../../x', headline: 'Bad key' },
    { key: key(2), headline: 'x'.repeat(91) },
    { key: key(3), headline: 'Has <b>tags</b>' },
    { key: key(1), headline: 'Duplicate' },
    null, 'text'
  ] })
  assert.deepEqual(plain(parsed), { entries: [{ key: key(1), headline: 'Kept', runs: [RUN], updatedAt: '2026-10-01T00:00:00.000Z' }] })
  assert.deepEqual(plain(memory.parseHookMemory({ version: 2, entries: [{ key: key(1), headline: 'Kept' }] })), { entries: [] })
  assert.deepEqual(plain(memory.parseHookMemory(null)), { entries: [] })

  let state = { entries: [] }
  for (let n = 0; n < memory.MAX_HOOK_MEMORY + 20; n += 1) state = memory.withHeadline(state, key(n), `Headline ${n}`, null)
  assert.equal(state.entries.length, memory.MAX_HOOK_MEMORY)
  assert.equal(state.entries[0].key, key(20))
  // Saving one again moves it to the newest; its runs are capped.
  for (let n = 0; n < 12; n += 1) state = memory.withHeadline(state, key(20), 'Again', `edit-${String(n).padStart(8, '0')}-1234-1234-1234-123456789abc`)
  const last = state.entries[state.entries.length - 1]
  assert.equal(last.key, key(20))
  assert.equal(last.headline, 'Again')
  assert.equal(last.runs.length, 8)
  assert.equal(memory.withHeadline(state, key(1), '', null), state, 'an empty headline changes nothing')
  assert.equal(memory.cleanHeadline('Line\u0007bell'), '')
})
