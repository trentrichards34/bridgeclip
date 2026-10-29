# Releasing CreatorClips

CreatorClips is released by Wealthery. The owner's step-by-step guide, with every click, is [FIRST-RELEASE-CHECKLIST.md](FIRST-RELEASE-CHECKLIST.md). This page is the technical reference.

## Two repositories

| Repository | Visibility | Holds |
| --- | --- | --- |
| `trentrichards34/bridgeclip` | Private | Source code, the release workflow, all signing secrets |
| `trentrichards34/creatorclips-releases` | **Public** | Only GitHub Releases: installers and update feeds. No source |

Installed apps check for updates without a GitHub token, and electron-updater can't read releases of a private repository without one. So the private source repository builds and signs, and uploads the results to the public releases repository. Members download from, and their apps update from, `https://github.com/trentrichards34/creatorclips-releases/releases`.

## Packages

| System | Architecture | Files | Built on | Trust |
| --- | --- | --- | --- | --- |
| macOS | Apple silicon | `CreatorClips-X.Y.Z-mac-arm64.dmg`, `.zip` | `macos-14` | Signed with our Apple Developer ID certificate; app and DMG notarized and stapled |
| macOS | Intel | `CreatorClips-X.Y.Z-mac-x64.dmg`, `.zip` | `macos-15-intel` | Same |
| Windows | x64 | `CreatorClips-X.Y.Z-win-x64.exe` | `windows-latest` | Authenticode via Azure Trusted Signing when its secrets are set; otherwise **unsigned**, labeled in the release notes |

Every release also carries `latest-mac.yml` (both Mac architectures merged), `latest.yml` (Windows), blockmaps, `release-manifest.json` and `SHA256SUMS.txt`.

- The Mac app runs on the runner's macOS version or newer: FFmpeg links Homebrew's caption libraries, which Homebrew builds for the runner's OS. That makes Apple silicon builds need macOS 14+ and Intel builds macOS 15+. `builder-config.cjs mac <arch>` sets `mac.minimumSystemVersion` to match (14.0 / 15.0; `electron-builder.yml` has 14.0 for local builds), so macOS refuses to open the app on an older system instead of failing at FFmpeg. GitHub retired `macos-13`, the last older Intel image, in December 2025. When `macos-14` is retired, move Apple silicon to `macos-15`, which means macOS 15+.
- Linux packages still build from source (`npm run dist:linux-x64`), but the workflow does not publish them. A Linux app has no update feed and reports "No release for this platform yet."

## Release identity

