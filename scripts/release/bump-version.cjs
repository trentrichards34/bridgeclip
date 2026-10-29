'use strict'
// npm run release:patch | release:minor | release:major   (or: node scripts/release/bump-version.cjs 1.2.3)
//
// 1. Bumps the version in package.json and package-lock.json.
// 2. Moves CHANGELOG.md's [Unreleased] entries into a dated "## [X.Y.Z] - YYYY-MM-DD"
//    section (scripts/changelog.test.cjs fails a release without it).
// 3. Runs the changelog test, commits "Release vX.Y.Z" and creates the tag vX.Y.Z.
// Nothing is pushed: `git push origin HEAD --follow-tags` starts the release workflow.
//
// Flags: --date YYYY-MM-DD (default: today), --no-git (only edit files; used by tests).
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const RELEASES = 'https://github.com/trentrichards34/creatorclips-releases/releases/tag'

function nextVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) throw new Error(`package.json version "${current}" is not X.Y.Z`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  const explicit = /^(\d+)\.(\d+)\.(\d+)$/.exec(bump || '')
  if (!explicit) throw new Error('Say patch, minor, major or an exact X.Y.Z version')
  const parts = explicit.slice(1).map(Number)
  if (parts.reduce((order, part, i) => order || part - [major, minor, patch][i], 0) <= 0) throw new Error(`${bump} is not newer than ${current}`)
  return parts.join('.')
}

/** Whether a changelog section body lists at least one change outside HTML comments. */
function hasEntries(body) {
  return /^\s*[-*] \S/m.test(body.replace(/<!--[\s\S]*?-->/g, ''))
}

function releaseChangelog(markdown, version, date) {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const text = markdown.replace(/\r\n/g, '\n')
  const heading = /^## \[Unreleased\][^\n]*\n/m.exec(text)
  if (!heading) throw new Error('CHANGELOG.md has no "## [Unreleased]" section')
  if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(text)) throw new Error(`CHANGELOG.md already has ${version}`)
  const start = heading.index + heading[0].length
  const next = /^## \[|^\[[^\]]+\]: /m.exec(text.slice(start))
  const end = next ? start + next.index : text.length
  const body = text.slice(start, end)
  if (!hasEntries(body)) {
    throw new Error('CHANGELOG.md has nothing under [Unreleased]. Add what changed (### Added / ### Changed / ### Fixed) first.')
  }
  let result = `${text.slice(0, start)}\n## [${version}] - ${date}\n${body.replace(/^\n*/, '\n').replace(/\n*$/, '\n\n')}${text.slice(end)}`
  // Link definitions at the end: Unreleased compares from the new tag; the new version links to its release page.
  result = result.replace(/^\[Unreleased\]: (\S+?)\/compare\/v[^.\s]+\.[^.\s]+\.[^.\s]+\.\.\.HEAD$/m, `[Unreleased]: $1/compare/v${version}...HEAD`)
  const definition = `[${version}]: ${RELEASES}/v${version}`
  result = /^\[Unreleased\]: .*$/m.test(result)
    ? result.replace(/^(\[Unreleased\]: .*)$/m, `$1\n${definition}`)
    : `${result.replace(/\n*$/, '\n')}\n${definition}\n`
  return result.replace(/\n/g, eol)
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function main(argv, root = path.resolve(__dirname, '../..')) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--') && !arg.startsWith('--date')))
  const dateIndex = argv.indexOf('--date')
  const date = dateIndex >= 0 ? argv[dateIndex + 1] : today()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('--date must be YYYY-MM-DD')
  const bump = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--date')
  const useGit = !flags.has('--no-git')

  if (useGit) {
    if (git(root, 'status', '--porcelain')) throw new Error('Commit or discard your changes first (git status shows uncommitted files).')
  }
  const packagePath = path.join(root, 'package.json')
  const lockPath = path.join(root, 'package-lock.json')
  const changelogPath = path.join(root, 'CHANGELOG.md')
  const pkgText = fs.readFileSync(packagePath, 'utf8')
  const current = JSON.parse(pkgText).version
  const version = nextVersion(current, bump)
  if (useGit && git(root, 'tag', '--list', `v${version}`)) throw new Error(`Tag v${version} already exists`)

  const changelog = releaseChangelog(fs.readFileSync(changelogPath, 'utf8'), version, date)
  fs.writeFileSync(packagePath, pkgText.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`))
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    lock.version = version
    if (lock.packages && lock.packages['']) lock.packages[''].version = version
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  }
  fs.writeFileSync(changelogPath, changelog)

  if (useGit) {
    // The same check the release workflow runs; stop before committing if it fails.
    execFileSync(process.execPath, ['--test', path.join('scripts', 'changelog.test.cjs')], { cwd: root, stdio: 'inherit' })
    git(root, 'add', 'package.json', 'package-lock.json', 'CHANGELOG.md')
    git(root, 'commit', '-m', `Release v${version}`)
    git(root, 'tag', '-a', `v${version}`, '-m', `CreatorClips ${version}`)
    console.log(`\nReady: committed and tagged v${version} (was ${current}).\nPublish it with:\n\n  git push origin HEAD --follow-tags\n`)
  } else {
    console.log(`Bumped ${current} -> ${version}`)
  }
  return version
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(`\n${error.message}\n`); process.exitCode = 1 }
}

module.exports = { nextVersion, releaseChangelog, hasEntries, main }
