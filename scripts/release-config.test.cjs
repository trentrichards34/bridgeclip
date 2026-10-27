'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const yaml = require('js-yaml')
const ts = require('typescript')
const vm = require('node:vm')
const { releaseConfig, DEFAULT_RELEASES_REPOSITORY } = require('./release/builder-config.cjs')
const { nextVersion, releaseChangelog, main: bump } = require('./release/bump-version.cjs')
const { releaseNotes } = require('./release/release-notes.cjs')

const root = path.resolve(__dirname, '..')
const base = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'))

function sourceModule(file) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports })
  return module.exports
}

const MAC_SIGNING = {
  RELEASE_SIGNING: '1', CREATORCLIPS_MAC_TEAM_ID: 'WEALTH1234', APPLE_TEAM_ID: 'WEALTH1234',
  CSC_LINK: 'base64', CSC_KEY_PASSWORD: 'x', APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x'
}
const WIN_SIGNING = {
  RELEASE_SIGNING: '1', CREATORCLIPS_WIN_PUBLISHER: 'Wealthery LLC', SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net',
  SIGNING_ACCOUNT: 'acct', SIGNING_PROFILE: 'prof', AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's'
}

test('the release identity is Wealthery\'s, with no BridgeMind signer left in the release setup', () => {
  assert.deepEqual(base.publish, { provider: 'github', owner: 'trentrichards34', repo: 'creatorclips-releases' })
  assert.equal(`${base.publish.owner}/${base.publish.repo}`, DEFAULT_RELEASES_REPOSITORY)
  assert.equal(sourceModule('src/shared/release-identity.ts').DEFAULT_RELEASES_REPOSITORY, DEFAULT_RELEASES_REPOSITORY)
  assert.equal(base.mac.identity, null, 'local builds stay unsigned')
  assert.equal(base.win.signtoolOptions, undefined, 'no hard-coded Windows publisher')
  for (const file of ['electron-builder.yml', 'src/main/auto-updater.ts', 'src/main/update-provider.ts', 'scripts/release/builder-config.cjs', 'scripts/release/verify-windows.ps1']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /9CBJCDR3J2|BRIDGEMIND LLC/, file)
  }
})

test('signed macOS builds sign with the compiled-in team and notarize; incomplete secrets fail', () => {
  const config = releaseConfig(base, 'mac', MAC_SIGNING)
  assert.equal(config.mac.identity, 'WEALTH1234')
  assert.equal(config.mac.notarize, true)
  assert.equal(config.dmg.sign, true)
  assert.equal(config.forceCodeSigning, true)
  assert.deepEqual(config.publish, { provider: 'github', owner: 'trentrichards34', repo: 'creatorclips-releases' })
  assert.equal(base.mac.identity, null, 'the base config is not modified')
  assert.throws(() => releaseConfig(base, 'mac', { ...MAC_SIGNING, CSC_LINK: '' }), /Missing CSC_LINK/)
  assert.throws(() => releaseConfig(base, 'mac', { ...MAC_SIGNING, APPLE_TEAM_ID: 'OTHER12345' }), /same team/)
  assert.throws(() => releaseConfig(base, 'mac', { ...MAC_SIGNING, CREATORCLIPS_MAC_TEAM_ID: 'abc', APPLE_TEAM_ID: 'abc' }), /10-character/)
})

test('unsigned test builds trust no signer', () => {
  const mac = releaseConfig(base, 'mac', {})
  assert.equal(mac.mac.identity, null)
  assert.equal(mac.mac.notarize, false)
  assert.equal(mac.forceCodeSigning, undefined)
  assert.throws(() => releaseConfig(base, 'mac', { CREATORCLIPS_MAC_TEAM_ID: 'WEALTH1234' }), /unsigned build/)
  const win = releaseConfig(base, 'windows', {})
  assert.equal(win.win.azureSignOptions, undefined)
  assert.equal(win.win.signtoolOptions, undefined)
  assert.equal(win.win.verifyUpdateCodeSignature, false)
  assert.throws(() => releaseConfig(base, 'windows', { CREATORCLIPS_WIN_PUBLISHER: 'Wealthery LLC' }), /unsigned build/)
})

test('signed Windows builds use Azure Trusted Signing with the compiled-in publisher', () => {
  const config = releaseConfig(base, 'windows', WIN_SIGNING)
  assert.equal(config.forceCodeSigning, true)
  assert.equal(config.win.verifyUpdateCodeSignature, true)
  assert.equal(config.win.azureSignOptions.publisherName, 'Wealthery LLC')
  assert.equal(config.win.azureSignOptions.codeSigningAccountName, 'acct')
  assert.throws(() => releaseConfig(base, 'windows', { ...WIN_SIGNING, AZURE_CLIENT_SECRET: '' }), /Missing AZURE_CLIENT_SECRET/)
})

test('the releases repository can be changed, and must be owner/repo', () => {
  assert.deepEqual(releaseConfig(base, 'linux', { CREATORCLIPS_RELEASES_REPO: 'acme/app-releases' }).publish, { provider: 'github', owner: 'acme', repo: 'app-releases' })
  assert.throws(() => releaseConfig(base, 'linux', { CREATORCLIPS_RELEASES_REPO: 'https://github.com/acme/x' }), /owner\/repo/)
  assert.throws(() => releaseConfig(base, 'beos', {}), /Platform/)
})

