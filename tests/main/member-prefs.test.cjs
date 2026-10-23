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
    module, exports: module.exports, URL, Buffer, console, setTimeout, clearTimeout, process, encodeURIComponent,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('.')) return load(path.relative(ROOT, path.join(dir, id)) + '.ts', mocks)
      return require(id)
    }
  })
  return module.exports
}

const shared = load('shared/member-prefs.ts')
const CTA = 'a1b2c3d4e5f60718'
const AVATAR = 'maya12345'
const BRAND = 'b'.repeat(16)

test('remembered styles: valid fields are kept, unknown or invalid ones fall back to the form default', () => {
  const create = shared.parseCreateStyle({
    clippingMode: 'economy', aspectRatio: '16:9', layoutStyle: 'fit', layoutVision: false, pacing: 'natural', videoSpeed: 1.25, durations: ['short', 'medium'],
    autoClipCount: false, maxClips: 7, includeCaptions: false, captionPreset: 'pop', includeTitle: true, titleStyle: 'card',
    headlineLook: { look: 'brand', color: '#ff8800', font: 'serif' }, ctaId: CTA, backgroundVideo: 'minecraft.mp4', broll: 'after-hook', hookPreview: true, qualityBar: 'a',
    // Not style: never remembered.
    source: 'https://youtube.com/watch?v=abcdefghijk', clipRequest: 'the funny bit', trimStart: '1:00', workflow: 'automatic', apiKey: 'sk-secret'
  })
  assert.deepEqual(plain(create), {
    clippingMode: 'economy', aspectRatio: '16:9', layoutStyle: 'fit', layoutVision: false, pacing: 'natural', videoSpeed: 1.25, durations: ['short', 'medium'],
    autoClipCount: false, maxClips: 7, includeCaptions: false, captionPreset: 'pop', includeTitle: true, titleStyle: 'card',
    headlineLook: { look: 'brand', color: '#FF8800', font: 'serif' }, ctaId: CTA, backgroundVideo: 'minecraft.mp4', broll: 'after-hook', hookPreview: true, qualityBar: 'a'
  })
  const bad = shared.parseCreateStyle({
    clippingMode: 'turbo', aspectRatio: '4:3', videoSpeed: 9, durations: ['short', 'forever'], maxClips: 0, captionPreset: 'comic-sans', titleStyle: 1,
    headlineLook: { look: 'neon' }, ctaId: '../../etc/passwd', backgroundVideo: '../secret.mp4', plannerModel: 'not a model', qualityBar: 'z', layoutVision: 'yes'
  })
  assert.deepEqual(plain(bad), {})
  assert.deepEqual(plain(shared.parseCreateStyle(null)), {})
  assert.deepEqual(plain(shared.parseCreateStyle('nope')), {})
  assert.deepEqual(plain(shared.parseCreateStyle({ plannerModel: 'anthropic/claude-sonnet-4', ctaId: null, backgroundVideo: null })),
    { plannerModel: 'anthropic/claude-sonnet-4', ctaId: null, backgroundVideo: null })
  // The caption language is part of Create's style: a listed language or the original.
  assert.deepEqual(plain(shared.parseCreateStyle({ captionLanguage: 'es' })), { captionLanguage: 'es' })
  assert.deepEqual(plain(shared.parseCreateStyle({ captionLanguage: 'original' })), { captionLanguage: 'original' })
  assert.deepEqual(plain(shared.parseCreateStyle({ captionLanguage: 'klingon' })), {})
  // Motion graphics: Auto is remembered once turned on (and Off once turned off).
  assert.deepEqual(plain(shared.parseCreateStyle({ motionGraphics: true })), { motionGraphics: true })
  assert.deepEqual(plain(shared.parseCreateStyle({ motionGraphics: false })), { motionGraphics: false })
  assert.deepEqual(plain(shared.parseCreateStyle({ motionGraphics: 'auto' })), {})

  const remix = shared.parseRemixStyle({
    format: 'silent', angle: 'mix', order: 'take_first', host: 'camera', avatarId: AVATAR, voice: 'avatar', brandIdentityId: BRAND, count: 5,
    includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'floating', color: '#FFFFFF', font: 'condensed' }, ctaId: CTA, ctaKeyword: 'SALES', ctaOffer: 'my free playbook',
    camera: { layout: 'cutout', backdrop: 'brand', backdropColor: '#00ff00', talk: true }, imageCamera: { layout: 'greenscreen', backdrop: 'blur', backdropColor: '#111111', talk: true },
    links: 'https://a.com/1', filePath: '/Users/me/video.mp4', creator: '@coach', aiLabelAck: true, clipRightsAck: true
  })
  assert.equal(remix.format, 'silent')
  assert.equal(remix.camera.backdropColor, '#00FF00')
  // Pause & react's choices are part of the style too.
  const pause = shared.parseRemixStyle({ format: 'pause_react', pauseLayout: 'split', pauseCaptions: 'both', pauseCamera: { layout: 'cutout', backdrop: 'blur', backdropColor: '#123456', talk: true } })
  assert.deepEqual(plain(pause), { format: 'pause_react', pauseLayout: 'split', pauseCaptions: 'both', pauseCamera: { layout: 'cutout', backdrop: 'blur', backdropColor: '#123456', talk: true } })
  assert.deepEqual(plain(shared.parseRemixStyle({ pauseLayout: 'side', pauseCaptions: 'theirs', pauseCamera: { layout: 'moon' } })), {})
  for (const key of ['links', 'filePath', 'creator', 'aiLabelAck', 'clipRightsAck', 'imagePath']) assert.equal(key in remix, false, key)
  const badRemix = shared.parseRemixStyle({ format: 'tiktok', host: 'robot', count: 99, voice: 'Nobody', ctaKeyword: 'two words', ctaOffer: 'x'.repeat(81), camera: { layout: 'moon' }, brandIdentityId: 'x' })
  assert.deepEqual(plain(badRemix), {})
})

