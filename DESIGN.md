# CreatorClips Design System: Signal

CreatorClips is a dark studio. One near-black backdrop, a slightly lighter sidebar, translucent dark cards with hairline borders, and **colour as a signal**: a lime accent for the one primary action, chosen options, live progress and focus, and one colour per tool for its icon tile, its page chip and a soft glow at the top of its page. People keep it open for hours, so surfaces stay quiet and the video stays the loudest thing on screen.

The reference mockup is `docs/design/signal/` (README with tokens, the clickable `CreatorClips Signal.dc.html`, and `screens/*.png`). Tokens live in `src/renderer/globals.css` (RGB channels plus the material classes) and are mapped to Tailwind names in `tailwind.config.ts`. Reusable pieces live in `src/renderer/components/ui/`. Use those before writing new class strings.

---

## Principles

1. **Layers, not boxes.** Backdrop → sidebar → cards (`glass`) → tiles and wells inside cards → floating menus and dialogs (`glass-thick`). Don't draw raw grey rectangles.
2. **Hairlines and soft depth.** Cards are 85% dark surfaces with a 1px white-7% rim and a black shadow. Borders are `line` (white 7%) or `line-strong` (white 14%).
3. **Video first.** Thumbnails, previews and caption samples carry the colour.
4. **Lime is the signal.** The accent (`#B7F652`, oklch 0.9 0.2 128) is for the primary action, live progress, the focus ring and Create. Text on solid lime is dark (`accent-ink`).
5. **Every tool has a colour.** It marks the tool's nav tile, its page chip, its page glow and, on that page, the chosen option (`glass-selected`). Don't use tool colours for status.
6. **Only failure earns a status hue.** Red means something broke, amber means setup is incomplete or something needs a look, green means found/ready/saved.
7. **Say what happened.** Errors show the engine's actual message and a suggested fix, never just "Something went wrong".

---

## Materials (`globals.css`)