Who publishes and signs a build is compiled into it. `electron.vite.config.ts` reads these variables when it runs `npm run build` and embeds them as `__CREATORCLIPS_RELEASE__` (`src/shared/release-identity.ts`, read by `src/shared/brand.ts`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `CREATORCLIPS_RELEASES_REPO` | `trentrichards34/creatorclips-releases` | Where the app checks for updates. Also the Settings, Help menu and release-notes links |
| `CREATORCLIPS_MAC_TEAM_ID` | none | Apple team whose Developer ID signature the Mac app requires before it updates itself |
| `CREATORCLIPS_WIN_PUBLISHER` | none | Authenticode publisher the Windows app requires on every downloaded update |

With no team ID or publisher, a build never updates itself (Settings → About says it isn't signed). Only official builds, signed with our Apple Developer certificate, self-update:

- **macOS** (`src/main/auto-updater.ts`): the updater starts only if `codesign` reports `TeamIdentifier=<CREATORCLIPS_MAC_TEAM_ID>` and a Developer ID Application authority. Squirrel.Mac then installs an update only if it satisfies the running app's designated requirement, so it must come from the same team.
- **Windows**: the updater starts only if a publisher was compiled in, which happens only when CI signed the build. electron-updater checks each downloaded installer against `publisherName` in `app-update.yml` before running it.
- The values sit in `app.asar`, which Electron's integrity fuse checks (`electron-builder.yml` `electronFuses`), and a modified Mac bundle fails its code signature.

`scripts/release/builder-config.cjs <mac|windows|linux> [arm64|x64]` writes `release-<platform>.json` for electron-builder from `electron-builder.yml` and the same variables. It points `publish` at the releases repository. With `RELEASE_SIGNING=1` it requires every signing input and enables `forceCodeSigning`: on macOS, `mac.identity` is the team ID (it picks the `Developer ID Application: … (TEAM)` certificate from `CSC_LINK`), along with `notarize` and `dmg.sign`. On Windows it sets `azureSignOptions` with `publisherName = CREATORCLIPS_WIN_PUBLISHER`. Unsigned configs refuse a team ID or publisher, so an unsigned build can't claim one.

`electron-builder.yml` itself stays unsigned (`mac.identity: null`, no Windows publisher). That keeps local `npm run dist:*` builds off the update channel.

## The workflow

`.github/workflows/release.yml`, in the private repository:

**On a pushed tag `vX.Y.Z`** (an official release):

1. **Tests** (Ubuntu): checks the tag matches `package.json`, then runs `typecheck`, `lint`, `test:main` and `test:release`. `test:release` includes the changelog check: the version needs a dated `CHANGELOG.md` section.
2. **Mac (arm64)** and **Mac (x64)**, each on its native runner: `brew install pkg-config libass` (plus `nasm` on Intel), then `scripts/prepare-resources.sh <arch>`, which builds LGPL FFmpeg, bundles Python and runs the engine smoke tests. Next `npm run build`, `builder-config.cjs mac <arch>` and `electron-builder --mac --<arch>` sign and notarize the app. The DMG is notarized and stapled with `xcrun notarytool`/`stapler`, and `refresh-metadata.cjs` rewrites `latest-mac.yml` for the final bytes (updates use the ZIP). Last come `verify-packaged-mac.sh`, the `codesign`, `spctl` and `stapler` checks, and the TeamIdentifier check.
3. **Windows (x64)**: `stage-runtime.py`, then build, then `verify-runtime.py` on the unpacked resources. Signed builds also run `verify-windows.ps1`, which installs the real installer and checks the publisher and signatures.
4. **Draft release**: downloads the build artifacts and runs `collect-artifacts.cjs … desktop`. That script checks every file against the updater SHA-512s and versions, merges the two Mac feeds, and writes the manifest and checksums. Release notes come from `release-notes.cjs` (download links plus the CHANGELOG section, and a warning if Windows is unsigned). `gh release create vX.Y.Z --draft --latest` then uploads to the releases repository with `GH_RELEASES_TOKEN`. It fails if that release already exists. It never overwrites one.

Nothing reaches members until someone opens the draft and clicks **Publish release**.

**Manual run** (Actions → Release → Run workflow; choose `all`, `macos` or `windows`): the same builds, **unsigned**, with no team ID or publisher compiled in. Nothing is published. The run page keeps the files as artifacts for 7 days.

### Secrets and variables

Set these in the private repository under **Settings → Secrets and variables → Actions**.

| Secret | Required | Value |
| --- | --- | --- |
| `CSC_LINK` | Mac | Base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Mac | Password of that `.p12` |
| `APPLE_ID` | Mac | Apple Account email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | Mac | App-specific password for that account |
| `APPLE_TEAM_ID` | Mac | 10-character team ID. Also compiled in as the trusted update signer |
| `GH_RELEASES_TOKEN` | Publish | Fine-grained token: `creatorclips-releases` only, Contents read and write |
| `WINDOWS_PUBLISHER_NAME` | Windows signing | Certificate subject CN, exactly as on the Azure certificate profile |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Windows signing | Entra app registration with the *Trusted Signing Certificate Profile Signer* role |
| `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | Windows signing | Trusted Signing endpoint URL, account name, certificate profile name |

Windows is signed only when `AZURE_CLIENT_SECRET` and `WINDOWS_PUBLISHER_NAME` are both set. Otherwise it's built unsigned, and the run shows a warning.

| Variable (optional) | Effect |
| --- | --- |
| `RELEASES_REPO` | Use another public releases repository (`owner/repo`) |
| `RELEASE_PLATFORMS` | `macos` skips Windows and publishes a Mac-only release |
| `FFMPEG_MIRROR` | HTTPS base URL that serves the exact FFmpeg archive pinned in `scripts/release/runtime-lock.json` (digest still enforced) |

## Versioning

The first CreatorClips release is `npm run release:major` (0.1.19, the last BridgeClip version, to 1.0.0).

`npm run release:patch` (or `release:minor`, `release:major`, or `node scripts/release/bump-version.cjs X.Y.Z`) runs `scripts/release/bump-version.cjs`, which:

1. requires a clean working tree and refuses an existing tag;
2. bumps `package.json` and `package-lock.json`;
3. moves `## [Unreleased]` entries into `## [X.Y.Z] - <today>` (it refuses an empty Unreleased) and updates the link definitions;
4. runs `scripts/changelog.test.cjs`, commits `Release vX.Y.Z` and creates the annotated tag `vX.Y.Z`.

It doesn't push. `git push origin HEAD --follow-tags` pushes the commit and tag and starts the release.

## Updates in the app

Installed apps check about 15 seconds after launch and every four hours, download in the background, and install on **Restart to update** or the next quit. `update-provider.ts` reads the release GitHub marks as latest. If that release lacks this platform's feed (after a Mac-only release, say), it falls back to the newest published, non-prerelease `vX.Y.Z` release that has one. Always publish with **Set as the latest release**, never as a prerelease: prereleases are ignored.

Updates are off for: unpackaged builds, builds without a compiled-in signer, Mac builds not signed by that team, a Mac app running from its disk image or quarantine (Settings offers **Move to Applications**), and `BRIDGECLIP_DISABLE_AUTO_UPDATE=1`.

Before claiming updates work, install the first signed release, publish the next, and watch it update. A packaging run doesn't prove an upgrade path.

## Never overwrite a release

- A published version is never replaced. Fixes ship as a new version.
- A failed run leaves at most a draft. Delete the draft in the releases repository and rerun, or release a new version.
- If the tag was pushed but nothing was published, you may move it: `git tag -f vX.Y.Z && git push -f origin vX.Y.Z`.
- To withdraw a bad public version, edit it in the releases repository and save it as a draft (or delete it). Then publish a higher version, so installed apps can recover.

## Runtime reproduction

- macOS: `bash scripts/prepare-resources.sh arm64` on Apple silicon, or `x64` on Intel. Needs Homebrew `pkg-config` and `libass` (plus `nasm` on Intel). It builds LGPL FFmpeg from the pinned source and bundles that source as `engine-bin/FFMPEG-SOURCE.tar.xz`.
- Windows/Linux x64: `python scripts/release/stage-runtime.py` from a clean checkout. Windows needs Visual C++ build tools for the relocatable yt-dlp launcher; Linux needs `patchelf`. Python and FFmpeg archives are pinned by SHA-256 in `scripts/release/runtime-lock.json`.
- **The pinned FFmpeg autobuild (`autobuild-2026-09-24-14-14`) has expired upstream.** BtbN deletes old daily builds, and this URL now returns 404, so Windows builds fail at "Bundle Python and FFmpeg" until a developer acts. Either move the pin to a current BtbN LGPL shared 8.1 build (new tag, file names and SHA-256s, plus the `FFmpeg 8.1.3` text in `stage-runtime.py`), or set `FFMPEG_MIRROR` to a copy of the exact pinned archive. Until then, set `RELEASE_PLATFORMS=macos` to ship Mac-only releases.
- Windows FFmpeg is the LGPL shared upstream build. Distributing it requires offering its corresponding source. Publish a source archive for the exact build with each Windows release, or include a written offer.

`scripts/release/verify-runtime.py <resources>` copies packaged resources to a path containing spaces and tests the shipped Python, FFmpeg, captions, audio and downloader without the checkout.

## Verify a download

`SHA256SUMS.txt` lists every file's SHA-256: `shasum -a 256 --check SHA256SUMS.txt` in the download folder. It isn't separately signed. Trust comes from the operating system's code signature (on a Mac, `spctl --assess --verbose=2 /Applications/CreatorClips.app` should say `source=Notarized Developer ID`). `resources/release-public-key.pub` is the key BridgeMind used for BridgeClip releases. It does not sign CreatorClips releases.