test('the prefs file: garbage loads as defaults, and saved styles are checked one by one', () => {
  assert.deepEqual(plain(shared.parseMemberPrefs('{]')), plain(shared.DEFAULT_MEMBER_PREFS))
  assert.deepEqual(plain(shared.parseMemberPrefs([])), plain(shared.DEFAULT_MEMBER_PREFS))
  const prefs = shared.parseMemberPrefs({
    create: { aspectRatio: '9:16', bogus: 1 }, remix: 'not an object',
    presets: {
      create: [
        { id: 'c'.repeat(16), name: '  Podcast   clips ', style: { pacing: 'natural', maxClips: 'many' }, updatedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'c'.repeat(16), name: 'Duplicate id', style: {} },
        { id: 'd'.repeat(16), name: 'podcast clips', style: {} },
        { id: 'BAD', name: 'Bad id', style: {} },
        { id: 'e'.repeat(16), name: 'x'.repeat(41), style: {} },
        { id: 'f'.repeat(16), name: 'No date', style: null }
      ],
      remix: Array.from({ length: 40 }, (_, i) => ({ id: i.toString(16).padStart(16, '0'), name: `Style ${i}`, style: {} }))
    },
    supportLink: 'javascript:alert(1)', notifyOnFinish: 'maybe'
  })
  assert.deepEqual(plain(prefs.create), { aspectRatio: '9:16' })
  assert.deepEqual(plain(prefs.remix), {})
  assert.deepEqual(plain(prefs.presets.create.map((preset) => preset.name)), ['Podcast clips', 'No date'])
  assert.deepEqual(plain(prefs.presets.create[0].style), { pacing: 'natural' })
  assert.equal(prefs.presets.remix.length, shared.MAX_PRESETS)
  assert.equal(prefs.supportLink, '')
  assert.equal(prefs.notifyOnFinish, true, 'only an explicit false turns notifications off')
  assert.equal(shared.parseMemberPrefs({ notifyOnFinish: false }).notifyOnFinish, false)
})

test('styles naming deleted CTAs, avatars, brand identities or backgrounds drop just those ids', () => {
  const prefs = shared.parseMemberPrefs({
    create: { ctaId: CTA, backgroundVideo: 'gone.mp4', pacing: 'tight' },
    remix: { ctaId: CTA, avatarId: AVATAR, brandIdentityId: BRAND, count: 3 },
    presets: { create: [], remix: [{ id: 'a'.repeat(16), name: 'Daily', style: { avatarId: 'other1234', brandIdentityId: BRAND } }] }
  })
  const known = { ctaIds: new Set(), avatarIds: new Set([AVATAR]), brandIds: new Set(), backgrounds: new Set(['kept.mp4']) }
  const kept = shared.dropMissing(prefs, known)
  assert.deepEqual(plain(kept.create), { pacing: 'tight', ctaId: null, backgroundVideo: null })
  assert.deepEqual(plain(kept.remix), { avatarId: AVATAR, brandIdentityId: null, count: 3, ctaId: null })
  assert.deepEqual(plain(kept.presets.remix[0].style), { avatarId: null, brandIdentityId: null })
})

test('a library that could not be read keeps its saved ids (only items known to be gone are dropped)', () => {
  const prefs = shared.parseMemberPrefs({
    create: { ctaId: CTA, backgroundVideo: 'kept.mp4' },
    remix: { ctaId: CTA, avatarId: AVATAR, brandIdentityId: BRAND },
    presets: { create: [], remix: [{ id: 'a'.repeat(16), name: 'Daily', style: { avatarId: AVATAR, brandIdentityId: BRAND } }] }
  })
  // The avatars and brand identities couldn't be read (null); the CTAs and backgrounds were, and are empty.
  const kept = shared.dropMissing(prefs, { ctaIds: new Set(), avatarIds: null, brandIds: null, backgrounds: new Set() })
  assert.deepEqual(plain(kept.remix), { ctaId: null, avatarId: AVATAR, brandIdentityId: BRAND })
  assert.deepEqual(plain(kept.create), { ctaId: null, backgroundVideo: null })
  assert.deepEqual(plain(kept.presets.remix[0].style), { avatarId: AVATAR, brandIdentityId: BRAND })
})