test('version bumps', () => {
  assert.equal(nextVersion('0.1.19', 'patch'), '0.1.20')
  assert.equal(nextVersion('0.1.19', 'minor'), '0.2.0')
  assert.equal(nextVersion('0.1.19', 'major'), '1.0.0')
  assert.equal(nextVersion('0.1.19', '0.3.0'), '0.3.0')
  assert.throws(() => nextVersion('0.1.19', '0.1.19'), /not newer/)
  assert.throws(() => nextVersion('0.1.19', '0.1.2'), /not newer/)
  assert.throws(() => nextVersion('0.1.19', 'bigger'), /patch, minor, major/)
})

const CHANGELOG = [
  '# Changelog', '', 'Intro.', '',
  '## [Unreleased]', '', '### Added', '', '- A thing.', '',
  '## [0.1.19] - 2026-09-27', '', '### Fixed', '', '- Old fix.', '',
  '[Unreleased]: https://github.com/trentrichards34/bridgeclip/compare/v0.1.19...HEAD',
  '[0.1.19]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.19', ''
].join('\n')

test('releasing the changelog moves Unreleased into a dated section and links it', () => {
  const released = releaseChangelog(CHANGELOG, '0.1.20', '2026-10-27')
  assert.match(released, /## \[Unreleased\]\n\n## \[0\.1\.20\] - 2026-10-27\n\n### Added\n\n- A thing\.\n\n## \[0\.1\.19\]/)
  assert.match(released, /^\[Unreleased\]: https:\/\/github\.com\/trentrichards34\/bridgeclip\/compare\/v0\.1\.20\.\.\.HEAD$/m)
  assert.match(released, /^\[0\.1\.20\]: https:\/\/github\.com\/trentrichards34\/creatorclips-releases\/releases\/tag\/v0\.1\.20$/m)
  assert.throws(() => releaseChangelog(released, '0.1.21', '2026-10-28'), /nothing under \[Unreleased\]/)
  assert.throws(() => releaseChangelog(CHANGELOG, '0.1.19', '2026-10-28'), /already has/)
  assert.throws(() => releaseChangelog(CHANGELOG.replace('- A thing.', '<!-- - hidden -->'), '0.1.20', '2026-10-27'), /nothing under/)
})

test('the bump updates package.json, package-lock.json and CHANGELOG.md together', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creatorclips-bump-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'package.json'), '{\n  "name": "creatorclips",\n  "version": "0.1.19",\n  "dependencies": { "x": { "version": "9.9.9" } }\n}\n')
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'creatorclips', version: '0.1.19', packages: { '': { version: '0.1.19' }, 'node_modules/x': { version: '9.9.9' } } }, null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG)
  const log = console.log
  console.log = () => {}
  try { assert.equal(bump(['patch', '--no-git', '--date', '2026-10-27'], dir), '0.1.20') } finally { console.log = log }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '0.1.20')
  assert.equal(pkg.dependencies.x.version, '9.9.9')
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'))
  assert.equal(lock.version, '0.1.20')
  assert.equal(lock.packages[''].version, '0.1.20')
  assert.equal(lock.packages['node_modules/x'].version, '9.9.9')
  assert.match(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), /## \[0\.1\.20\] - 2026-10-27/)
})

test('release notes link the installers and carry the changelog section', () => {
  const notes = releaseNotes(CHANGELOG, '0.1.19', { windowsSigned: false })
  assert.match(notes, /https:\/\/github\.com\/trentrichards34\/creatorclips-releases\/releases\/download\/v0\.1\.19\/CreatorClips-0\.1\.19-mac-arm64\.dmg/)
  assert.match(notes, /- Old fix\./)
  assert.doesNotMatch(notes, /A thing|\[Unreleased\]:/)
  assert.match(notes, /not code-signed/)
  assert.doesNotMatch(releaseNotes(CHANGELOG, '0.1.19'), /not code-signed/)
  assert.throws(() => releaseNotes(CHANGELOG, '9.9.9'), /no section/)
})

test('the release workflow builds both Macs and Windows and publishes them together', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'))
  const arches = workflow.jobs.mac.strategy.matrix.include.map((entry) => entry.arch).sort()
  assert.deepEqual(arches, ['arm64', 'x64'])
  assert.ok(workflow.jobs.windows)
  assert.deepEqual([...workflow.jobs.publish.needs].sort(), ['check', 'mac', 'windows'])
  assert.deepEqual(workflow.on.push.tags, ['v[0-9]+.[0-9]+.[0-9]+'])
  assert.ok(workflow.on.workflow_dispatch, 'a manual, unsigned build-only run')
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(job['runs-on'] && Array.isArray(job.steps) && job.steps.length, name)
    for (const step of job.steps) assert.ok(step.uses || step.run, `${name}: every step uses an action or runs a command`)
  }
  const text = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
  for (const secret of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'GH_RELEASES_TOKEN']) {
    assert.match(text, new RegExp(`secrets\\.${secret}\\b`), secret)
  }
  assert.match(text, /collect-artifacts\.cjs artifacts publish /)
  assert.match(text, /'desktop' \|\| 'macos'/)
  assert.match(text, /--draft/)
})
