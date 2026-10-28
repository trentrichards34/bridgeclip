# Changelog

What's new in each version of CreatorClips, newest first. You can also read this in the app under **Settings → About → Changelog** or **Help → Changelog**. Downloads for every version are on [GitHub Releases](https://github.com/trentrichards34/creatorclips-releases/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Maintainers: see [Changelog](CONTRIBUTING.md#changelog) in the contributing guide before editing.

## [Unreleased]

### Added

- **AI explainers** (under Make): animated explainer reels with a cartoon presenter, paper-and-ink animation and a voiceover timed word by word, made by a skill that runs in your own Claude (Claude Code), so each video is covered by your Claude plan. The page explains what you need, saves the skill to your computer as an **AI Video** folder, and walks you through setup and your first reel with prompts to copy.
- **Custom graphics** (Beta, in Edit my recording's Skills): for the few key moments of a video, your AI designs a graphic for that exact idea, looks at it over your video and fixes it before it's used. The beat sheet shows the cost first, designs them, and lets you change one with a note or go back to its template; the clip editor does the same. Uses your OpenRouter credit.
- **Custom graphics feel like one piece**: before designing, your AI picks one visual world for the whole video from your own words (shown in one line on the beat sheet; edit it or have it proposed again). Each graphic builds up as you talk, one new part on each key word, keeps gently moving and holds 3 to 8 seconds before your face comes back. A motion check sends back any graphic that freezes for more than 1.5 seconds, and the beat sheet lists the reel's flat stretches with **Add a visual here** and **Design one**
- **My motion library**: every custom graphic that passes its check is kept, so later videos can use it again, filled with the words you say (cheaper, and your graphics stay consistent). Browse it as moving tiles under **My graphics** in the graphic gallery ("used in N videos"), add one at the playhead or on a beat, and retire or restore graphics. Ones that never passed are kept as Retired with the reason.
- **What to clip** in Create → Clips: describe the moments you want, such as "every time they talk about pricing". Leave it blank to get the strongest moments as before.
- **Show title at the top** in Create → Captions turns off the title card on Automatic clips.
- **Review & edit** workflow: look over clip candidates before exporting. Trim, split and extend cuts, change layouts and camera changes, fix and place captions, then bake one clip or every ready clip with **Bake all**. You can also swap in a higher-quality copy of the source video.
- Jobs show progress for each stage on a timeline, a **Job Breakdown** of where the time went, and **Details** with reviews, the transcript and source research.
- The Library shows how many clips in each run are posted, lets you bookmark runs, and deletes whole runs or single clips.
- Settings → About shows how much disk space your output folder uses.
- YouTube links show a preview in Create.
- Automations have **Submitted** and **Needs attention** sections, drag to reorder, **View in Library**, reviewable title and caption drafts, **Refresh post status** and **Return to queue**.
- **TypeSafe Jev review** and **Research the source before clipping**, both in beta and off by default. Turn them on in Settings. Both use extra OpenRouter credit.
- **Free editor media** removes an editor project's source copy and preview once you're done with it.
- CreatorClips asks whether to save or discard unsaved edits before quitting, and offers **Reload project** when a project was changed elsewhere.
- This changelog, in Settings → About and the Help menu.
- **Chat**: run CreatorClips in plain words. It uses your Claude (Pro or Max, through Claude Code) or ChatGPT (through Codex) subscription, or any OpenRouter model with your OpenRouter key; connect them in **Settings → Assistant**. The assistant can start clipping jobs, manage the Library and automations, and post or schedule clips. Anything that publishes, deletes or spends OpenRouter credit on clipping asks you first.
- Chat's model menu has a tab each for Claude, OpenAI and OpenRouter (search every OpenRouter model that can use tools, with prices), and each reply shows the logo and model that wrote it. Recent chats are listed beside the conversation, with search.
- Chat can find YouTube videos by channel or search, so "clip the latest BridgeMind video" works without a link, and can search the web and read web pages.

### Changed

- **Create** is now **Clip** in the sidebar: the same tool for turning long videos into short clips, with a name that says what it does.
- **Avatar Studio** is tucked away for now: it's gone from the sidebar, the setup steps, Today's 3, Guides, Chat and Remix (which offers the **You on camera** formats). Avatar videos you already made stay in your Library and still play.
- CreatorClips is now released and signed by Wealthery. Downloads and automatic updates come from [CreatorClips Releases](https://github.com/trentrichards34/creatorclips-releases/releases), and **Settings → About** and the Help menu link there.
- More built-in sound effects: about twice as many takes of every whoosh, swipe, pop, tick, click, impact, riser and paper sound (all free to use: CC0 or our own), so videos with many moves sound less repetitive.
- Smart framing ignores weak background faces, stays on a speaker who briefly looks away, follows talking heads inside 4:3 video, and analyzes footage faster.
- Screen + webcam clips fill the top panel again.
- Editor previews use much less disk space, and downloaded sources are moved into the project instead of copied.

### Fixed

- Smooth camera movement in the editor works in installed apps.
- **Bake all** keeps going when one clip fails, and says what went wrong.
- Titles with emoji at the length limit no longer break editor projects.
- Automations: submitted and held clips can be removed, posted clips no longer count toward the 500-clip limit, a post deleted in Zernio no longer leaves its clip stuck, slots that come due during an enhancement are kept, and one pending draft no longer blocks the rest of the queue.
- Unattended posts no longer use text from the source video's description, and refuse web addresses or @handles that aren't said in the video.
- Deleting a clip also removes its caption and YouTube text files.
- A missing transcript shows a clear message, and research citations can be selected and copied.
- Screen + webcam clips fill the bottom panel with the webcam, instead of showing a small webcam over a blurred copy of itself when the webcam in the source video is small.

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

[Unreleased]: https://github.com/trentrichards34/bridgeclip/compare/v0.1.19...HEAD
[0.1.19]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.19
[0.1.18]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.18
[0.1.17]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.17
[0.1.16]: https://github.com/bridge-mind/bridgeclip/tree/7107574215cc7f1d4059d10d62bd82014a3ba46f