test('the default brand look: its own pref (older prefs use the last Create brand), checked, saved and dropped when deleted', () => {
  const OTHER = 'c'.repeat(16)
  // Older prefs had no default of their own: the brand of the last Create style was the default.
  assert.equal(shared.parseMemberPrefs({ create: { brandIdentityId: BRAND } }).defaultBrandId, BRAND)
  assert.equal(shared.parseMemberPrefs({}).defaultBrandId, null)
  // Once saved, it is its own setting: a brand picked on Create for one video doesn't change it.
  assert.equal(shared.parseMemberPrefs({ create: { brandIdentityId: OTHER }, defaultBrandId: BRAND }).defaultBrandId, BRAND)
  assert.equal(shared.parseMemberPrefs({ create: { brandIdentityId: OTHER }, defaultBrandId: null }).defaultBrandId, null)
  assert.equal(shared.parseMemberPrefs({ defaultBrandId: '../brand' }).defaultBrandId, null)
  // A deleted brand stops being the default (an unreadable list keeps it).
  const prefs = shared.parseMemberPrefs({ defaultBrandId: BRAND })
  assert.equal(shared.dropMissing(prefs, { ctaIds: null, avatarIds: null, brandIds: new Set([OTHER]), backgrounds: null }).defaultBrandId, null)
  assert.equal(shared.dropMissing(prefs, { ctaIds: null, avatarIds: null, brandIds: null, backgrounds: null }).defaultBrandId, BRAND)

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'member-prefs-default-'))
  const main = load('main/member-prefs.ts', { electron: { app: { getPath: () => userData } } })
  assert.equal(main.saveAppPrefs({ defaultBrandId: BRAND }).defaultBrandId, BRAND)
  main.saveLastStyle('create', { brandIdentityId: OTHER })
  assert.equal(main.readMemberPrefs().defaultBrandId, BRAND, 'the last Create style never moves the default')
  assert.equal(main.saveAppPrefs({ defaultBrandId: null }).defaultBrandId, null)
  assert.throws(() => main.saveAppPrefs({ defaultBrandId: 'not-a-brand' }), /no longer exists/)
  assert.equal(main.readMemberPrefs().defaultBrandId, null)
})

test('prefs:load treats a failed library read as unknown, not as empty', () => {
  const handlers = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-handlers.ts'), 'utf8')
  assert.match(handlers, /listCtas\(\)\.catch\(\(\) => null\), listAvatars\(\)\.catch\(\(\) => null\), listBrandIdentities\(\)\.catch\(\(\) => null\), listBackgrounds\(\)\.catch\(\(\) => null\)/)
})

test('preset names are 1 to 40 characters; support links are https links or emails', () => {
  assert.equal(shared.presetName('  Morning   posts '), 'Morning posts')
  assert.equal(shared.presetName(''), null)
  assert.equal(shared.presetName('   '), null)
  assert.equal(shared.presetName('x'.repeat(41)), null)
  assert.equal(shared.presetName('x'.repeat(40)).length, 40)
  assert.equal(shared.presetName('tab\there'), 'tabhere')
  assert.equal(shared.presetName(42), null)

  assert.deepEqual(plain(shared.supportTarget('https://community.example.com/support')), { kind: 'link', url: 'https://community.example.com/support' })
  assert.deepEqual(plain(shared.supportTarget('help@example.com')), { kind: 'email', url: 'mailto:help@example.com?subject=CreatorClips%20support' })
  assert.equal(shared.supportTarget('mailto:help@example.com').kind, 'email')
  for (const value of ['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@example.com', 'https://localhost', 'not a link', 'a@b', 'ftp://x.com', '', null]) {
    assert.equal(shared.supportTarget(value), null, String(value))
  }
  assert.equal(shared.parseSupportLink(''), '')
  assert.equal(shared.parseSupportLink('  help@example.com '), 'help@example.com')
  assert.throws(() => shared.parseSupportLink('http://example.com'), /https/)
})

