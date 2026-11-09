# BridgeClip release history

CreatorClips is built on [BridgeClip](https://github.com/bridge-mind/bridgeclip) by BridgeMind (MIT license). These are BridgeClip's own release notes up to 0.1.19, kept here for maintainers. They are not shown in the app or in CreatorClips release notes: the in-app Changelog reads `CHANGELOG.md`, which only credits BridgeClip for these versions.

## [0.1.19] - 2026-09-27

One release for macOS, Windows and Linux.

### Added

- Linux installers for x64: an AppImage and a DEB package.

### Changed

- YouTube downloads that fail for a temporary reason retry automatically with a fresh link.
- Playlists and live or upcoming streams are turned away before downloading. Paste a link to a single, finished video.

### Fixed

- An automation keeps posting the rest of its queue when one clip's details can't be verified.
- Generated post captions that quote the video are accepted when the speaker stutters, and captions can no longer contain web links.
- Hardened how CreatorClips handles captions, file paths, titles, downloads and its bundled Python, so unusual input can't change video processing commands or load unexpected code.

## [0.1.18] - 2026-09-25

### Added

- A signed installer for Windows x64. This version shipped for Windows only and has no other changes from 0.1.17.

## [0.1.17] - 2026-09-25

The first version with downloadable installers, starting with macOS.

### Added

- macOS apps for Apple silicon and Intel, signed with BridgeMind's Developer ID and notarized by Apple.
- Automatic updates. CreatorClips checks shortly after launch and every four hours, downloads in the background, and installs when you choose **Restart to update** or the next time you quit. Settings → About shows the status and has **Check for updates**.
- Clip public, finished Twitch VODs by pasting their link.
- **Video speed** in Create → Format speeds up every clip in a job, from 1.1× to 2×. Voices keep their pitch and captions stay in sync.
- TikTok accounts in automations. Each clip gets a review of its caption, audience, interactions and disclosures before it can post.
- **Economy** clipping mode, which uses lower-cost models and skips AI vision checks.
- **Advanced** clipping mode, for choosing your own transcription and planning models from OpenRouter.
- A **Posts** page with your posting history.
- Run stats that compare time and cost with OpusClip when there's enough information for a fair comparison.
- New app icons.

### Changed

- Captions are placed more carefully around faces.
- Jobs with a start and end time only transcribe that part of the video, which is faster and cheaper.
- Accounts, Automations and Jobs are more compact, and menus and confirmation dialogs work with the keyboard.
- Clip cost details name both transcription models when a job switches models partway through.
- Setting up a Zernio profile, and recovering from access problems, is clearer in Accounts.

### Fixed

- Automations could post the same clip twice after a slow or failed response.
- A clip you return to the automation queue after checking it by hand can post again.
- A scheduled slot stays free when a changed clip's TikTok approval is withdrawn, so you can review it and still post on time.
- Automation retries no longer stop at transcription with an HTTP 400 error.
- Page shortcuts no longer close a post dialog while it's uploading.
- Starting a job no longer fails on some IPv6 networks.
- Windows: Python is found reliably, edits with many cuts work, and saved results are opened safely.
- Exports whose audio drifts out of sync are caught before they're saved.

## [0.1.16] - 2026-09-24

### Added

- CreatorClips' source code is public under the MIT license. Installers start with 0.1.17.

[0.1.19]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.19
[0.1.18]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.18
[0.1.17]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.17
[0.1.16]: https://github.com/bridge-mind/bridgeclip/tree/7107574215cc7f1d4059d10d62bd82014a3ba46f
