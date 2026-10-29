# Changelog

What's new in each version of CreatorClips, newest first. You can also read this in the app under **Settings → About → Changelog** or **Help → Changelog**. Downloads for every version are on [GitHub Releases](https://github.com/trentrichards34/creatorclips-releases/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Maintainers: see [Changelog](CONTRIBUTING.md#changelog) in the contributing guide before editing.

## [Unreleased]

The first CreatorClips release. CreatorClips is Mac only for now: Macs with Apple silicon need macOS 14 Sonoma or newer, and Intel Macs need macOS 15 Sequoia or newer.

### Added

- **Clip** turns long videos into short, captioned clips. Paste a YouTube or Twitch link, or choose files from your computer, up to 10 videos at once. **Automatic** makes finished clips; **Review & edit** shows you the candidates first so you can pick and trim them.
- **What to clip** in Clip → Clips: describe the moments you want, such as "every time they talk about pricing". Leave it blank to get the strongest moments.
- **Review & edit** workflow: look over clip candidates before exporting. Trim, split and extend cuts, change layouts and camera changes, fix and place captions, then bake one clip or every ready clip with **Bake all**. You can also swap in a higher-quality copy of the source video.
- YouTube links show a preview in Clip.
- **Edit my recording** turns a raw recording of you talking to camera, or a few takes of it, into one finished vertical reel: retakes and filler words cut and the strongest hook first. Review every word before you make the reel. Add a screen recording to go with your camera recording, film right in the app, get ideas from **What should I film?**, or **Combine** several clips into one reel.
- **Custom graphics** (Beta, in Edit my recording's Skills): for the few key moments of a video, your AI designs a graphic for that exact idea, looks at it over your video and fixes it before it's used. The beat sheet shows the cost first, designs them, and lets you change one with a note or go back to its template; the clip editor does the same. Uses your OpenRouter credit.
- **Custom graphics feel like one piece**: before designing, your AI picks one visual world for the whole video from your own words (shown in one line on the beat sheet; edit it or have it proposed again). Each graphic builds up as you talk, one new part on each key word, keeps gently moving and holds 3 to 8 seconds before your face comes back. A motion check sends back any graphic that freezes for more than 1.5 seconds, and the beat sheet lists the reel's flat stretches with **Add a visual here** and **Design one**.
- **Scenes** choice for custom graphics: **Light**, **Standard** or **Full** sets how many scenes your AI designs, with the estimated cost of each shown before anything is spent.
- **My motion library**: every custom graphic that passes its check is kept, so later videos can use it again, filled with the words you say (cheaper, and your graphics stay consistent). Browse it as moving tiles under **My graphics** in the graphic gallery ("used in N videos"), add one at the playhead or on a beat, and retire or restore graphics. Ones that never passed are kept as Retired with the reason.
- **Design a custom graphic here** in the clip editor (Add graphic, for clips from Clip, B-roll videos and Edit my recording reels): your AI designs a new graphic at the playhead from the words you say there and an optional note like "make it a rocket", in your video's look, and shows what it costs first.
- **Remix videos open in the clip editor** (**Open in editor** in a video's ⋯ menu, or in the Library's clips view): add graphics, effects, My motion library graphics or a custom graphic on top of your finished remix, which keeps its layout, captions and hook text, then bake it to replace the video in your Library. **Design a custom graphic here** now offers **Best** or **Lower cost** (one design, no improvement rounds), with the estimate of each shown before anything is spent.
- **Stage layouts** (Beta): big cards go on a stage at the top, with you in a card below, then back to full frame. **Fix layout** in the clip editor works the scenes out again from a clip's graphics, for free; Undo brings the old ones back.
- **Explainer style** (Beta): you, cut out of your video, at the bottom of a paper page, with one continuous illustration above you that changes on every line you say.
- **Sound effects**: soft whooshes, swipes, pops, ticks, clicks, impacts, risers and paper sounds as your graphics and scenes come in, under your voice. Each sound has several takes, and each video starts on a different one, so videos with many moves sound less repetitive. All are free to use: CC0 or our own.
- Choose how long hook text stays on screen, from a few seconds to the whole video, in the clip editor, Brand look and B-roll video.
- **Trial reels**: **Hook ideas** in the clip editor writes 5 hook options from what is said in a clip. Tick **Trial reel** on several to make a copy of the clip for each hook, with the same graphics and scenes, for Instagram trial reels.
- **Remix**: react to someone else's video on camera, recorded in the app or uploaded from your phone. **Pause & react** plays their video above your camera, and Space pauses it while you talk. Also **Moment + my take** (pick moments from a long video and give your take on each), **Their clip, then me**, **React, then my thoughts**, **Green screen over their video**, **Scripted take** and **Article or post**. The AI writes the hook text and caption from what you said.
- **B-roll video** (Beta): your voiceover, or a script read by an AI voice, covered start to end with your own b-roll, with captions, hook text and motion graphics. The cost shows before you start, and you can swap any shot or open the video in the clip editor.
- **B-roll library** (Beta): add your own clips and pictures. The AI looks at each one once, then Clip, Remix and B-roll video use the shots that match what you say. Your files stay where they are.
- **AI explainers** (under Make): animated explainer reels with a cartoon presenter, paper-and-ink animation and a voiceover timed word by word, made by a skill that runs in your own Claude (Claude Code), so each video is covered by your Claude plan. The page explains what you need, saves the skill to your computer as an **AI Video** folder, and walks you through setup and your first reel with prompts to copy.
- **Brand look**: set your style once. Every tool starts from your default look, and you can change it for one video or one clip.
- **Open in editor** in the ⋯ menu of a Clip run in the Library.
- The Library shows how many clips in each run are posted, lets you bookmark runs, and deletes whole runs or single clips.
- Jobs show progress for each stage on a timeline, a **Job Breakdown** of where the time went, and **Details** with reviews, the transcript and source research.
- **Posts and Automations**: post or schedule any video in your Library to your connected accounts through Zernio. **Posts** shows everything scheduled and posted, as a list or a calendar, and Automations post new videos on a schedule.
- Automations have **Submitted** and **Needs attention** sections, drag to reorder, **View in Library**, reviewable title and caption drafts, **Refresh post status** and **Return to queue**.
- **Settings → Spending** lists what each tool cost, from what each provider reported, and lets you set a monthly AI spending limit.
- **Guides**: short how-tos for each kind of video.
- **Help → Report an Issue** copies a support report (never your keys) and opens the CreatorClips issues page, or your own support link from Settings → About.
- **TypeSafe Jev review** and **Research the source before clipping**, both in beta and off by default. Turn them on in Settings. Both use extra OpenRouter credit.
- **Free editor media** removes an editor project's source copy and preview once you're done with it.
- CreatorClips asks whether to save or discard unsaved edits before quitting, and offers **Reload project** when a project was changed elsewhere.
- Settings → About shows how much disk space your output folder uses.
- This changelog, in Settings → About and the Help menu.
- **Chat**: run CreatorClips in plain words. It uses your Claude (Pro or Max, through Claude Code) or ChatGPT (through Codex) subscription, or any OpenRouter model with your OpenRouter key; connect them in **Settings → Assistant**. The assistant can start clipping jobs, manage the Library and automations, and post or schedule clips. Anything that publishes, deletes or spends OpenRouter credit on clipping asks you first.
- Chat's model menu has a tab each for Claude, OpenAI and OpenRouter (search every OpenRouter model that can use tools, with prices), and each reply shows the logo and model that wrote it. Recent chats are listed beside the conversation, with search.
- Chat can find YouTube videos by channel name or search, so you can ask it to clip a channel's latest video without a link, and it can search the web and read web pages.

### Changed

- **Automatic updates**: CreatorClips is signed with our Apple Developer certificate and notarized by Apple. Downloads and automatic updates come from [CreatorClips Releases](https://github.com/trentrichards34/creatorclips-releases/releases), and **Settings → About** and the Help menu link there. CreatorClips downloads new versions in the background and installs them when you choose **Restart to update** or the next time you quit.
- Hook text choices in Clip → Look include a title card or no hook text.
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

CreatorClips is built on BridgeClip by BridgeMind (MIT).

[Unreleased]: https://github.com/trentrichards34/bridgeclip/compare/v0.1.19...HEAD
[0.1.19]: https://github.com/bridge-mind/bridgeclip/releases/tag/v0.1.19