test('main keeps the prefs in userData: last style, presets (save, replace, rename, delete, cap) and app prefs', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'member-prefs-'))
  const main = load('main/member-prefs.ts', { electron: { app: { getPath: () => userData } } })
  const file = path.join(userData, 'member-prefs.json')
  assert.deepEqual(plain(main.readMemberPrefs()), plain(shared.DEFAULT_MEMBER_PREFS))

  main.saveLastStyle('create', { aspectRatio: '16:9', source: 'https://x.com/video', maxClips: 4 })
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(saved.create, { aspectRatio: '16:9', maxClips: 4 })
  assert.equal(JSON.stringify(saved).includes('x.com'), false, 'links are never saved')
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.throws(() => main.saveLastStyle('other', {}), /Create or Remix/)

  let prefs = main.savePreset('remix', 'Daily takes', { format: 'commentary', count: 5, links: 'https://a.com' })
  assert.equal(prefs.presets.remix.length, 1)
  const id = prefs.presets.remix[0].id
  assert.match(id, /^[a-f0-9]{16}$/)
  assert.deepEqual(plain(prefs.presets.remix[0].style), { format: 'commentary', count: 5 })
  // The same name (any case) replaces that style.
  prefs = main.savePreset('remix', 'daily TAKES', { count: 1 })
  assert.equal(prefs.presets.remix.length, 1)
  assert.equal(prefs.presets.remix[0].id, id)
  assert.deepEqual(plain(prefs.presets.remix[0].style), { count: 1 })
  assert.throws(() => main.savePreset('remix', '', {}), /1 to 40/)
  assert.throws(() => main.savePreset('remix', 'x'.repeat(41), {}), /1 to 40/)

  main.savePreset('remix', 'Second', {})
  assert.throws(() => main.renamePreset('remix', id, 'second'), /already have/)
  prefs = main.renamePreset('remix', id, 'Morning')
  assert.equal(prefs.presets.remix.find((preset) => preset.id === id).name, 'Morning')
  assert.throws(() => main.renamePreset('remix', 'f'.repeat(16), 'Ghost'), /no longer exists/)
  prefs = main.deletePreset('remix', id)
  assert.deepEqual(plain(prefs.presets.remix.map((preset) => preset.name)), ['Second'])
  assert.throws(() => main.deletePreset('remix', '../x'), /no longer exists/)

  for (let i = prefs.presets.create.length; i < shared.MAX_PRESETS; i++) main.savePreset('create', `Style ${i}`, {})
  assert.throws(() => main.savePreset('create', 'One too many', {}), /up to 30/)
  assert.equal(main.savePreset('create', 'style 3', { pacing: 'natural' }).presets.create.length, shared.MAX_PRESETS, 'replacing still works at the cap')

  prefs = main.saveAppPrefs({ supportLink: 'help@example.com', notifyOnFinish: false })
  assert.equal(prefs.supportLink, 'help@example.com')
  assert.equal(prefs.notifyOnFinish, false)
  assert.throws(() => main.saveAppPrefs({ supportLink: 'http://insecure.example.com' }), /https/)
  assert.throws(() => main.saveAppPrefs({ notifyOnFinish: 'no' }), /notification/)

  // A fresh start reads the same file; a broken file loads as defaults.
  const again = load('main/member-prefs.ts', { electron: { app: { getPath: () => userData } } })
  assert.equal(again.readMemberPrefs().presets.create.length, shared.MAX_PRESETS)
  assert.deepEqual(plain(again.readMemberPrefs().create), { aspectRatio: '16:9', maxClips: 4 })
  fs.writeFileSync(file, '{ not json')
  const broken = load('main/member-prefs.ts', { electron: { app: { getPath: () => userData } } })
  assert.deepEqual(plain(broken.readMemberPrefs()), plain(shared.DEFAULT_MEMBER_PREFS))
  fs.rmSync(userData, { recursive: true, force: true })
})

