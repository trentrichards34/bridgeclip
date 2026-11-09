'use strict'
// node scripts/release/release-notes.cjs <version> [--windows-unsigned] > notes.md
// The GitHub release text: download links for members, then the version's CHANGELOG.md section.
const fs = require('node:fs')
const path = require('node:path')

function changelogSection(markdown, version) {
  const text = markdown.replace(/\r\n/g, '\n')
  const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\n]*\n`, 'm').exec(text)
  if (!heading) throw new Error(`CHANGELOG.md has no section for ${version}`)
  const rest = text.slice(heading.index + heading[0].length)
  const end = /^## \[|^\[[^\]]+\]: /m.exec(rest)
  return (end ? rest.slice(0, end.index) : rest).trim()
}

function releaseNotes(markdown, version, { repository = 'trentrichards34/creatorclips-releases', windowsSigned = true } = {}) {
  const download = (name) => `[${name}](https://github.com/${repository}/releases/download/v${version}/${name})`
  const lines = [
    '## Download',
    '',
    `- **Mac with Apple silicon (M1 or newer), macOS 14 Sonoma or newer:** ${download(`CreatorClips-${version}-mac-arm64.dmg`)}`,
    `- **Mac with Intel, macOS 15 Sequoia or newer:** ${download(`CreatorClips-${version}-mac-x64.dmg`)}`,
    `- **Windows (64-bit):** ${download(`CreatorClips-${version}-win-x64.exe`)}`,
    '',
    'Already installed? CreatorClips updates itself: it downloads new versions in the background and installs them when you restart it.',
    ''
  ]
  if (!windowsSigned) {
    lines.push(
      '> **Windows build is not code-signed.** Windows may show "Windows protected your PC": click **More info**, then **Run anyway**.',
      '> This Windows version does not update itself; download each new version from this page.',
      ''
    )
  }
  lines.push(`## What's new in ${version}`, '', changelogSection(markdown, version), '')
  return lines.join('\n')
}

if (require.main === module) {
  try {
    const version = process.argv[2]
    if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Pass the version, like 1.2.3')
    const markdown = fs.readFileSync(path.resolve(__dirname, '../../CHANGELOG.md'), 'utf8')
    process.stdout.write(releaseNotes(markdown, version, {
      repository: process.env.CREATORCLIPS_RELEASES_REPO || undefined,
      windowsSigned: !process.argv.includes('--windows-unsigned')
    }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { changelogSection, releaseNotes }
