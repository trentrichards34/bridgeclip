/**
 * Effects: HyperFrames units (Apache-2.0, vendored in src/renderer/graphics/fx/vendor/) offered as one more graphic
 * template, `fx`, with the unit in `fields.effect` and its variables as the graphic's other fields. This catalog is
 * the contract for them: which units ship, the fields each takes (derived from its registry-item.json variables:
 * text, numbers, lists and choices), how they map back onto the unit's variables, what each one is for (jobs,
 * use_when, avoid_when), how long it typically holds and which sound fits it. The engine reads the same data from
 * engine/clip_engine/data/fx_catalog.json (written by scripts/export-fx-catalog.cjs, checked by a test).
 *
 * Words-said rule: every `said` field is text or a number the speaker says. Automatic placement (the engine's
 * words_said) checks exactly those; the member can type anything in the editor.
 */

export type FxFieldKind = 'text' | 'number' | 'list' | 'choice'
export interface FxField {
  /** The graphic's field (snake_case). */
  key: string
  /** The unit's variable it sets. */
  variable: string
  label: string
  kind: FxFieldKind
  /** Shown on screen: words or numbers the speaker must say when the planner places it. */
  said: boolean
  /** Lists: one item per line in the editor, joined with this for the unit. */
  separator?: string
  /** Choices: the unit's options. */
  options?: readonly { value: string; label: string }[]
  /** Needed for the effect to draw anything. */
  required?: boolean
  /** Longest a text holds (characters; lists: per item). */
  max?: number
  /** Sample words for the gallery's preview only (never put in a clip). */
  sample?: string
}
export type FxGroup = 'numbers' | 'words' | 'compare' | 'ideas' | 'screens' | 'ending'
export type FxSound = 'whoosh' | 'pop' | 'tick' | 'riser' | 'none'
export interface FxEffect {
  /** The unit's registry name (its vendored file). */
  id: string
  label: string
  detail: string
  group: FxGroup
  fields: readonly FxField[]
  /** Variables always passed: the accent rides the brand color, departures fade. */
  fixed?: Readonly<Record<string, string | number | boolean>>
  /** The planner's jobs (HyperFrames' vocabulary): prove, emphasize, reveal, compare, demonstrate, ask, texture… */
  jobs: readonly string[]
  use_when: string
  avoid_when: string
  /** How long it usually stays up (seconds). */
  hold_s: number
  /** The sound that fits its main beat. */
  sound: FxSound
  /** Its length when added (ms). */
  default_ms: number
  /** How big it starts. */
  size?: 'compact' | 'card' | 'stage'
  /** 'full': it draws over the whole frame (a texture or transition), not in a band. */
  frame?: 'band' | 'full'
  /** Widest shape it draws in (width / height of its box; default 2.4). */
  aspect?: number
  /** Drawn this much bigger than its box, around its center (units whose content sits small in their box). */
  scale?: number
  /** CSS custom properties set on the unit (its color variables: the runtime binds those as properties). */
  css?: Readonly<Record<string, string>>
  /** A soft dark glass behind it (bare type over busy video); the member can turn it off (`backing: none`). */
  backing?: 'glass'
  /**
   * Spoken timing: `field`'s words (or list items) as said become the unit's `variable` (comma seconds, its `cues`),
   * or, with no variable, the unit starts so that its main beat (`sync_s`) lands on the first one.
   */
  cue?: { field: string; unit: 'word' | 'item'; variable?: string }
  /** When the unit's main beat lands (seconds; its syncPoint). */
  sync_s?: number
}

const ACCENT = { accent: 'green' } as const
/** Units that can leave on their own leave upward, easing in (they don't just fade). */
const FADE = { exit: 'up' } as const
const choice = (key: string, variable: string, label: string, options: [string, string][]): FxField =>
  ({ key, variable, label, kind: 'choice', said: false, options: options.map(([value, l]) => ({ value, label: l })) })
const text = (key: string, variable: string, label: string, sample: string, extra: Partial<FxField> = {}): FxField =>
  ({ key, variable, label, kind: 'text', said: true, max: 80, sample, ...extra })
const num = (key: string, variable: string, label: string, sample: string, extra: Partial<FxField> = {}): FxField =>
  ({ key, variable, label, kind: 'number', said: true, sample, ...extra })
const list = (key: string, variable: string, label: string, sample: string, separator = ',', extra: Partial<FxField> = {}): FxField =>
  ({ key, variable, label, kind: 'list', said: true, separator, max: 40, sample, ...extra })