function loadReport({ log = '', jobs = [], supportLink = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-report-'))
  const logFile = path.join(dir, 'bridgeclip.log')
  fs.writeFileSync(logFile, log)
  const copied = []
  const opened = []
  const home = os.homedir()
  const settings = { openrouterApiKey: 'sk-or-v1-abcdef0123456789abcdef', zernioApiKey: 'zk_live_supersecretvalue', pexelsApiKey: '', falApiKey: 'fal-secret-123456', heygenApiKey: 'hg-secret-654321',
    jevEnabled: 'off', sourceContextWebResearch: 'on', downloadLoginBrowser: 'chrome', outputDirectory: path.join(home, 'CreatorClips') }
  const report = load('main/support-report.ts', {
    electron: { app: { getVersion: () => '0.1.19', getPath: () => path.join(home, '.config', 'CreatorClips') }, clipboard: { writeText: (text) => copied.push(text) }, shell: { openExternal: async (url) => { opened.push(url) } } },
    './logger': { getLogFilePath: () => logFile, logger: { info() {}, warn() {} } },
    './settings-store': {
      loadSettings: () => settings,
      publicSettings: (s) => ({ openrouterConfigured: Boolean(s.openrouterApiKey), zernioConfigured: Boolean(s.zernioApiKey), pexelsConfigured: Boolean(s.pexelsApiKey), falConfigured: Boolean(s.falApiKey), heygenConfigured: Boolean(s.heygenApiKey),
        jevEnabled: s.jevEnabled, sourceContextWebResearch: s.sourceContextWebResearch, downloadLoginBrowser: s.downloadLoginBrowser, outputDirectory: s.outputDirectory })
    },
    './job-manager': { listJobs: () => jobs },
    './member-prefs': { readMemberPrefs: () => ({ supportLink, notifyOnFinish: true }) }
  })
  return { report, copied, opened, settings, home, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('support report: versions, system check, which keys are saved (never the keys), the last error and a redacted log', async () => {
  const home = os.homedir()
  const log = [
    ...Array.from({ length: 100 }, (_, i) => JSON.stringify({ ts: '2026-10-17T00:00:00Z', level: 'info', event: `line.${i}` })),
    `{"level":"error","event":"upload","detail":"Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"}`,
    `failed for ${home}/Videos/secret-project/clip.mp4 with key=sk-or-v1-abcdef0123456789abcdef`,
    'zernio said zk_live_supersecretvalue was rejected; mail trent@example.com; token: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
  ].join('\n') + '\n'
  const jobs = [
    { id: 'old', status: 'failed', request: { workflow: 'automatic' }, error: 'Older failure', failureCode: 'OLD', finishedAt: '2026-10-16T10:00:00Z' },
    { id: 'new', status: 'failed', request: { workflow: 'review' }, error: `Download failed: ${home}/Downloads/talk.mp4 (fal-secret-123456)`, failureCode: 'DOWNLOAD_FAILED', failureStage: 'downloading', httpStatus: 403, finishedAt: '2026-10-17T10:00:00Z' },
    { id: 'ok', status: 'completed', request: {}, error: null, finishedAt: '2026-10-17T11:00:00Z' }
  ]
  const { report, copied, opened, settings, cleanup } = loadReport({ log, jobs })
  report.recordToolCheck({ python: true, pythonDeps: false, pythonError: `No module named cv2 in ${home}/.venv`, ffmpeg: true, ffmpegCaptions: false, ffprobe: true, ytdlp: true, engine: true, bridgeRunner: true, pythonPath: `${home}/.venv/bin/python` })
  const text = report.collectSupportReport(null)
  assert.match(text, /App version: 0\.1\.19/)
  assert.match(text, /System: \S+ /)
  assert.match(text, /FFmpeg captions: missing/)
  assert.match(text, /Dependencies problem: No module named cv2 in ~\/\.venv/)
  assert.match(text, /OpenRouter key saved: yes/)
  assert.match(text, /Pexels key saved: no/)
  assert.match(text, /Source research: yes/)
  assert.match(text, /Output folder: ~[\\/]CreatorClips/)
  assert.match(text, /What: Create \(Review & edit\)/)
  assert.match(text, /Code: DOWNLOAD_FAILED · stage downloading · HTTP 403/)
  assert.match(text, /Error: Download failed: ~\/Downloads\/talk\.mp4 \(\[key removed\]\)/)
  assert.match(text, /Recent log \(last 80 lines\)/)
  assert.equal(text.includes('line.22"'), false, 'only the last 80 lines')
  assert.match(text, /line\.23"/)
  for (const secret of [settings.openrouterApiKey, settings.zernioApiKey, settings.falApiKey, settings.heygenApiKey, 'abcdefghijklmnopqrstuvwxyz123456', 'trent@example.com', '9f86d081884c7d659a2feaa0c55ad015', home]) {
    assert.equal(text.includes(secret), false, `leaked ${secret}`)
  }
  // A specific job is reported when asked.
  assert.match(report.collectSupportReport('old'), /Error: Older failure/)

  // Report an issue: copies, then opens nothing without a support link.
  assert.deepEqual(plain(await report.reportIssue(null, true)), { copied: true, opened: null })
  assert.equal(copied.length, 1)
  assert.deepEqual(opened, [])
  cleanup()
})

test('support report: Report an issue opens only a valid support link, after copying', async () => {
  const email = loadReport({ supportLink: 'help@example.com' })
  assert.deepEqual(plain(await email.report.reportIssue(null, true)), { copied: true, opened: 'email' })
  assert.deepEqual(email.opened, ['mailto:help@example.com?subject=CreatorClips%20support'])
  assert.match(email.copied[0], /Last failed job:\n {2}None in this session\./)
  assert.match(email.copied[0], /System check:\n {2}Not run yet/)
  // Copy only: never opens.
  assert.deepEqual(plain(await email.report.reportIssue(null, false)), { copied: true, opened: null })
  assert.equal(email.opened.length, 1)
  email.cleanup()
  const bad = loadReport({ supportLink: 'javascript:alert(1)' })
  assert.deepEqual(plain(await bad.report.reportIssue(null, true)), { copied: true, opened: null })
  assert.deepEqual(bad.opened, [])
  bad.cleanup()
})

test('redaction removes keys, tokens, emails and personal folders', () => {
  const { report, cleanup } = loadReport()
  const out = report.redact('C:\\Users\\Trent\\Videos\\a.mp4 /Users/trent/x /home/trent/y sk-or-v1-0123456789abcdefABCDEF api_key=hunter22 ?token=abc&x=1 Bearer abc.def.ghijkl', {})
  assert.equal(out, 'C:\\Users\\~\\Videos\\a.mp4 /Users/~/x /home/~/y [key removed] api_key=[removed] ?token=[removed]&x=1 Bearer [removed]')
  assert.equal(report.redact('my key is 12345678', { secrets: ['12345678'] }), 'my key is [key removed]')
  cleanup()
})

function loadNotifications({ notifyOnFinish = true, supported = true } = {}) {
  const shown = []
  class Notification {
    static isSupported() { return supported }
    constructor(options) { this.options = options; this.handlers = {} }
    on(event, handler) { this.handlers[event] = handler; return this }
    show() { shown.push(this) }
  }
  const mod = load('main/job-notifications.ts', {
    electron: { Notification, BrowserWindow: class {} },
    './logger': { logger: { warn() {} } },
    './member-prefs': { readMemberPrefs: () => ({ notifyOnFinish }) }
  })
  return { mod, shown }
}

function fakeWindow(focused) {
  const sent = []
  const calls = []
  return {
    sent, calls,
    isDestroyed: () => false, isFocused: () => focused, isMinimized: () => true,
    restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus'),
    webContents: { isDestroyed: () => false, send: (channel, data) => sent.push([channel, data]) }
  }
}

test('notifications: only when on, supported and the window is in the background', () => {
  const { mod } = loadNotifications()
  assert.equal(mod.shouldNotify({ enabled: true, focused: false, supported: true }), true)
  assert.equal(mod.shouldNotify({ enabled: true, focused: true, supported: true }), false)
  assert.equal(mod.shouldNotify({ enabled: false, focused: false, supported: true }), false)
  assert.equal(mod.shouldNotify({ enabled: true, focused: false, supported: false }), false)
})

test('notifications: finished jobs map to a short message and a page; running or cancelled jobs say nothing', () => {
  const { mod } = loadNotifications()
  const done = mod.createNotice({ id: 'j1', status: 'completed', outputDir: '/lib/j1', request: { workflow: 'automatic' }, output: { total_clips: 3, source_video_title: 'How I grew to 1M' } })
  assert.deepEqual(plain(done), { key: 'job:j1', page: 'library', runDir: '/lib/j1', title: 'Your clips are ready', body: '3 clips from “How I grew to 1M”.' })
  assert.equal(mod.createNotice({ id: 'j2', status: 'completed', outputDir: '/lib/j2', request: { workflow: 'review' }, output: { total_clips: 0, source_video_title: '' } }).title, 'Your clips are ready to edit')
  assert.deepEqual(plain(mod.createNotice({ id: 'j3', status: 'failed', request: {} })), { key: 'job:j3', page: 'jobs', jobId: 'j3', title: 'Clipping failed', body: 'Open CreatorClips to see what went wrong and run it again.' })
  for (const status of ['queued', 'pending', 'rendering', 'cancelled']) assert.equal(mod.createNotice({ id: 'x', status, request: {} }), null)

  const base = { id: 'r1', drafts: [{ format: 'commentary' }, { format: 'commentary' }], outputs: [{}], error: null }
  assert.equal(mod.remixNotice({ ...base, phase: 'planning' }), null)
  assert.equal(mod.remixNotice({ ...base, phase: 'rendering' }), null)
  assert.equal(mod.remixNotice({ ...base, phase: 'cancelled' }), null)
  assert.deepEqual(plain(mod.remixNotice({ ...base, phase: 'review' })), { key: 'remix:r1:review', page: 'remix', title: 'Your takes are ready to review', body: '2 takes to review before anything is made.' })
  assert.equal(mod.remixNotice({ ...base, phase: 'review', drafts: [{ format: 'image' }] }).title, 'Ready for your take')
  assert.deepEqual(plain(mod.remixNotice({ ...base, phase: 'done' })), { key: 'remix:r1:done', page: 'remix', title: 'Your remixes are ready', body: '1 video made. They’re in your Library too.' })
  assert.equal(mod.remixNotice({ ...base, phase: 'failed' }).title, 'Remix failed')
  assert.equal(mod.avatarNotice({ id: 'a1', phase: 'animate' }), null)
  assert.equal(mod.avatarNotice({ id: 'a1', phase: 'done' }).page, 'avatar')
  assert.equal(mod.avatarNotice({ id: 'a1', phase: 'failed' }).title, 'Avatar video failed')
})

test('notifications: shown once per job, never while focused or switched off; a click focuses the app on that page', () => {
  const background = fakeWindow(false)
  const { mod, shown } = loadNotifications()
  const notice = mod.createNotice({ id: 'j1', status: 'completed', outputDir: '/lib/j1', request: {}, output: { total_clips: 1, source_video_title: 'Talk' } })
  mod.announce(notice, () => background)
  mod.announce(notice, () => background)
  assert.equal(shown.length, 1, 'the same job is announced once')
  assert.deepEqual(plain(shown[0].options), { title: 'Your clips are ready', body: '1 clip from “Talk”.' })
  shown[0].handlers.click()
  assert.deepEqual(background.calls, ['restore', 'show', 'focus'])
  assert.deepEqual(plain(background.sent), [['app:openPage', { page: 'library', runDir: '/lib/j1', jobId: null }]])

  mod.announce(mod.createNotice({ id: 'j2', status: 'failed', request: {} }), () => fakeWindow(true))
  assert.equal(shown.length, 1, 'not while the app is in front')
  mod.announce(null, () => background)
  assert.equal(shown.length, 1)

  const off = loadNotifications({ notifyOnFinish: false })
  off.mod.announce(notice, () => background)
  assert.equal(off.shown.length, 0)
  const unsupported = loadNotifications({ supported: false })
  unsupported.mod.announce(notice, () => background)
  assert.equal(unsupported.shown.length, 0)

  const tracker = new mod.NoticeTracker()
  assert.equal(tracker.first('a'), true)
  assert.equal(tracker.first('a'), false)
})

test('Library → Remix: a clip in a Library run becomes an authorized source file; anything else is refused', async () => {
  const library = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'library-remix-')))
  const run = path.join(library, 'run1')
  fs.mkdirSync(run)
  const video = path.join(run, 'clip.mp4')
  fs.writeFileSync(video, 'x')
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')))
  const authorized = []
  const output = { source_video_channel: '  Coach   Example ', clips: [{ clip_index: 0, s3_url: `file://${video}` }, { clip_index: 1, s3_url: path.join(outside, 'x.mp4') }] }
  const mod = load('main/library-source.ts', {
    './file-manager': { getJobOutput: async (dir) => (dir === run ? output : null) },
    './settings-store': { loadSettings: () => ({ outputDirectory: library }) },
    './security': {
      assertMediaPath: (p, dir) => { if (!fs.realpathSync(p).startsWith(dir + path.sep)) throw new Error('outside') },
      authorizeMedia: (p) => { authorized.push(p); return fs.realpathSync(p) },
      isWithinDirectory: (p, dir) => path.resolve(p).startsWith(path.resolve(dir) + path.sep)
    },
    './tools': { resolveBinary: (name) => name }
  })
  // No kept source video: the made clip itself (its hook text and captions are burned in).
  assert.deepEqual(plain(await mod.libraryClipForRemix(run, 0)), { path: video, creator: 'Coach Example', clean: false })
  assert.deepEqual(authorized, [video])
  await assert.rejects(mod.libraryClipForRemix(run, 1), /missing or outside/)
  await assert.rejects(mod.libraryClipForRemix(run, 7), /no longer in your Library/)
  await assert.rejects(mod.libraryClipForRemix(outside, 0), /no longer in your Library/)
  await assert.rejects(mod.libraryClipForRemix('relative/run', 0), /Choose a clip/)
  await assert.rejects(mod.libraryClipForRemix(run, -1), /Choose a clip/)
  output.source_video_channel = null
  assert.equal((await mod.libraryClipForRemix(run, 0)).creator, '', 'no creator unless it is known')
  fs.rmSync(library, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

test('Library → Remix: with the run\'s source video kept, the clip\'s moment is cut clean from it (no hook text or captions burned in)', async () => {
  const { execFileSync } = require('node:child_process')
  const library = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'library-clean-')))
  const run = path.join(library, 'run1')
  fs.mkdirSync(run)
  const made = path.join(run, 'clip_00.mp4')
  fs.writeFileSync(made, 'x')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-shortest', '-pix_fmt', 'yuv420p', path.join(run, 'editor-source.mp4')])
  const output = { source_video_channel: 'PowerfulJRE', clips: [{ clip_index: 0, s3_url: `file://${made}`, start_time_ms: 1000, end_time_ms: 2500 }] }
  const mod = load('main/library-source.ts', {
    './file-manager': { getJobOutput: async () => output },
    './settings-store': { loadSettings: () => ({ outputDirectory: library }) },
    './security': {
      assertMediaPath: () => undefined,
      authorizeMedia: (p) => fs.realpathSync(p),
      isWithinDirectory: (p, dir) => path.resolve(p).startsWith(path.resolve(dir) + path.sep)
    },
    './tools': { resolveBinary: (name) => name }
  })
  const first = plain(await mod.libraryClipForRemix(run, 0))
  assert.equal(first.clean, true)
  assert.equal(first.creator, 'PowerfulJRE')
  assert.ok(first.path.startsWith(path.join(run, '.remix-sources') + path.sep), first.path)
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', first.path]).toString())
  assert.ok(Math.abs(seconds - 1.5) < 0.15, `cut is ${seconds}s`)
  // Asked again, the same cut is reused.
  const mtime = fs.statSync(first.path).mtimeMs
  assert.equal((await mod.libraryClipForRemix(run, 0)).path, first.path)
  assert.equal(fs.statSync(first.path).mtimeMs, mtime)
  // Two asks at once for a new moment (a start before 0 counts from 0): each writes its own partial file, both get the cut.
  output.clips[0].start_time_ms = -400
  const both = await Promise.all([mod.libraryClipForRemix(run, 0), mod.libraryClipForRemix(run, 0)])
  assert.ok(both.every((item) => item.clean && item.path === path.join(run, '.remix-sources', 'clip_00-0-2500.mp4')), JSON.stringify(both))
  assert.deepEqual(fs.readdirSync(path.join(run, '.remix-sources')).filter((name) => name.includes('partial')), [])
  // A linked .remix-sources folder isn't written through: the made clip is used instead.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-'))
  fs.rmSync(path.join(run, '.remix-sources'), { recursive: true })
  fs.symlinkSync(elsewhere, path.join(run, '.remix-sources'))
  assert.deepEqual(plain(await mod.libraryClipForRemix(run, 0)), { path: made, creator: 'PowerfulJRE', clean: false })
  assert.deepEqual(fs.readdirSync(elsewhere), [])
  fs.rmSync(elsewhere, { recursive: true, force: true })
  fs.rmSync(library, { recursive: true, force: true })
})

test('look extras: remembered on Create and Remix and in saved styles; unknown ids dropped; Create requests checked', () => {
  assert.ok(shared.CREATE_STYLE_KEYS.includes('lookExtras'))
  // The graphics amount (register) is remembered with Create's style: one of its values or null (read from the words).
  assert.ok(shared.CREATE_STYLE_KEYS.includes('register'))
  assert.deepEqual(plain(shared.parseCreateStyle({ register: 'story' })), { register: 'story' })
  assert.deepEqual(plain(shared.parseCreateStyle({ register: null })), { register: null })
  assert.deepEqual(plain(shared.parseCreateStyle({ register: 'loud' })), {})
  assert.ok(shared.REMIX_STYLE_KEYS.includes('lookExtras'))
  assert.deepEqual(plain(shared.parseCreateStyle({ lookExtras: ['progress_bar', 'keyword_pill', 'confetti', 'keyword_pill'] })), { lookExtras: ['keyword_pill', 'progress_bar'] })
  assert.deepEqual(plain(shared.parseRemixStyle({ lookExtras: [] })), { lookExtras: [] })
  assert.deepEqual(plain(shared.parseRemixStyle({ lookExtras: 'keyword_pill' })), {})
  assert.deepEqual(plain(shared.pickStyle('remix', { lookExtras: ['comment_box'], links: 'x' })), { lookExtras: ['comment_box'] })
  const prefs = shared.parseMemberPrefs({ presets: { create: [{ id: 'a'.repeat(16), name: 'Reels', style: { lookExtras: ['accent_words'] }, updatedAt: '2026-10-01T00:00:00.000Z' }] } })
  assert.deepEqual(plain(prefs.presets.create[0].style), { lookExtras: ['accent_words'] })
  // The new hook fonts are remembered too.
  assert.equal(shared.parseCreateStyle({ headlineLook: { look: 'floating', color: '#FFFFFF', font: 'marker' } }).headlineLook.font, 'marker')

  const { validateJobConfig } = load('main/validation.ts', { './security': { isWebUrl: (url) => /^https?:\/\//.test(url) } })
  const base = {
    workflow: 'automatic', videoUrl: 'https://example.com/v', maxClips: null, autoClipCount: true, durationRanges: null, aspectRatio: '9:16', layoutStyle: 'auto',
    layoutVision: false, pacing: 'tight', includeCaptions: true, captionPreset: 'pop', startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null
  }
  assert.deepEqual(plain(validateJobConfig({ ...base, lookExtras: ['comment_box', 'keyword_pill', 'nope'] }).lookExtras), ['keyword_pill', 'comment_box'])
  assert.equal('lookExtras' in validateJobConfig({ ...base, lookExtras: [] }), false)
  assert.equal('lookExtras' in validateJobConfig(base), false)
  assert.throws(() => validateJobConfig({ ...base, lookExtras: 'keyword_pill' }), /extras/)
  assert.equal(validateJobConfig({ ...base, headlineLook: { look: 'black', color: '#FFFFFF', font: 'sans_serif_accent' } }).headlineLook.font, 'sans_serif_accent')
})

test('floating text\'s background is remembered and round-trips: styles, saved styles, brand kit, job requests and remix outputs', () => {
  const boxed = { look: 'floating', color: '#FFFFFF', font: 'clean', textBg: 'dark' }
  assert.deepEqual(plain(shared.parseCreateStyle({ headlineLook: boxed }).headlineLook), boxed)
  assert.deepEqual(plain(shared.parseRemixStyle({ headlineLook: { ...boxed, textBg: 'brand', color: '#7c5cff' } }).headlineLook), { ...boxed, textBg: 'brand', color: '#7C5CFF' })
  // An unknown background drops the look (as any invalid look is dropped), never the whole style.
  assert.equal('headlineLook' in plain(shared.parseCreateStyle({ headlineLook: { ...boxed, textBg: 'neon' } })), false)
  const prefs = shared.parseMemberPrefs({ presets: { create: [{ id: 'c'.repeat(16), name: 'Reels', style: { headlineLook: boxed }, updatedAt: '2026-10-01T00:00:00.000Z' }] } })
  assert.deepEqual(plain(prefs.presets.create[0].style.headlineLook), boxed)

  const kit = load('shared/brand-kit.ts')
  assert.deepEqual(plain(kit.parseBrandLook({ headlineLook: { ...boxed, textBg: 'light' } }).headlineLook), { ...boxed, textBg: 'light' })
  assert.deepEqual(plain(kit.readBrandLook({ headlineLook: { ...boxed, textBg: 'light' } }).headlineLook), { ...boxed, textBg: 'light' })
  assert.throws(() => kit.parseBrandLook({ headlineLook: { ...boxed, textBg: 'neon' } }), /hook text/)

  const { validateJobConfig } = load('main/validation.ts', { './security': { isWebUrl: (url) => /^https?:\/\//.test(url) } })
  const base = {
    workflow: 'automatic', videoUrl: 'https://example.com/v', maxClips: null, autoClipCount: true, durationRanges: null, aspectRatio: '9:16', layoutStyle: 'auto',
    layoutVision: false, pacing: 'tight', includeCaptions: true, captionPreset: 'pop', startTimeSeconds: null, endTimeSeconds: null, bannerPlatform: null, bannerChannelUrl: null
  }
  assert.deepEqual(plain(validateJobConfig({ ...base, headlineLook: boxed }).headlineLook), boxed)
  assert.throws(() => validateJobConfig({ ...base, headlineLook: { ...boxed, textBg: 'neon' } }))

  // A remix's settings in job_output.json keep it (Library re-make and Edit start from them).
  const { parseJobOutput } = load('shared/job-output.ts')
  const clip = (look) => ({ clip_index: 0, s3_url: 'file:///x.mp4', duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, virality_score: 1,
    editable: { split: false, settings: { headline: 'Hi there', headline_look: look, include_captions: true, caption_preset: 'pop' } } })
  const output = parseJobOutput({ job_id: 'j', clips: [clip(boxed)] })
  assert.deepEqual(plain(output.clips[0].remix_settings.headline_look), boxed)
  const older = parseJobOutput({ job_id: 'j', clips: [clip({ look: 'black', color: '#FFFFFF', font: 'clean' })] })
  assert.deepEqual(plain(older.clips[0].remix_settings.headline_look), { look: 'black', color: '#FFFFFF', font: 'clean' })
})
