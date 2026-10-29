'use strict'
// Writes the electron-builder config for one release build:
//   node scripts/release/builder-config.cjs <mac|windows|linux> [arm64|x64]   ->  release-<platform>.json
// then: electron-builder --config release-<platform>.json --publish never
//
// It starts from electron-builder.yml and adds who publishes and signs this build,
// from the same environment variables electron.vite.config.ts compiles into the app
// (src/shared/release-identity.ts), so the app's update trust and its signature agree:
//
//   CREATORCLIPS_RELEASES_REPO   public releases repository (owner/repo); default Wealthery's
//   RELEASE_SIGNING=1            sign this build (and, on macOS, notarize it); fail if anything is missing
//   macOS signed:   CREATORCLIPS_MAC_TEAM_ID, plus CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID,
//                   APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (same team) for electron-builder
//   Windows signed: CREATORCLIPS_WIN_PUBLISHER, SIGNING_ENDPOINT, SIGNING_ACCOUNT, SIGNING_PROFILE,
//                   plus AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET for Azure Trusted Signing
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

// The oldest macOS each Mac build runs on. The bundled FFmpeg links Homebrew libraries
// built for the CI runner's macOS (docs/RELEASING.md): macos-14 for Apple silicon and
// macos-15-intel for Intel. macOS refuses to open the app on anything older.
const MAC_MINIMUM_SYSTEM_VERSION = { arm64: '14.0', x64: '15.0' }

const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
const DEFAULT_RELEASES_REPOSITORY = 'trentrichards34/creatorclips-releases'

function required(env, keys) {
  const missing = keys.filter((key) => !env[key] || !String(env[key]).trim())
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}`)
}

function releaseConfig(base, platform, env, arch) {
  if (!['mac', 'windows', 'linux'].includes(platform)) throw new Error('Platform must be mac, windows or linux')
  if (arch !== undefined && (platform !== 'mac' || !Object.hasOwn(MAC_MINIMUM_SYSTEM_VERSION, arch))) {
    throw new Error('Architecture must be arm64 or x64, for mac only')
  }
  const config = structuredClone(base)
  const repository = (env.CREATORCLIPS_RELEASES_REPO || DEFAULT_RELEASES_REPOSITORY).trim()
  if (!REPOSITORY.test(repository)) throw new Error('CREATORCLIPS_RELEASES_REPO must look like owner/repo')
  const [owner, repo] = repository.split('/')
  // electron-builder writes this into the app's app-update.yml and generates latest*.yml for it.
  config.publish = { provider: 'github', owner, repo }
  const signing = env.RELEASE_SIGNING === '1'

  if (platform === 'mac') {
    if (arch) config.mac.minimumSystemVersion = MAC_MINIMUM_SYSTEM_VERSION[arch]
    if (signing) {
      required(env, ['CREATORCLIPS_MAC_TEAM_ID', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])
      const team = env.CREATORCLIPS_MAC_TEAM_ID.trim()
      if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('CREATORCLIPS_MAC_TEAM_ID must be a 10-character Apple team ID')
      if (env.APPLE_TEAM_ID.trim() !== team) throw new Error('APPLE_TEAM_ID and CREATORCLIPS_MAC_TEAM_ID must be the same team')
      config.forceCodeSigning = true
      // Picks the "Developer ID Application: … (TEAM)" certificate from CSC_LINK.
      config.mac.identity = team
      config.mac.notarize = true
      config.dmg = { ...config.dmg, sign: true }
    } else {
      if (env.CREATORCLIPS_MAC_TEAM_ID) throw new Error('An unsigned build must not compile in CREATORCLIPS_MAC_TEAM_ID')
      config.mac.identity = null
      config.mac.notarize = false
    }
  }

  if (platform === 'windows') {
    // No hard-coded publisher: an unsigned build carries none, and only a signed
    // build tells electron-updater which publisher its updates must come from.
    delete config.win.signtoolOptions
    if (signing) {
      required(env, ['CREATORCLIPS_WIN_PUBLISHER', 'SIGNING_ENDPOINT', 'SIGNING_ACCOUNT', 'SIGNING_PROFILE', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'])
      config.forceCodeSigning = true
      config.win.verifyUpdateCodeSignature = true
      config.win.azureSignOptions = {
        publisherName: env.CREATORCLIPS_WIN_PUBLISHER.trim(),
        endpoint: env.SIGNING_ENDPOINT.trim(),
        codeSigningAccountName: env.SIGNING_ACCOUNT.trim(),
        certificateProfileName: env.SIGNING_PROFILE.trim(),
        fileDigest: 'SHA256',
        timestampDigest: 'SHA256',
        timestampRfc3161: 'http://timestamp.acs.microsoft.com'
      }
    } else {
      // The app would trust that publisher for updates no unsigned build can satisfy.
      if (env.CREATORCLIPS_WIN_PUBLISHER) throw new Error('An unsigned build must not compile in CREATORCLIPS_WIN_PUBLISHER')
      config.win.verifyUpdateCodeSignature = false
    }
  }
  return config
}

if (require.main === module) {
  try {
    const platform = process.argv[2]
    const arch = process.argv[3]
    const root = path.resolve(__dirname, '../..')
    const base = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'))
    const config = releaseConfig(base, platform, process.env, arch)
    const output = path.join(root, `release-${platform}.json`)
    fs.writeFileSync(output, JSON.stringify(config, null, 2) + '\n')
    console.log(`Wrote ${path.basename(output)}: ${process.env.RELEASE_SIGNING === '1' ? 'signed' : 'UNSIGNED'} ${platform}${arch ? ` ${arch}` : ''} build${config.mac?.minimumSystemVersion && platform === 'mac' ? ` for macOS ${config.mac.minimumSystemVersion}+` : ''}, updates from ${config.publish.owner}/${config.publish.repo}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { releaseConfig, DEFAULT_RELEASES_REPOSITORY, MAC_MINIMUM_SYSTEM_VERSION }