export const FX_EFFECTS: readonly FxEffect[] = [
  // Numbers and proof.
  { id: 'count-up', label: 'Count up', detail: 'A big number counts up and lands with a small pulse.', group: 'numbers',
    fields: [num('value', 'end', 'Number', '75', { required: true }), text('prefix', 'prefix', 'Before the number', '', { max: 6 }), text('suffix', 'suffix', 'After the number', '%', { max: 12 })],
    fixed: { ...ACCENT, ...FADE, start: 0 }, jobs: ['prove'], use_when: 'One number is the proof (users, revenue, a percent) and it should land as it is said.',
    avoid_when: 'The number needs context or a comparison; a lone number reads hollow (use a chart).', hold_s: 3, sound: 'tick', default_ms: 3500, backing: 'glass', aspect: 2.2,
    cue: { field: 'value', unit: 'word' }, sync_s: 1.72 },
  { id: 'number-pop-in', label: 'Number pop', detail: 'A short number pops in digit by digit with a small unit.', group: 'numbers',
    fields: [text('value', 'value', 'Number', '10', { required: true, max: 10 }), text('unit', 'unit', 'Unit', 'x', { max: 8 })],
    fixed: { tone: 'accent' }, jobs: ['prove', 'emphasize'], use_when: 'A short figure ("10x", "3k", "24h") is the punchline of the sentence.',
    avoid_when: 'The number is long or needs a label to make sense.', hold_s: 2, sound: 'pop', scale: 2.4, default_ms: 2500, backing: 'glass', aspect: 2,
    cue: { field: 'value', unit: 'word' }, sync_s: .4 },
  { id: 'conic-progress-ring', label: 'Progress ring', detail: 'A ring fills to a percent with the number in the middle.', group: 'numbers',
    fields: [num('progress', 'progress', 'Percent (0 to 100)', '80', { required: true }), text('label', 'label', 'Words in the ring', '80%', { max: 8 })],
    jobs: ['prove', 'demonstrate'], use_when: 'A share or completion rate is said ("80% of people…").', avoid_when: 'The number is not a percent of something.',
    hold_s: 3, sound: 'riser', default_ms: 3500, aspect: 1.6, cue: { field: 'progress', unit: 'word' }, sync_s: 1.2 },
  { id: 'star-rating-fill', label: 'Star rating', detail: 'Stars fill to a rating, with the score beside them.', group: 'numbers',
    fields: [num('rating', 'rating', 'Rating (0 to 5)', '4.8', { required: true })], fixed: { starCount: 5, showValue: 'yes' },
    jobs: ['prove'], use_when: 'A real rating is said ("rated 4.9 stars").', avoid_when: 'There is no rating said; never invent one.',
    hold_s: 2.5, sound: 'tick', default_ms: 3000, aspect: 2.6, cue: { field: 'rating', unit: 'word' }, sync_s: 1.3 },
  { id: 'chart-story', label: 'Chart', detail: 'Bars, a line or a donut build from the numbers said, one stands out.', group: 'numbers',
    fields: [list('data', 'data', 'Numbers (one per line)', '12\n28\n45\n64', ',', { required: true, max: 12 }), list('labels', 'labels', 'Labels (one per line)', 'Q1\nQ2\nQ3\nQ4', ',', { max: 14 }),
      num('emphasize', 'emphasize', 'Which one stands out (1 = first)', '4', { said: false }), text('unit', 'unit', 'Unit', '%', { max: 6 }),
      choice('type', 'type', 'Chart', [['bars', 'Bars'], ['line', 'Line'], ['donut', 'Donut'], ['progress', 'Progress bars']])],
    fixed: { ...ACCENT, ...FADE }, jobs: ['prove'], use_when: 'Several numbers are said as a trend or comparison and one carries the story.',
    avoid_when: 'Only one number is said (use Count up).', hold_s: 4.5, sound: 'riser', default_ms: 5000, size: 'stage', aspect: 1.5, sync_s: 3.05 },
  { id: 'decline-chart', label: 'Drop chart', detail: 'A line falls from one number to another, the drop marked.', group: 'numbers',
    fields: [text('label', 'label', 'What fell', 'Your metric', { max: 30 }), num('start', 'start_value', 'From', '82', { required: true }), num('end', 'end_value', 'To', '34', { required: true })],
    jobs: ['agitate'], use_when: 'A loss is said with both numbers ("from 82 down to 34").', avoid_when: 'The numbers go up (use Chart).',
    hold_s: 3.5, sound: 'whoosh', default_ms: 4000, aspect: 1.8 },
  { id: 'trust-strip', label: 'Name row', detail: 'A calm row of names (clients, places, tools) fades in left to right.', group: 'numbers',
    fields: [list('marks', 'marks', 'Names (one per line, up to 6)', 'First name\nSecond name\nThird name', ',', { required: true, max: 20 })],
    fixed: { ...ACCENT, ...FADE, tone: 'ink' }, jobs: ['prove'], use_when: 'The speaker names who they worked with or where they were featured.',
    avoid_when: 'The names are not said; never list logos or names that were not.', hold_s: 3, sound: 'none', default_ms: 3500, aspect: 3, scale: 2,
    cue: { field: 'marks', unit: 'item', variable: 'cues' }, sync_s: 1.3 },
  // Words.
  { id: 'headline-slam', label: 'Headline slam', detail: 'A short line slams in, one word in your color.', group: 'words',
    fields: [text('text', 'text', 'Words', 'Your big line', { required: true, max: 40 }), num('accent_word', 'accent_word_index', 'Word in color (1 = first)', '2', { said: false })],
    fixed: { ...ACCENT, shadow: true }, jobs: ['emphasize'], use_when: 'A short claim (2 to 5 words) is the line to remember.', avoid_when: 'The line is long or needs to build word by word.',
    hold_s: 2, sound: 'whoosh', scale: 1.5, default_ms: 2500, aspect: 2.6, cue: { field: 'text', unit: 'word' }, sync_s: .58 },
  { id: 'per-word-rise', label: 'Word rise', detail: 'Each word rises into place as you say it.', group: 'words',
    fields: [text('text', 'text', 'Words', 'Words as you say them', { required: true, max: 60 }), choice('split', 'split', 'Rises by', [['word', 'Word'], ['char', 'Letter']])],
    fixed: { ...ACCENT, ...FADE }, jobs: ['reveal'], use_when: 'A key line should land word by word, in time with the voice.', avoid_when: 'The line swaps one word for another (use Word swap).',
    hold_s: 3, sound: 'none', scale: 1.15, default_ms: 3000, backing: 'glass', aspect: 2.6, cue: { field: 'text', unit: 'word', variable: 'cues' } },
  { id: 'kinetic-type-swap', label: 'Word swap', detail: 'One word in a line rolls through options and lands on the last.', group: 'words',
    fields: [text('prefix', 'prefix', 'Words before', 'Make it', { max: 30 }), list('options', 'options', 'Words that swap (one per line, last stays)', 'faster\nsimpler\nyours', ',', { required: true, max: 20 }),
      text('suffix', 'suffix', 'Words after', '', { max: 30 })],
    fixed: { ...ACCENT, ...FADE }, jobs: ['reveal'], use_when: 'One sentence lists alternatives for one slot ("faster, cheaper, better").',
    avoid_when: 'The words differ a lot in length, or there are more than four.', hold_s: 3, sound: 'tick', default_ms: 3500, backing: 'glass', aspect: 2.6,
    cue: { field: 'options', unit: 'item', variable: 'cues' } },
  { id: 'text-stagger', label: 'Blur in', detail: 'Words sharpen in from a soft blur, one after another.', group: 'words',
    fields: [text('text', 'text', 'Words', 'Your words here', { required: true, max: 50 })], fixed: { tone: 'paper', accent: 'green', size: 112 },
    jobs: ['reveal'], use_when: 'A calm line or a title for a section.', avoid_when: 'The moment needs energy (use Headline slam).',
    hold_s: 2.5, sound: 'none', default_ms: 3000, backing: 'glass', aspect: 2.6 },
  { id: 'line-swap', label: 'Line swap', detail: 'One line exits up as the answer slides in, a word underlined.', group: 'words',
    fields: [text('first', 'line_a', 'First line', 'What everyone says', { required: true, max: 50 }), text('second', 'line_b', 'Second line', 'What actually works', { required: true, max: 50 }),
      text('underline', 'underline_word', 'Word to underline (from the second line)', 'works', { max: 20 })],
    fixed: { ...ACCENT, ...FADE }, jobs: ['emphasize'], use_when: 'A setup line is answered by a second line ("Everyone says X. The truth is Y.").',
    avoid_when: 'There is only one line.', hold_s: 3.5, sound: 'whoosh', default_ms: 4000, backing: 'glass', aspect: 2.8, cue: { field: 'second', unit: 'word' }, sync_s: 1.5 },
  { id: 'caret-swap', label: 'Caret retype', detail: 'A caret wipes one phrase away and types the replacement.', group: 'words',
    fields: [text('from', 'from_text', 'Phrase that goes', 'The old way', { required: true, max: 40 }), text('to', 'to_text', 'Phrase typed in', 'The new way', { required: true, max: 40 })],
    fixed: { color: '#F8FAFC', font_weight: '600' }, css: { '--color': 'var(--fg)', '--caret_color': 'var(--brand)', '--caret_color_end': 'var(--accent-2)' }, jobs: ['emphasize'], use_when: 'The speaker corrects or reframes a phrase ("not X, it\'s Y").', avoid_when: 'The phrases are long.',
    hold_s: 3, sound: 'tick', default_ms: 3500, backing: 'glass', aspect: 2.8 },
  { id: 'scramble-reveal', label: 'Scramble', detail: 'Letters scramble and lock into a word, left to right.', group: 'words',
    fields: [text('text', 'text', 'Word or name', 'YOUR WORD', { required: true, max: 20 }), choice('style', 'style', 'Look', [['clean', 'Clean'], ['terminal', 'Terminal']])],
    fixed: { ...ACCENT, ...FADE }, jobs: ['reveal'], use_when: 'A product, tool or technical term is named.', avoid_when: 'The tone is calm or premium.',
    hold_s: 2.5, sound: 'tick', default_ms: 3000, backing: 'glass', aspect: 2.6, cue: { field: 'text', unit: 'word' }, sync_s: 1.5 },
  { id: 'text-shimmer', label: 'Shimmer', detail: 'A word catches one clean light sweep.', group: 'words',
    fields: [text('text', 'text', 'Word', 'Effortless', { required: true, max: 24 })], fixed: ACCENT,
    jobs: ['emphasize'], use_when: 'One quality word should feel premium ("effortless", "simple").', avoid_when: 'More than a few words.',
    hold_s: 2.5, sound: 'whoosh', default_ms: 3000, backing: 'glass', aspect: 2.6 },
  { id: 'titlecard-lockup', label: 'Title card', detail: 'A calm centered title with a small line above and below.', group: 'words',
    fields: [text('title', 'wordmark', 'Title', 'YOUR TITLE', { required: true, max: 24 }), text('kicker', 'kicker', 'Small line above', 'PART ONE', { max: 30 }), text('label', 'label', 'Small line below', '', { max: 40 })],
    fixed: { ...ACCENT, ...FADE, rule: 'show' }, jobs: ['orient'], use_when: 'A new section starts, or a name is introduced, and a calm beat fits.',
    avoid_when: 'The moment needs energy.', hold_s: 3, sound: 'none', default_ms: 3500, backing: 'glass', aspect: 2.4, sync_s: 1.8 },
  { id: 'char-slam-explode', label: 'Letter slam', detail: 'Scattered letters slam together into one word.', group: 'words',
    fields: [text('text', 'text', 'Word', 'Impact', { required: true, max: 14 }), choice('spread', 'spread', 'Scatter', [['tight', 'Tight'], ['wild', 'Wild']])],
    fixed: ACCENT, jobs: ['emphasize'], use_when: 'One word should hit hard ("Done.", "Never.").', avoid_when: 'More than one word.',
    hold_s: 2, sound: 'whoosh', default_ms: 2500, backing: 'glass', aspect: 2.6, cue: { field: 'text', unit: 'word' }, sync_s: 1.52 },
  { id: 'stitched-text-draw', label: 'Stitched word', detail: 'A word is stitched in thread, stroke by stroke.', group: 'words',
    fields: [text('text', 'text', 'Word', 'HANDMADE', { required: true, max: 12 })], fixed: { ...ACCENT, ...FADE },
    jobs: ['reveal'], use_when: 'A crafted, handmade or personal word.', avoid_when: 'The word is long or the tone is techy.',
    hold_s: 3.5, sound: 'none', default_ms: 4000, backing: 'glass', aspect: 2.6 },
  { id: 'marker-highlight', label: 'Marker', detail: 'A line with one word highlighted, circled or underlined by marker.', group: 'words',
    fields: [text('text', 'text', 'Line', 'This is the part that matters', { required: true, max: 60 }), text('word', 'emphasis_word', 'Word to mark (from the line)', 'matters', { required: true, max: 24 }),
      choice('style', 'style', 'Mark', [['highlight', 'Highlight'], ['circle', 'Circle'], ['underline', 'Underline'], ['scribble', 'Scribble']])],
    fixed: { ...ACCENT, ...FADE }, jobs: ['emphasize'], use_when: 'A line has one word that carries it.', avoid_when: 'Every word matters equally.',
    hold_s: 3, sound: 'none', scale: 1.2, default_ms: 3500, backing: 'glass', aspect: 2.6, cue: { field: 'word', unit: 'word' }, sync_s: .9 },
  { id: 'vox-annotate', label: 'Annotate', detail: 'A word in a line is marked, with a short note drawn beside it.', group: 'words',
    fields: [text('text', 'text', 'Line', 'Tell the story not the spec', { required: true, max: 50 }), text('word', 'keyword', 'Word to mark', 'story', { required: true, max: 20 }),
      text('note', 'note', 'Note', 'the part people remember', { max: 30 }),
      choice('style', 'style', 'Mark', [['highlight', 'Highlight'], ['circle', 'Circle'], ['underline', 'Underline'], ['scribble', 'Scribble']])],
    fixed: { ...ACCENT, ...FADE }, jobs: ['emphasize'], use_when: 'A phrase needs an aside or a short explanation.', avoid_when: 'Plain emphasis is enough (use Marker).',
    hold_s: 3.5, sound: 'none', default_ms: 4000, backing: 'glass', aspect: 2.4, cue: { field: 'word', unit: 'word' }, sync_s: .9 },
  { id: 'kinetic-center-build', label: 'Word push', detail: 'Words arrive from the right and push the line until it locks in the center.', group: 'words',
    fields: [text('text', 'text', 'Words', 'Say it once', { required: true, max: 40 })], fixed: { font_size: 84, font_weight: '700', entry_offset: 88 },
    css: { '--color': 'var(--fg)' }, jobs: ['reveal'], use_when: 'A short line builds word by word with momentum.', avoid_when: 'The line is long (over six words).',
    hold_s: 2.5, sound: 'whoosh', default_ms: 3000, backing: 'glass', aspect: 2.6, sync_s: 1.2 },
  { id: 'wordmark-tiles', label: 'Tile word', detail: 'A word resolves from colored noise into clean tiles.', group: 'words',
    fields: [text('text', 'text', 'Word', 'LAUNCH', { required: true, max: 12 })], fixed: { columns: 12, waveStagger: 40 },
    jobs: ['reveal'], use_when: 'A launch, a name or a big reveal word.', avoid_when: 'More than one word.',
    hold_s: 2.5, sound: 'riser', default_ms: 3000, aspect: 2.6, sync_s: .2 },
  { id: 'ticker-takeover', label: 'Ticker', detail: 'A ticker rolls through words and locks on one with a flash.', group: 'words',
    fields: [list('options', 'options', 'Words that roll (one per line)', 'faster\nsimpler\ncheaper', ',', { required: true, max: 16 }), text('final', 'final_word', 'Word it lands on', 'better', { required: true, max: 16 })],
    fixed: ACCENT, jobs: ['reveal'], use_when: 'Several options are rattled off and one wins.', avoid_when: 'Only one word is said.',
    hold_s: 3, sound: 'tick', default_ms: 3500, backing: 'glass', aspect: 2.6, cue: { field: 'final', unit: 'word' } },
  { id: 'typed-prompt', label: 'Typed line', detail: 'A line types out in a prompt box with a caret.', group: 'words',
    fields: [text('text', 'text', 'Line', 'Type what you would ask', { required: true, max: 60 })], fixed: { ...ACCENT, ...FADE, cadence: 'human', caret: 'blink', prompt_glyph: '>' },
    jobs: ['demonstrate'], use_when: 'The speaker says what they typed or asked a tool.', avoid_when: 'It is not something typed.',
    hold_s: 3.5, sound: 'tick', scale: 1.3, default_ms: 4000, aspect: 3, sync_s: 2.9 },
  { id: 'strikethrough-replace', label: 'Strike & replace', detail: 'One word is struck out and a better one rises beside it.', group: 'compare',
    fields: [text('before', 'before', 'Word struck out', 'Slow', { required: true, max: 20 }), text('after', 'after', 'Better word', 'Fast', { required: true, max: 20 })],
    fixed: { tint: 'red', tone: 'paper', thickness: 'standard', origin: 'left' }, jobs: ['compare'], use_when: 'One word replaces another ("not hard, simple").',
    avoid_when: 'Whole sentences (use Line swap).', hold_s: 2.5, sound: 'whoosh', scale: 2.4, default_ms: 3000, backing: 'glass', aspect: 2.2, cue: { field: 'after', unit: 'word' }, sync_s: .84 },
  // Ideas and lists.
  { id: 'marker-checklist-card', label: 'Marker checklist', detail: 'A hand-marked title with three ticked lines.', group: 'ideas',
    fields: [text('top', 'top', 'Title, first line', 'THE POWER', { required: true, max: 18 }), text('mid', 'mid', 'Title, small word', 'OF', { max: 6 }), text('circled', 'circled', 'Circled word', 'ONE', { required: true, max: 10 }),
      text('rest', 'rest', 'Title, last word', 'IDEA', { max: 12 }), text('line_one', 'l1', 'Line 1', 'WRITE', { required: true, max: 12 }), text('answer_one', 'v1', 'Line 1 answer', 'IT DOWN', { required: true, max: 14 }),
      text('line_two', 'l2', 'Line 2', 'SAY', { max: 12 }), text('answer_two', 'v2', 'Line 2 answer', 'IT OUT LOUD', { max: 14 }), text('line_three', 'l3', 'Line 3', 'DO', { max: 12 }), text('answer_three', 'v3', 'Line 3 answer', 'IT TODAY', { max: 14 })],
    jobs: ['exhibit'], use_when: 'A short framework is said: a title and three short steps.', avoid_when: 'The steps are long sentences.',
    hold_s: 5, sound: 'tick', default_ms: 6000, size: 'stage', aspect: 1.1 },
  { id: 'constellation-hub', label: 'Hub', detail: 'A center word with ideas that light up around it as you say them.', group: 'ideas',
    fields: [text('hub', 'hub_label', 'Center', 'Your idea', { required: true, max: 18 }), list('nodes', 'nodes', 'Around it (one per line, up to 6)', 'Plan\nMake\nShare\nLearn', ',', { required: true, max: 16 })],
    fixed: { ...ACCENT, ...FADE }, jobs: ['exhibit'], use_when: 'Several parts of one idea are named.', avoid_when: 'The parts are steps in order (use Staircase).',
    hold_s: 5, sound: 'pop', default_ms: 5500, size: 'stage', aspect: 1.4, cue: { field: 'nodes', unit: 'item', variable: 'cues' } },
  { id: 'locked-nucleus-orbit', label: 'Core orbit', detail: 'Small dots orbit one locked center word.', group: 'ideas',
    fields: [text('label', 'label', 'Center word', 'core', { required: true, max: 14 })], fixed: { ...ACCENT, satellites: 4 },
    jobs: ['reveal'], use_when: 'One central idea everything else turns around.', avoid_when: 'The things around it need names (use Hub).',
    hold_s: 3.5, sound: 'riser', scale: 1.7, default_ms: 4000, aspect: 1.6 },
  { id: 'radial-surround', label: 'Surrounded', detail: 'Labels ring a center word, then close in on it.', group: 'ideas',
    fields: [text('center', 'center_label', 'Center', 'You', { required: true, max: 16 }), list('chips', 'chips', 'Around it (one per line, up to 8)', 'Email\nCalls\nMeetings\nChats\nTasks\nAlerts', ',', { required: true, max: 14 })],
    fixed: { ...ACCENT, ...FADE, close_in: true }, jobs: ['agitate'], use_when: 'The speaker lists what piles up on someone ("emails, calls, meetings…").',
    avoid_when: 'The list is a set of good options.', hold_s: 5, sound: 'riser', scale: 1.35, default_ms: 5500, size: 'stage', aspect: 1.4, cue: { field: 'chips', unit: 'item', variable: 'cues' } },
  { id: 'overwhelm-surround', label: 'Overwhelm', detail: 'Pings and tabs swarm in around one calm center word.', group: 'ideas',
    fields: [text('center', 'centerLabel', 'Center word', 'You', { required: true, max: 14 })], fixed: { count: 16, intensity: 1 },
    jobs: ['agitate'], use_when: 'The speaker describes being overwhelmed or pulled in every direction.', avoid_when: 'The things around need names (use Surrounded).',
    hold_s: 4, sound: 'riser', default_ms: 4500, size: 'stage', aspect: 1.4 },
  { id: 'state-chip-rail', label: 'Status rail', detail: 'A row of steps that light up one after another.', group: 'ideas',
    fields: [list('states', 'states', 'Steps (one per line, up to 5)', 'Plan\nBuild\nLaunch', ',', { required: true, max: 14 })],
    fixed: { ...ACCENT, ...FADE, badge_state: 1, badges: '' }, jobs: ['demonstrate'], use_when: 'A short process is said step by step.', avoid_when: 'More than five steps.',
    hold_s: 4, sound: 'tick', scale: 2.2, default_ms: 4500, aspect: 3.2, cue: { field: 'states', unit: 'item', variable: 'times' } },
  { id: 'whiteboard-ink', label: 'Sketch', detail: 'A light bulb, flow or rocket sketches itself with a caption.', group: 'ideas',
    fields: [text('caption', 'caption', 'Caption', 'Draw the idea', { max: 30 }), choice('sketch', 'sketch', 'Sketch', [['bulb', 'Light bulb'], ['flow', 'Flow'], ['rocket', 'Rocket']])],
    fixed: { ...ACCENT, ...FADE, pen: 'show' }, jobs: ['reveal'], use_when: 'An idea, a plan or a launch is explained.', avoid_when: 'None of the three sketches fits.',
    hold_s: 4, sound: 'none', default_ms: 4500, size: 'stage', aspect: 1.4, sync_s: 3.3 },
  // Screens and messages.
  { id: 'typing-indicator', label: 'Typing dots', detail: 'A chat bubble with three typing dots.', group: 'screens',
    fields: [choice('tone', 'tone', 'Bubble', [['dark', 'Dark'], ['light', 'Light']])], fixed: { tail: 'on' },
    jobs: ['demonstrate'], use_when: 'A beat of suspense: someone is about to reply.', avoid_when: 'Nothing is being typed or answered.',
    hold_s: 2, sound: 'tick', scale: 2.4, default_ms: 2500, size: 'compact', aspect: 2 },
  { id: 'notification-stack', label: 'Notifications', detail: 'Notification cards stack up as you say them.', group: 'screens',
    fields: [list('titles', 'titles', 'Titles (one per line, up to 4)', 'New order\nPayment received\nNew subscriber', ',', { required: true, max: 30 }),
      list('bodies', 'bodies', 'Small lines (one per line)', '', ',', { max: 40 })],
    fixed: { ...ACCENT, ...FADE, expand: -1 }, jobs: ['demonstrate'], use_when: 'Alerts or results arriving are described ("sale, sale, another sale").',
    avoid_when: 'Nothing arrives.', hold_s: 4, sound: 'pop', scale: 1.5, default_ms: 4500, size: 'stage', aspect: 1.2, cue: { field: 'titles', unit: 'item', variable: 'cues' } },
  // Proof.
  { id: 'testimonial-card', label: 'Testimonial', detail: 'A quote card with who said it and their stars.', group: 'numbers',
    fields: [text('quote', 'quote', 'Quote (as said)', 'This changed how I work.', { required: true, max: 90 }), text('author', 'author', 'Who said it', 'Their name', { max: 30 }),
      text('handle', 'handle', 'Their handle or role', '', { max: 30 }), num('rating', 'rating', 'Stars (0 to 5)', '5')],
    fixed: { rating: 0 }, jobs: ['prove'], use_when: 'The speaker reads out a real customer\'s words.', avoid_when: 'The words were not said; never make a testimonial up.',
    hold_s: 4.5, sound: 'pop', scale: 1.5, default_ms: 5000, aspect: 2, sync_s: .82 },
  { id: 'testimonial-proof-card', label: 'Quote card', detail: 'A quote reveals line by line, a phrase underlined, with who said it.', group: 'numbers',
    fields: [text('quote', 'quote', 'Quote (as said)', 'I finally got my first ten clients', { required: true, max: 90 }), text('name', 'name', 'Who said it', 'Their name', { max: 30 }),
      text('role', 'role', 'Their role', '', { max: 30 }), text('company', 'company', 'Company', '', { max: 24 }), text('emphasis', 'emphasis', 'Phrase to underline (from the quote)', 'first ten clients', { max: 30 })],
    fixed: { ...ACCENT, ...FADE }, jobs: ['prove'], use_when: 'A real customer quote is read out.', avoid_when: 'The words were not said; never make one up.',
    hold_s: 5, sound: 'none', scale: 1.4, default_ms: 5500, aspect: 1.9, sync_s: 1.6 },
  // Ending.
  { id: 'cta-close', label: 'Closing ask', detail: 'One line and a button, the last thing on screen.', group: 'ending',
    fields: [text('line', 'action_line', 'Line', 'Make it happen', { required: true, max: 40 }), text('button', 'button_label', 'Button', 'Start now', { required: true, max: 24 })],
    fixed: { ...ACCENT, ...FADE }, jobs: ['ask'], use_when: 'The video ends on an ask ("start today", "join now").', avoid_when: 'It is not the end.',
    hold_s: 3, sound: 'pop', default_ms: 3500, backing: 'glass', aspect: 2.2, cue: { field: 'button', unit: 'word' }, sync_s: 1.32 },
  { id: 'cta-lockup', label: 'Ask lockup', detail: 'A line, a button and a small line under it.', group: 'ending',
    fields: [text('line', 'action_line', 'Line', 'Start building today', { required: true, max: 40 }), text('button', 'button_label', 'Button', 'Get the guide', { required: true, max: 24 }),
      text('small', 'microcopy', 'Small line', 'Link in bio', { max: 30 })],
    fixed: ACCENT, jobs: ['ask'], use_when: 'An ask with a detail ("free", "link in bio").', avoid_when: 'It is not the end.',
    hold_s: 3.5, sound: 'pop', default_ms: 4000, backing: 'glass', aspect: 2.2, sync_s: 1.6 },
  { id: 'gloss-sweep', label: 'Gloss badge', detail: 'A short badge slams in and catches a gloss.', group: 'ending',
    fields: [text('text', 'text', 'Badge', 'Pro', { required: true, max: 14 })], fixed: ACCENT,
    jobs: ['celebrate'], use_when: 'A win or a level is named ("Pro", "Done", "Free").', avoid_when: 'More than two words.',
    hold_s: 2, sound: 'whoosh', scale: 1.4, default_ms: 2500, size: 'compact', aspect: 2, sync_s: 1.35 },
  { id: 'spring-pop', label: 'Badge pop', detail: 'A small badge pops in and settles.', group: 'ending',
    fields: [text('text', 'text', 'Badge', 'New', { required: true, max: 14 })], fixed: { overshoot: 1.2, fromScale: .9 },
    jobs: ['reveal'], use_when: 'A short label appears ("New", "Free", "Step 1").', avoid_when: 'More than two words.',
    hold_s: 2, sound: 'pop', scale: 2, default_ms: 2500, size: 'compact', aspect: 2, sync_s: .6 }
]

