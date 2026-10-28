// AI explainers: saving the bundled skill folder as "AI Video" (then "AI Video 2"...), whole and never over anything.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '../..')
const BUNDLED = path.join(ROOT, 'resources/ai-video-skill')

function isWithinDirectory(target, directory) {
  try {
    const rel = path.relative(fs.realpathSync(directory), fs.realpathSync(target))
    return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
  } catch { return false }
}

function load({ packaged = false, resourcesPath = '/nowhere', pick = null } = {}) {
  const source = fs.readFileSync(path.join(ROOT, 'src/main/ai-video-skill.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const shown = []
  const dialogs = []
  const electron = {
    app: { isPackaged: packaged, getPath: (name) => `/home/member/${name}` },
    dialog: { showOpenDialog: async (_window, options) => { dialogs.push(options); return pick ? { canceled: false, filePaths: [pick] } : { canceled: true, filePaths: [] } } },
    shell: { showItemInFolder: (target) => shown.push(target) }
  }
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => id === 'electron' ? electron : id === './security' ? { isWithinDirectory } : require(id),
    process: { ...process, resourcesPath }, __dirname: path.join(ROOT, 'out/main')
  })
  return { ...module.exports, shown, dialogs }
}

function listFiles(dir) {
  const out = []
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(dir, full))
    }
  }
  walk(dir)
  return out.sort()
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'creatorclips-ai-video-'))

test('the bundled skill folder is in resources/ in development and next to the app when packaged', () => {
  assert.equal(load().bundledSkillDir(), BUNDLED)
  assert.equal(load({ packaged: true, resourcesPath: '/Applications/CreatorClips.app/Contents/Resources' }).bundledSkillDir(),
    '/Applications/CreatorClips.app/Contents/Resources/ai-video-skill')
  assert.deepEqual({ ...load().aiVideoSkillInfo() }, { available: true })
  assert.deepEqual({ ...load({ packaged: true }).aiVideoSkillInfo() }, { available: false })
})

test('the bundled folder has the skill, its dotfolders and its license', () => {
  for (const file of ['START HERE.md', 'CLAUDE.md', 'AGENTS.md', '.claude/settings.json', 'skill/SKILL.md', 'skill/SETUP.md', 'skill/LICENSE.txt']) {
    assert.ok(fs.existsSync(path.join(BUNDLED, file)), file)
  }
  assert.ok(fs.existsSync(path.join(BUNDLED, '.cursor')))
  assert.ok(fs.existsSync(path.join(BUNDLED, 'videos')))
})

test('folder names: AI Video, then AI Video 2, AI Video 3', () => {
  const { folderNameFor } = load()
  assert.equal(folderNameFor(1), 'AI Video')
  assert.equal(folderNameFor(2), 'AI Video 2')
  assert.equal(folderNameFor(3), 'AI Video 3')
})

test('copies the whole folder as AI Video, then AI Video 2, leaving what is there alone', async () => {
  const { copySkillFolder } = load()
  const parent = tempDir()
  try {
    const first = await copySkillFolder(BUNDLED, parent)
    assert.equal(first, path.join(parent, 'AI Video'))
    assert.deepEqual(listFiles(first), listFiles(BUNDLED))
    assert.deepEqual(fs.readFileSync(path.join(first, 'skill/LICENSE.txt')), fs.readFileSync(path.join(BUNDLED, 'skill/LICENSE.txt')))
    // The member's own work in the first copy stays put.
    fs.writeFileSync(path.join(first, 'videos', 'mine.txt'), 'keep')
    const second = await copySkillFolder(BUNDLED, parent)
    assert.equal(second, path.join(parent, 'AI Video 2'))
    assert.equal(fs.readFileSync(path.join(first, 'videos', 'mine.txt'), 'utf8'), 'keep')
    assert.ok(!fs.existsSync(path.join(second, 'videos', 'mine.txt')))
    // A file named "AI Video 3" is skipped too.
    fs.writeFileSync(path.join(parent, 'AI Video 3'), 'a file')
    assert.equal(await copySkillFolder(BUNDLED, parent), path.join(parent, 'AI Video 4'))
    assert.equal(fs.readFileSync(path.join(parent, 'AI Video 3'), 'utf8'), 'a file')
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('refuses a missing skill, a relative or missing folder, a file, and a folder inside the skill', async () => {
  const { copySkillFolder } = load()
  const parent = tempDir()
  try {
    await assert.rejects(copySkillFolder(path.join(parent, 'nope'), parent), /missing/)
    await assert.rejects(copySkillFolder(parent, parent), /missing/)
    await assert.rejects(copySkillFolder(BUNDLED, 'relative/folder'), /Choose a folder/)
    await assert.rejects(copySkillFolder(BUNDLED, 42), /Choose a folder/)
    await assert.rejects(copySkillFolder(BUNDLED, path.join(parent, 'missing')), /could not be found/)
    fs.writeFileSync(path.join(parent, 'file.txt'), '')
    await assert.rejects(copySkillFolder(BUNDLED, path.join(parent, 'file.txt')), /Choose a folder/)
    await assert.rejects(copySkillFolder(BUNDLED, path.join(BUNDLED, 'videos')), /outside CreatorClips/)
    assert.deepEqual(fs.readdirSync(parent), ['file.txt'])
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('save: Documents to start, null on cancel; saved folders are shown and only those can be revealed', async () => {
  const window = {}
  const cancelled = load()
  assert.equal(await cancelled.saveAiVideoSkill(window), null)
  assert.equal(cancelled.dialogs[0].defaultPath, '/home/member/documents')
  assert.deepEqual([...cancelled.dialogs[0].properties], ['openDirectory', 'createDirectory'])
  assert.equal(await cancelled.saveAiVideoSkill(null), null)
  assert.equal(cancelled.shown.length, 0)

  const parent = tempDir()
  try {
    const picked = load({ pick: parent })
    const saved = await picked.saveAiVideoSkill(window)
    assert.equal(saved, path.join(parent, 'AI Video'))
    assert.deepEqual(picked.shown, [saved])
    assert.equal(picked.revealAiVideoSkill(saved), true)
    assert.equal(picked.revealAiVideoSkill(parent), false)
    assert.equal(picked.revealAiVideoSkill(42), false)
    assert.deepEqual(picked.shown, [saved, saved])
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})
