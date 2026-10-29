// Launch shell: crash recovery in the main process and "What's new" after an update.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../../src')
function load(relative) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(ROOT, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require, URL })
  return module.exports
}

test('a page process that ends unexpectedly gets the reload offer; a clean exit (reload, quit) does not', () => {
  const crash = load('main/crash-recovery.ts')
  assert.equal(crash.offerReloadAfter('clean-exit'), false)
  for (const reason of ['crashed', 'killed', 'oom', 'abnormal-exit', 'launch-failed', 'memory-eviction']) assert.equal(crash.offerReloadAfter(reason), true, reason)
  const text = crash.rendererGoneMessage('crashed')
  assert.deepEqual([...text.buttons], ['Reload', 'Quit'])
  assert.match(text.detail, /stopped unexpectedly/)
  assert.match(text.detail, /Help → Report an Issue/)
  assert.match(crash.rendererGoneMessage('oom').detail, /ran out of memory/)
})

test('an unexpected main-process error shows one notice per session, and a failing notice never throws', () => {
  const crash = load('main/crash-recovery.ts')
  let shown = 0
  const notify = crash.onceNotifier(() => { shown += 1 })
  assert.equal(notify(), true)
  assert.equal(notify(), false)
  assert.equal(shown, 1)
  const broken = crash.onceNotifier(() => { throw new Error('no window') })
  assert.doesNotThrow(() => broken())
  assert.match(crash.MAIN_ERROR_NOTICE.detail, /saved to the log/)
})

test('main wires the crash handlers: logged, and the page process going away offers a reload', () => {
  const index = fs.readFileSync(path.join(ROOT, 'main/index.ts'), 'utf8')
  assert.match(index, /process\.on\('uncaughtException'[\s\S]*?logger\.error\('main\.uncaughtException'[\s\S]*?noticeMainError\(\)/)
  assert.match(index, /process\.on\('unhandledRejection'[\s\S]*?logger\.error\('main\.unhandledRejection'/)
  assert.match(index, /webContents\.on\('render-process-gone'[\s\S]*?logger\.error\('renderer\.gone'[\s\S]*?webContents\.reload\(\)/)
})

test("What's new: once after an update, never on a first install, a downgrade or the same version", () => {
  const { whatsNewOnLaunch } = load('shared/changelog.ts')
  assert.equal(whatsNewOnLaunch('1.0.0', '1.0.1', false), 'show')
  assert.equal(whatsNewOnLaunch('1.0.9', '1.1.0', false), 'show')
  assert.equal(whatsNewOnLaunch('1.0.1', '1.0.1', false), 'none')
  assert.equal(whatsNewOnLaunch('', '1.0.0', true), 'record', 'first install')
  assert.equal(whatsNewOnLaunch('', '1.0.1', false), 'record', 'nothing recorded yet: just remember it')
  assert.equal(whatsNewOnLaunch('1.0.0', '1.0.1', true), 'record', 'guided setup still to do')
  assert.equal(whatsNewOnLaunch('1.2.0', '1.1.0', false), 'record', 'a downgrade')
})
