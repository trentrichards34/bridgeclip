const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(platform, prefs) {
  const file = path.join(__dirname, '../../src/main/media-permissions.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, URL, process: { platform }, require: (id) => id === 'electron' ? { systemPreferences: prefs } : require(id) })
  return module.exports
}

test('camera and microphone: only the app page, only capture', () => {
  const m = load('linux', {})
  const dev = 'http://localhost:5173'
  assert.equal(m.allowMediaRequest('media', 'file:///app/out/renderer/index.html', ['video', 'audio'], undefined), true)
  assert.equal(m.allowMediaRequest('media', 'http://localhost:5173/#/remix', ['video'], dev), true)
  // Not in a packaged build, not another site, not screen capture, not other permissions.
  assert.equal(m.allowMediaRequest('media', 'http://localhost:5173/', ['video'], undefined), false)
  assert.equal(m.allowMediaRequest('media', 'https://evil.example/', ['video', 'audio'], dev), false)
  assert.equal(m.allowMediaRequest('media', 'http://localhost:5174/', ['video'], dev), false)
  assert.equal(m.allowMediaRequest('media', 'file:///x', [], undefined), false)
  assert.equal(m.allowMediaRequest('media', 'file:///x', undefined, undefined), false)
  assert.equal(m.allowMediaRequest('media', 'file:///x', ['video', 'screen'], undefined), false)
  for (const permission of ['geolocation', 'notifications', 'display-capture', 'clipboard-read']) {
    assert.equal(m.allowMediaRequest(permission, 'file:///x', ['video'], undefined), false)
  }
  assert.equal(m.allowMediaCheck('media', 'file:///', undefined), true)
  assert.equal(m.allowMediaCheck('media', 'http://localhost:5173', dev), true)
  assert.equal(m.allowMediaCheck('media', 'https://evil.example', dev), false)
  assert.equal(m.allowMediaCheck('geolocation', 'file:///', undefined), false)
  assert.equal(m.isAppPage('not a url', dev), false)
})

test('macOS asks once per device and respects a refusal', async () => {
  const asked = []
  const status = { camera: 'not-determined', microphone: 'denied' }
  const m = load('darwin', { getMediaAccessStatus: (kind) => status[kind], askForMediaAccess: async (kind) => { asked.push(kind); return true } })
  assert.deepEqual({ ...await m.requestMediaAccess() }, { camera: true, microphone: false })
  assert.deepEqual(asked, ['camera'])
  status.camera = 'granted'; status.microphone = 'granted'
  assert.deepEqual({ ...await m.requestMediaAccess() }, { camera: true, microphone: true })
  assert.deepEqual(asked, ['camera'])
  assert.deepEqual({ ...await load('linux', {}).requestMediaAccess() }, { camera: true, microphone: true })
})