export const FX_EFFECT_IDS: readonly string[] = FX_EFFECTS.map((e) => e.id)
export const FX_GROUPS: { id: FxGroup; label: string }[] = [
  { id: 'numbers', label: 'Effects: numbers & proof' }, { id: 'words', label: 'Effects: words' }, { id: 'compare', label: 'Effects: compare' },
  { id: 'ideas', label: 'Effects: ideas & steps' }, { id: 'screens', label: 'Effects: screens & messages' }, { id: 'ending', label: 'Effects: badges & asks' }
]
/** Fields every effect graphic may carry besides its own: the effect, its backing, spoken cue times. */
export const FX_COMMON_FIELDS = ['effect', 'backing', 'cue_ms'] as const

export function fxEffect(id: string | undefined): FxEffect | null {
  return FX_EFFECTS.find((e) => e.id === id) ?? null
}
const clean = (t: string | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim()
/** A list field's items (one per line). */
export function fxItems(value: string | undefined): string[] {
  return (value ?? '').split(/\r?\n/).map(clean).filter(Boolean).slice(0, 8)
}
/** A number field's value, or null. */
export function fxNumber(value: string | undefined): number | null {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(value ?? '')
  if (!m) return null
  const n = Number(m[0].replaceAll(',', ''))
  return Number.isFinite(n) ? n : null
}

/** True when the effect is known and its required fields are filled. */
export function fxHasContent(fields: Record<string, string>): boolean {
  const effect = fxEffect(fields.effect)
  if (!effect) return false
  return effect.fields.every((f) => !f.required || (f.kind === 'number' ? fxNumber(fields[f.key]) !== null : f.kind === 'list' ? fxItems(fields[f.key]).length > 0 : !!clean(fields[f.key])))
}

/** The fields that show words or numbers the speaker must say (the words-said rule). */
export function fxSaidFields(effect: FxEffect): string[] {
  return effect.fields.filter((f) => f.said).map((f) => f.key)
}

/** The effect's words as one line (switching to another template keeps them). */
export function fxLine(fields: Record<string, string>): string {
  const effect = fxEffect(fields.effect)
  if (!effect) return ''
  const first = effect.fields.find((f) => f.said && f.kind !== 'number' && clean(fields[f.key]))
  return first ? (first.kind === 'list' ? fxItems(fields[first.key]).join(' ') : clean(fields[first.key])) : ''
}

/** The words (or items) the effect is timed to, in order, from its cue field. */
export function fxCueUnits(effect: FxEffect, fields: Record<string, string>): string[] {
  if (!effect.cue) return []
  const value = fields[effect.cue.field]
  if (effect.cue.unit === 'item') return fxItems(value)
  const words = clean(value).split(' ').filter(Boolean)
  // Without a cues variable only the first word matters (the beat lands on it).
  return effect.cue.variable ? words : words.slice(0, 1)
}

export interface FxTiming {
  /** The unit starts this far into the graphic (its beat lands on the spoken word). */
  lead_ms: number
  /** The unit's own length (the graphic's, less the lead). */
  unit_ms: number
  /** Seconds into the unit for each cue, for a unit with a cues variable; null without. */
  cues: number[] | null
}

/** When the unit starts and its cues, from the graphic's spoken times (`cue_ms`, output ms from its start). */
export function fxTiming(effect: FxEffect, fields: Record<string, string>, durationMs: number): FxTiming {
  const times = (fields.cue_ms ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
  const ok = times.length > 0 && times.every((t, i) => Number.isFinite(t) && t >= 0 && t <= durationMs && (i === 0 || t >= times[i - 1]))
  if (!ok || !effect.cue) return { lead_ms: 0, unit_ms: durationMs, cues: null }
  if (effect.cue.variable) return { lead_ms: 0, unit_ms: durationMs, cues: times.map((t) => Math.round(t) / 1000) }
  // The beat lands on the first cue: start the unit that much later (keeping at least 1.2 s for it).
  const lead = Math.max(0, Math.min(durationMs - 1200, times[0] - (effect.sync_s ?? 0) * 1000))
  return { lead_ms: Math.round(lead), unit_ms: Math.round(durationMs - lead), cues: null }
}

/** The unit's variables from the graphic's fields (unknown or empty ones fall back to the unit's own defaults). */
export function fxVariables(effect: FxEffect, fields: Record<string, string>, timing?: FxTiming): Record<string, string | number | boolean> {
  const vars: Record<string, string | number | boolean> = { ...(effect.fixed ?? {}) }
  for (const f of effect.fields) {
    const raw = fields[f.key]
    // Words left empty stay empty: a unit's own sample words (its defaults) never show. Units read a blank value as
    // "use my default", so an empty text is a zero-width space and an empty list a lone separator (empty items).
    if (f.said && (f.kind === 'text' || f.kind === 'list') && !clean(raw)) { vars[f.variable] = f.kind === 'list' ? (f.separator ?? ',') : '\u200B'; continue }
    if (raw === undefined) continue
    if (f.kind === 'number') { const n = fxNumber(raw); if (n !== null) vars[f.variable] = n }
    else if (f.kind === 'choice') { if (f.options?.some((o) => o.value === raw)) vars[f.variable] = raw }
    else if (f.kind === 'list') {
      const items = fxItems(raw).map((i) => i.replaceAll(f.separator ?? ',', ' ').slice(0, f.max ?? 40))
      if (items.length) vars[f.variable] = items.join(f.separator ?? ',')
    } else vars[f.variable] = clean(raw).slice(0, f.max ?? 80)
  }
  if (timing?.cues && effect.cue?.variable) vars[effect.cue.variable] = timing.cues.map((t) => t.toFixed(2)).join(',')
  return vars
}

/** Everything the engine's planner (and any later director) needs, as plain JSON. */
export function fxCatalogJson(): { version: 1; effects: Record<string, unknown>[] } {
  return {
    version: 1,
    effects: FX_EFFECTS.map((e) => ({
      id: e.id, label: e.label, detail: e.detail, group: e.group, jobs: e.jobs, use_when: e.use_when, avoid_when: e.avoid_when,
      hold_s: e.hold_s, sound: e.sound, default_ms: e.default_ms, size: e.size ?? 'card', frame: e.frame ?? 'band', ...(e.sync_s !== undefined ? { sync_s: e.sync_s } : {}),
      ...(e.cue ? { cue: { field: e.cue.field, unit: e.cue.unit } } : {}),
      fields: e.fields.map((f) => ({ key: f.key, kind: f.kind, said: f.said, required: !!f.required, ...(f.max ? { max: f.max } : {}), ...(f.options ? { options: f.options.map((o) => o.value) } : {}) }))
    }))
  }
}
