# CreatorClips · Signal design (mockup)

Clickable design mockup for the CreatorClips redesign. Not production code: open `CreatorClips Signal.dc.html` in a browser (keep `support.js` next to it).

## What it covers
- Shell: grouped sidebar (Make / Manage / Publish), collapsible, per-tool colours and icons, paste-to-start bar, Ask panel, Jobs drop-down
- Create (from JobForm.tsx / job-contract.ts fields), Library (refining / ready / baked statuses), Clip editor (scenes Full/Split/Fit, caption preset, position, suppression ranges)
- Jobs (from JobsPage.tsx), Chat (approval cards), Edit my recording, Remix, Avatar Studio, B-roll library, Brand look
- Not yet: Posts, Accounts, Automations, Settings

## Design tokens
- Background #07080C · surface rgba(17,20,27,0.85) · border rgba(255,255,255,0.07) · text #F1F3F8 / #9097A6 / #5E6575
- Tool colours: Create oklch(0.9 0.2 128) · Edit my recording oklch(0.82 0.14 210) · Remix oklch(0.72 0.24 340) · Avatar oklch(0.7 0.2 295) · Library oklch(0.85 0.15 75) · Jobs oklch(0.86 0.1 190) · B-roll oklch(0.74 0.17 35) · Brand look oklch(0.78 0.16 160)
- Type: Space Grotesk (headings), Geist (body), JetBrains Mono (numbers, labels)
- Radii: 10–12px controls, 16–18px cards

## Notes for the build
- Replace text-glyph icons (✦ ↻ ⋯ ✕) with Lucide, already used in the app
- Add visible focus states and respect prefers-reduced-motion
- Brand look accent / type / extras need graphics-engine support; today the engine takes caption_preset only