| Class | What it is | Use |
| --- | --- | --- |
| `app-backdrop` | Solid `canvas` (#07080C), opaque, so macOS vibrancy never tints the UI. | The window background. |
| `app-sidebar` | Solid `sidebar` (#0A0C11). | The sidebar only. |
| `page-glow` | A radial glow in the page's tool colour at 14%. | Layout draws it behind the top of every page. |
| `glass` | `surface` (#11141B) at 85%, 1px white-7% inset rim, faint top highlight, black shadow. `position: relative`. | Cards, panels, empty states. Needs a `rounded-*`. Don't add a `border` utility; the rim is the edge. |
| `glass-thick` | `surface` at 94% with a light blur, a white-9% rim and a deep shadow. | Anything floating over content: dialogs, menus, popovers, sticky toolbars. |
| `glass-tile` (+ `glass-tile-hover`) | `sidebar` at 70% with a white-7% border; hover lifts the border to 16%. | Rows, option cards and sub-sections inside a card. |
| `glass-selected` | Tool-colour tint with a tool-colour border and a 3px ring. Combine with `glass-tile`. | The chosen option. Lime on Create, pink on Remix, violet on Avatar Studio… |
| `glass-well` | `sidebar` at 85% with a white-8% border. | Text inputs, selects, text areas, inset lists. |
| `glass-chip` | Small frosted label with blur. | Anything overlaid on video or artwork. |
| `tool-chip` (+ `tool-chip-dot`) | Pill in the tool colour at 12% with a solid dot and an uppercase JetBrains Mono label. | Above every page title (`PageHeader` adds it). |
| `btn-primary` / `btn-glass` | Solid lime with dark ink and a soft lime glow / dark surface with a hairline. | Used by `Button`; don't apply directly. |
| `tool-<id>` | Sets `--tool` (and so `bg-tool`, `text-tool`, `glass-selected`, `tool-chip`) to a tool's colour. | Layout sets it on `<main>` and `<html>` for the current page; the sidebar sets it per item. |

`prefers-reduced-transparency` makes cards solid and drops blur. `prefers-reduced-motion` stops animation and transitions.

---

## Color

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#07080C` | Backdrop |
| `sidebar` | `#0A0C11` | Sidebar, wells, tiles |
| `surface` · `raised` · `overlay` | `#11141B` · `#13161E` · `#1A1E27` | Cards (at 85%), idle nodes, menus and chips |
| `ink` | `#F1F3F8` | Primary text |
| `ink-muted` | `#9097A6` | Secondary text, descriptions |
| `ink-subtle` | `#787F8F` | Hints, metadata, eyebrows (4.6:1 on the backdrop) |
| `ink-faint` | `#5E6575` | Placeholders, disabled, group labels; never for text the user must read |
| `line` / `line-strong` | white 7% / 14% | Hairlines and dividers |
| `accent` | `#B7F652` (oklch 0.9 0.2 128) | Primary buttons, progress, focus ring, Create |
| `--accent-button-hover` | `#CDFB80` | Primary button hover |
| `accent-ink` | `#07080C` | Text and icons on solid lime |
| `success` · `warning` · `danger` | `#4ADE80` · `#FFBE4D` · `#FF6B6E` | Status only |

Tool colours (`tool-*`, sRGB of the mockup's oklch values): Create `#B7F652` (lime) · Edit my recording `#13DCF6` (cyan) · Remix and Chat `#FF56D3` (pink) · Avatar Studio `#AA7EFF` (violet) · Library `#FFBE4D` (amber) · Jobs `#7BE6DF` (teal) · B-roll video and B-roll library `#FF7D5C` (orange) · Brand look `#3AD693` (green) · Posts, Accounts, Automations `#7ABDFF` (blue) · Guides, Settings `#979FAB` (grey). `tool` (no suffix) is the current page's colour.

Every token supports alpha modifiers: `bg-accent/10`, `bg-tool/[0.12]`, `text-danger`. Gradients are allowed only where the design has them: the page glow, the Ask button (pink → violet), progress fills (cyan → lime) and the app icon.

---

## Typography

- **Space Grotesk** for headings (`font-display`; `h1` and `h2` use it by default), **Geist** for body text, **JetBrains Mono** (`font-mono`) for labels, numbers, timecodes, paths, costs and keyboard hints. All are vendored in `assets/fonts/` (SIL OFL 1.1, with their license files), so the app renders the same offline and never fetches a font.
- UI text is 13px (`text-sm`). The scale is `2xs` 11, `xs` 12, `sm` 13, `base` 14, `lg` 16, `xl` 20, `2xl` 24, `3xl` 30, `4xl` 40.
- Page titles are 28px (34px from `xl`) Space Grotesk semibold with -0.03em tracking, under the tool chip. Panel titles are 15px Space Grotesk. `.eyebrow` is a 10px uppercase JetBrains Mono label with 0.12em tracking.
- Numbers that change or line up use `font-mono tabular`.

---

## Shape and depth

Corners are soft and **concentric**: a shape nested inside another with padding `p` uses the outer radius minus `p`.

| Radius | Px | Use |
| --- | --- | --- |
| `rounded-lg` | 10 | Small buttons, inputs, menu rows, nav items |
| `rounded-[10px]` / `rounded-xl` | 10 / 12 | Buttons (`md` / `lg`), selects, segmented tracks, tiles, callouts |
| `rounded-2xl` | 16 | Cards and panels |
| `rounded-3xl` / `rounded-[18px]` | 18 | Dialogs, large hero cards |
| `rounded-full` | — | Status dots, switches, the tool chip, avatars |

---

## Layout

```
┌ sidebar (#0A0C11, 236px) ─┐┌ main ────────────────────────────────────────────────┐
│ [▶] CreatorClips      [⇤] ││ (page glow in the tool colour, top left)              │
│     v0.1.19 · ready       ││ [⌕ Paste a link to start clips, or search  ⌘K Start↵] [✦ Ask ⌘J] (TR) │
│ MAKE                      ││                                                        │
│  [+] Create               ││  (● CREATE)                                            │
│  [▭] Edit my recording    ││  Turn a long video into clips      ← PageHeader        │
│  [⇄] Remix                ││  muted subtitle                                        │
│  [☺] Avatar Studio        ││  cards …                         #page-scroll           │
│  [▤] B-roll video         ││                                                        │
│ MANAGE                    ││                                                        │
│  [▦] Library              ││                                                        │
│  [∿] Jobs      1 running  ││                                                        │
│  [▢] Chat                 ││                                                        │
│  [▤] B-roll library       ││                                                        │
│  [☆] Brand look           ││                                                        │
│ PUBLISH                   ││                                                        │
│  [➤] Posts  [⛓] Accounts  ││                                                        │
│  [ϟ] Automations          ││                                                        │
│  ───                      ││                                                        │
│  [▯] Guides  [≡] Settings ││                                                        │
│ ┌ running job card ─────┐ ││                                                        │
│ │● title · bar · step % │ ││                                                        │
│ └───────────────────────┘ ││                                                        │
│ ● Ready to clip           ││                                                        │
└───────────────────────────┘└────────────────────────────────────────────────────────┘
```

- **Sidebar** (`Sidebar.tsx`, `NAV_ITEMS`): groups Make, Manage, Publish, then Guides and Settings. Each item has a 26px icon tile tinted in its tool colour (solid when active, with a 3px bar at the sidebar edge). Jobs shows "N running" (or "N queued") and Chat "N waiting" in mono amber. It collapses to a 72px icon rail (group labels become hairlines, badges become dots, the running card becomes a progress ring); the toggle sits at the right of the logo row, the app icon is the toggle in the rail, and ⌘\ toggles it. The choice is remembered (`store/use-sidebar-store.ts`); windows narrower than 1024px always get the rail. The version line reads `v0.1.19 · ready` (or "setup needed", "checking", "check failed"). On macOS the traffic lights sit in a 32px strip above the logo (`trafficLightPosition` 16,12).
- **Top bar** (`TopBar.tsx`, 60px, `--shell-top`): a pasted video link (one or more) starts clips on Create with the link filled in; anything else searches the Library (handed over through `use-shell-store`). ⌘K focuses it. **Ask** (⌘J) opens Chat. The round chip opens Settings and shows the first connected account's initials when there is one. The strip is a window drag handle; its controls opt out with `.no-drag`.
- **Page header** (`PageHeader`): the tool chip, a large Space Grotesk title, a muted subtitle and right-aligned actions. Old `eyebrow="Studio"`/`"Workspace"` labels give way to the chip; any other eyebrow still shows.
- Pages scroll in `#page-scroll` below the top bar (top gap `--shell-gap`, 14px). Sticky elements use `top-0`. Wrap every page except Chat in `<Page width>`: `focus` 720, `narrow` 880, `default` 1280, `wide` 1680. Gutters are `px-4`, `sm:px-6`, `xl:px-8`.
- **Compact by default.** Panels pad `p-4` (`xl:p-5`), stacks use `space-y-3`/`gap-3`, sections `mt-4`/`mt-5`. Media grids use `repeat(auto-fill, minmax(…))`.
- **Create is a wizard**: Video → Format → Clips → Captions → Review, one compact panel per step under a clickable stepper, with Back/Next (and Generate) pinned to the bottom. Each new video starts with neither workflow selected. ⌘↵ generates from any step once a video and workflow are chosen. Step and draft live in `use-draft-store`.
- **Brand look** (`pages/BrandLookPage.tsx`) lists the brand identities Create, Remix and Avatar Studio pick from, with Add, Edit and Delete through `BrandIdentityDialog`.

---

### Editor surfaces

The editor uses scoped surface tokens in `components/clip-editor.css`: a near-black studio, the preview in a rounded panel with a soft radial glow, the transport and timeline in rounded `#0E1016` panels, and a quiet inspector column with pill tabs. Timeline rows sit in `.editor-lanes` with a mono uppercase label column (`--lane`) and share one time scale (an 8px inset, matching the range thumbs); a faint playhead crosses every row. Each row has its color: cuts white, Layouts by layout (`--layout-*`: full frame blue, split violet, fit cyan, screen orange, bubble pink), graphics by picker group (`--group-*`: Text lime, Lists & steps cyan, Diagrams green, Media orange, Ending pink), Stage scenes teal and Visual amber, caption-free sections amber, camera suggestions amber. Lime stays the selection/action accent. The Graphics picker groups templates as Text, Lists & steps, Diagrams, Media and Ending. The editor's height follows the frame (`100vh - --shell-top - --shell-gap`). Keep these colors scoped to the editor.

### Library

`pages/LibraryPage.tsx` is "Your clips": status tiles (Refining, Ready, Exported, Processing; counts from the read-only `library:summary` IPC and the job list) that filter the Clips view, then Runs (default), Clips and Ready to post. Cards are horizontal: a 9:16 thumbnail, a status pill (amber Refining/Editing, green Ready, periwinkle Exported, cyan Processing), title, source and a mono meta line, with bookmark and a ⋯ menu top right. The sidebar shows "N refining" on Library from the same summary.

Compact editor actions use `Button`’s `tooltip` prop for short explanations on hover or keyboard focus. Include shortcuts where useful. Tooltips reuse `HoverCard`, stay above clipped panels, and do not introduce extra keyboard stops around buttons. Custom-tooltip buttons and wrappers explicitly use an empty native `title` to prevent inherited browser tooltips.

## Components (`components/ui/`)

| Component | Notes |
| --- | --- |
| `Page` | Page column with width presets and the entry animation. |
| `PageHeader` | Tool chip (from Layout's `PageToolContext`), title, description, right-aligned actions; optional `leading` (back link) and a custom `eyebrow`. |
| `Panel` / `PanelHeader` | `glass rounded-2xl p-4`. The header takes an `icon` (an `IconTile`), a 15px Space Grotesk title, a description and an action. |
| `Button` | Rounded rectangles. `primary` (solid lime, dark ink, soft glow) · `secondary` (dark surface, hairline) · `ghost` · `danger`. Sizes `sm` 28px, `md` 32px, `lg` 40px. `iconOnly` (needs `aria-label`). `loading`, `tooltip`. Pressing scales to 0.97 unless reduced motion is on. |
| `TextInput` · `TextArea` | `glass-well`s with a lime border and 3px lime ring on focus. `TextInput` `sm` 28px, `md` 32px, `lg` 40px, with `leading`/`trailing` slots and `mono`. |
| `Select` | The app's dropdown (never a native `<select>`): a `glass-well` combobox that opens a `glass-thick` menu with a lime check on the chosen option. Keyboard: arrows, Home/End, Page Up/Down, type-ahead, Enter/Space, Escape. `MENU_SURFACE` and `menuOptionClass` style any other menu. |
| `Field` | Label, optional `aside` (e.g. "Get a key"), hint. |
| `Segmented` | Single choice in a dark rounded track; the chosen option is a raised `overlay` tile. Roving tab stop; exports `onRadioKeyDown`. |
| `SettingRow` | Title and description with a control on a `glass-tile`. `bare` drops the tile. |
| `Switch`, `Checkbox` | Solid lime with dark ink when on; the switch glows softly. The checkbox supports `indeterminate` and `variant="overlay"` for video. |
| `Badge`, `StatusDot` | Small rounded tags tinted by tone (`neutral` · `accent` · `success` · `warning` · `danger`); `accent` is a lime tint. Dots can pulse (not with reduced motion). |
| `IconTile` | A tinted tile holding an icon; `accent` takes the page's tool colour. Sizes `sm`–`xl`. |
| `Callout` | Tinted strip for errors, warnings, info and success, with optional title, action and dismiss. |
| `ProgressBar` / `ProgressRing` | Cyan → lime fill (red when failed) / lime stroke; no transition with reduced motion. |
| `EmptyState` | Card with a tool-coloured icon tile, a Space Grotesk title, one sentence and one action. |
| `Skeleton` | Flat loading block that pulses (still with reduced motion). |
| `HoverCard` | A read-only rich tooltip on a `glass-thick` card, as a top-layer popover. |
| `ActionMenu` | Keyboard-accessible "more" menu on `MENU_SURFACE`. |
| `Dialog` / `DialogFooter` | Dimmed, blurred backdrop and an 18px `glass-thick` card. Callers own focus trapping and Escape. |

Brand: the sidebar shows the app icon tile with the name in Space Grotesk. `components/brand/BridgeClipLogo` renders the CreatorClips lockup (`variant="lockup"`, size by height), the app-icon tile (`variant="icon"`) or the emblem alone (`variant="mark"`, for the icon rail). The emblem is a lime 9:16 frame with a play button on a near-black tile; the wordmark is Montserrat Black outlines with "Clips" in lime. All brand artwork is generated by `scripts/icon/build-creatorclips-brand.py` (`npm run icons`), which writes the SVGs in `resources/` and the PNG, ICO and ICNS app icons in `build/`. Edit the script, not the exports.

---

## Patterns

- **Option cards** (format, framing, caption style): `glass-tile glass-tile-hover` at rest, plus `glass-selected` when chosen. Visual tiles also get a check badge.
- **Chips** (clip length, job filters): small rounded tags. Chosen chips use the accent tint.
- **Media cards** (clips, runs): `glass` card with the media inset concentrically, and only a title and one line of metadata under it. Overlays are `glass-chip`s (no gradient scrims over media). The media is the play button. On hover the card lifts 2px, a frosted play lens appears, and the card's actions (post, add to automation, show in Finder) show as small frosted buttons on the media; selected cards get `shadow-accent-ring`. A run opens with a stats bar (`RunStats`): clips, processing time, API cost and when it was created. Numbers count up once, with one quiet line under each. When a run beat OpusClip, processing and cost say so in green ("5× faster than OpusClip", "94% less than OpusClip") and hovering shows a small card with OpusClip's logo, that one number and its basis. OpusClip's numbers live in `config/opus-clip.ts` (update them with their `checked` date); no claim is shown when the run didn't win.
- **Floating toolbars** (clip selection): `glass-thick` bar, sticky at `top-0 z-20`.
- **Caption previews** mirror the clipping engine presets in `engine/clip_engine/config.py` (colours, outline, glow, casing, spacing, box and karaoke effects). If a preset changes in the engine, update `CaptionPresetPicker.tsx`.
- **Library bookmarks**: use a dedicated Bookmarked group above Recent runs, reverting to All runs when empty. Keep cards in one keyed grid so moving between groups preserves thumbnail nodes and focus. Bookmark updates are optimistic and local; failed saves restore the prior state. Overlay pending bookmarks on Library reloads and discard stale reads when a mutation completes. Explicit refreshes retry previews without clearing healthy thumbnails; bookmark-only changes do not reload previews. Animate positions with `useLibraryMotion` instead of fading the grid. Respect reduced motion and keep unbookmarked runs in their original chronological order.
- **Autosave**: Settings has no Save button. Keys save 600ms after typing stops and on blur, and paths save on blur or Enter. A "Saved" pill confirms it in the header.
- **Long work**: clipping runs in the main process's job queue (`src/main/job-manager.ts`): up to `MAX_PARALLEL_JOBS` (2) run at once and the rest wait in FIFO order. The Jobs page shows Active jobs (a small progress ring or queue position, stage, elapsed time, cancel) above Previous jobs (run history on disk, one line each: status dot, title, clips, run time, cost, date; the row opens the run, and the folder button shows on hover). Opening a running job shows a compact Studio Timeline: every workflow stage has a progress bar, the active stage shows its current work, and a proportional time strip shows where processing time went. Unmeasured work stays indeterminate; older workers show an explicit measurement-unavailable state. Completed jobs open their clips; failures offer Run again. The sidebar shows a live count on Jobs and a card with the running jobs' progress.
- **Chat** (`pages/AssistantPage.tsx`) fills the page area instead of using `Page`, like a messaging app. A 248px **Chats** column (`components/assistant/ChatList.tsx`, flush with a hairline like the sidebar) lists recent chats grouped by day, each with its provider's logo, a spinner while it replies, an amber dot while it waits for approval, and a delete button on hover. It has a search field and a New chat button. Below 1024px the column folds into a history menu in the conversation header. A new chat is a centred hero: the chosen provider's logo, one question, the composer and starter chips (or a Connect card when nothing is connected). Once a chat starts, messages scroll in their own column (760px) above the composer, which docks to the bottom. User messages are right-aligned flat bubbles. Assistant replies open with the provider's logo tile and name plus the model that wrote that reply, then 14px body text. Runs of tool calls group into one `glass-tile` (spinner, check, cross or shield per row); three or more fold into one line once they've finished. Approval requests are `glass` cards with an amber rim, the details as plain lines, and one primary **Allow** beside a ghost **Don’t allow**. The composer is a `glass` card with an accent focus ring and a model chip (`ModelMenu`): a popover with a tab per provider (Claude, OpenAI, OpenRouter) under its logo, listing that provider's models as radios, with disconnected providers disabled and a Connect (or Add key) button. OpenRouter's tab is a search field over its tool-calling catalog, three suggestions first, with prices in Geist Mono. Replies render a small Markdown subset as React text, never HTML, and links are shown, not clickable.
- **Provider logos** (`components/brand/ProviderLogo.tsx`): Claude's spark in its own terracotta (`#D97757`), and OpenAI's blossom and OpenRouter's routing mark in `ink`, exactly as each company publishes them. They name whose model answers wherever the assistant appears (chat, model menu, Settings → Assistant). Use `variant="tile"` for a neutral glass lens and the bare glyph inline. Don't recolour them or use them for anything else.
- **Thumbnails** go through `lib/thumbnails.ts`, a one-at-a-time queue, because each one is a synchronous ffmpeg call in the main process.

---

## Motion

- Easing `ease-out` = `cubic-bezier(0.16, 1, 0.3, 1)`. `ease-spring` (slight overshoot) is only for the switch knob.
- Hover and state changes take 150–200ms. Pages enter with `animate-fade-in` (320ms, 6px rise), and dialogs with `animate-pop-in` (scale from 0.97).
- Motion communicates state: the pulsing ring on the active step, the skeleton pulse, the drop-zone scale. Nothing loops just to decorate.

---

## Accessibility

- A 2px lime focus ring (`:focus-visible`, offset 2px) appears on every control. Icon-only buttons carry `aria-label`.
- Radio-like groups use `role="radiogroup"`/`role="radio"` with `aria-checked` and a roving tab stop; toggles use `aria-pressed`; switches use `role="switch"`.
- Critical text is `ink` or `ink-muted`. `ink-subtle` is for secondary metadata only, and `ink-faint` is never for anything the user must read.
- Keyboard: ⌘1–⌘9, ⌘E, ⌘B, ⌘0 and ⌘, switch pages (⌘7 is Chat), ⌘K focuses the top bar, ⌘J opens Chat (Ask), ⌘\ collapses or expands the sidebar, and ⌘↵ generates clips (Ctrl on Windows and Linux).
- Motion respects `prefers-reduced-motion`: animations and transitions stop, pulses and press-scale are dropped.

---

## Adding UI

1. Reach for `components/ui/` first. If you're writing the same class string twice, it belongs there.
2. Pick a material for every surface (`glass`, `glass-tile`, `glass-well`, `glass-thick`, `glass-chip`). Don't use raw greys or new gradients.
3. Keep corners concentric: 10–12px controls, 16–18px cards.
4. Colour needs a reason: the one primary action (lime), the page's tool (`tool`), a chosen option, or status.
5. Give every async action a loading state, and every failure the real message and a next step.
