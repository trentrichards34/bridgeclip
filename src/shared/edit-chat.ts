/**
 * Edit my recording's Chat panel: the member asks for a change to the reviewed
 * edit in plain words ("remove the second retake", "start with the line about
 * pricing", "add a stat graphic when I say 40%"); the model calls these tools.
 * Main checks every call against a copy of the review's choices (an invalid
 * call goes back to the model as an error); the page applies the returned
 * steps through the review's own setters with `mergeEditChatSteps`, which
 * checks them again like Make my reel does. Words are referred to by their
 * index in the plan's transcript.
 */
import { CAPTION_PRESET_IDS, isCaptionPresetId } from './caption-presets'
import { ChatToolError, chatFail as fail, chatPlainText, chatReason, chatSentence, chatText, parseStepsLoose, type ChatReplyOf } from './chat-core'
import { EDIT_RECIPES, editRecipe, isEditRecipeId } from './edit-recipes'
import {
  CARD_TYPE_LABELS, CUT_LABELS, MAX_CARD_ITEM_CHARS, MAX_CARD_ITEMS, MAX_CARD_TITLE_CHARS, MAX_HOOK_TEXT_CHARS, MAX_POPUP_TEXT_CHARS, SOUND_LABELS,
  applyRecipe, chooseHook, formatClock, parseEditDecisions, reelCardWindows, reelOrder, reelSeconds, reelWordStarts,
  type EditCard, type EditDecisions, type EditImage, type EditPlan
} from './edit-recording'
import { HEADLINE_FONTS, HEADLINE_LOOKS, parseHeadlineLook } from './headline-look'
import { LOOK_EXTRAS, parseLookExtras } from './look-extras'
import { GRAPHIC_MAX_MS, GRAPHIC_MIN_MS, GRAPHIC_PLACEMENTS, MAX_GRAPHIC_FIELD_CHARS, newGraphic, templateInfo, type GraphicPlacement, type GraphicTemplateId } from './motion-graphics'
import { MAX_REEL_GRAPHICS, REEL_GRAPHIC_TEMPLATES, graphicFields, newEditGraphic, type EditGraphic } from './reel-graphics'
import { PIN_PROP, aimGraphic, pinArg, type ChatPoint } from './chat-point'
import { SHOT_LABELS, moveClip, removeClip, restoreClip, sameOrder, type ShotType } from './combine-clips'

export const EDIT_CHAT_SUGGESTIONS = ['Cut the retakes', 'Punchier hook', 'Add a stat graphic', 'Turn off the pop-ups'] as const
/** Suggestions while the member has pins on the frame. */
export const EDIT_CHAT_POINT_SUGGESTIONS = ['Put an arrow here', 'Circle this', 'Move the graphic here'] as const

/** What the chat may change in the review (the look is the member's current look). */
export type EditChatPatch = Partial<Pick<EditDecisions, 'cut' | 'hookId' | 'hookText' | 'endOnCta' | 'popups' | 'sounds' | 'look' | 'recipe' | 'lookExtras' | 'cutoutIntro' | 'rawIntro' | 'graphics' | 'clipOrder' | 'transitions'>>
const PATCH_KEYS = ['cut', 'hookId', 'hookText', 'endOnCta', 'popups', 'sounds', 'look', 'recipe', 'lookExtras', 'cutoutIntro', 'rawIntro', 'graphics', 'clipOrder', 'transitions'] as const

export type EditChatToolName = 'cut_words' | 'keep_words' | 'choose_hook' | 'start_with' | 'set_hook_text' | 'set_end_on_cta' | 'set_popup' | 'set_card'
  | 'set_sound' | 'set_style' | 'set_extras' | 'set_openings' | 'set_captions' | 'set_hook_look' | 'add_graphic' | 'update_graphic' | 'remove_graphic'
  | 'move_clip' | 'remove_clip' | 'restore_clip' | 'order_clips' | 'set_transitions'
/** The tools only a combine-clips edit has. */
export const COMBINE_CHAT_TOOLS: readonly EditChatToolName[] = ['move_clip', 'remove_clip', 'restore_clip', 'order_clips', 'set_transitions']

export interface EditChatStep { tool: EditChatToolName; summary: string; patch: EditChatPatch }
export type EditChatReply = ChatReplyOf<EditChatStep>

export interface EditChatContext { plan: EditPlan; images: readonly EditImage[] }

const MAX_SPAN = 400

const quote = (plan: EditPlan, a: number, b: number): string => {
  const words = plan.words.slice(a, b + 1).map((w) => w.text)
  const text = words.length > 10 ? `${words.slice(0, 5).join(' ')} … ${words.slice(-3).join(' ')}` : words.join(' ')
  return `“${text.replace(/[.,!?;:]+$/, '')}”`
}
function wordIndex(value: unknown, name: string, plan: EditPlan): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= plan.words.length) fail(`${name} must be a word index from 0 to ${plan.words.length - 1}.`)
  return value as number
}
function span(args: Record<string, unknown>, plan: EditPlan): [number, number] {
  const a = wordIndex(args.start, 'start', plan), b = args.end === undefined ? a : wordIndex(args.end, 'end', plan)
  if (b < a) fail('end must be at or after start.')
  if (b - a >= MAX_SPAN) fail(`Change at most ${MAX_SPAN} words at once.`)
  return [a, b]
}
const sorted = (set: Set<number>): number[] => [...set].sort((x, y) => x - y)

/** Checks the whole review the way Make my reel does; a problem goes back to the model. */
function check(next: EditDecisions, ctx: EditChatContext): EditDecisions {
  try { return parseEditDecisions(next, ctx.plan, ctx.images) } catch (error) { return fail(`That can’t be made: ${(error as Error).message}`) }
}

/** The values a patch sets, read from the review (for undoing it). */
export function editPatchValues(d: EditDecisions, keys: readonly (keyof EditChatPatch)[]): EditChatPatch {
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = structuredClone(d[key] ?? (key === 'graphics' ? [] : d[key]))
  return out as EditChatPatch
}

/** Runs one tool call against `d`. Returns the step and the changed review, or throws ChatToolError. */
export function applyEditChatTool(d: EditDecisions, name: string, args: Record<string, unknown>, ctx: EditChatContext, newId?: () => string, points: readonly ChatPoint[] = []): { step: EditChatStep; decisions: EditDecisions } {
  const { plan } = ctx
  const why = chatReason(args)
  const done = (summary: string, patch: EditChatPatch): { step: EditChatStep; decisions: EditDecisions } => {
    const decisions = check({ ...d, ...patch }, ctx)
    const clean: EditChatPatch = {}
    for (const key of Object.keys(patch) as (keyof EditChatPatch)[]) (clean as Record<string, unknown>)[key] = structuredClone(decisions[key])
    return { step: { tool: name as EditChatToolName, summary: chatSentence(summary), patch: clean }, decisions }
  }
  switch (name) {
    case 'cut_words': case 'keep_words': {
      const [a, b] = span(args, plan)
      const cut = new Set(d.cut)
      for (let i = a; i <= b; i++) { if (name === 'cut_words') cut.add(i); else cut.delete(i) }
      if (sorted(cut).join() === d.cut.join()) fail(name === 'cut_words' ? 'Those words are already cut.' : 'Those words are already kept.')
      return done(`${name === 'cut_words' ? 'Cut' : 'Kept'} ${quote(plan, a, b)} (${b - a + 1} word${b === a ? '' : 's'})${why}`, { cut: sorted(cut) })
    }
    case 'choose_hook': {
      const id = args.hook_id === null ? null : args.hook_id
      if (id !== null && !plan.hooks.some((h) => h.id === id)) return fail(`hook_id must be one of ${plan.hooks.map((h) => h.id).join(', ') || '(none planned)'} or null.`)
      const next = chooseHook(plan, d, id as number | null)
      const hook = plan.hooks.find((h) => h.id === id)
      return done(hook ? `Opens with ${quote(plan, hook.start, hook.end)}${why}` : `No hook: starts from the beginning${why}`, { hookId: next.hookId, hookText: next.hookText, cut: next.cut })
    }
    case 'start_with': {
      const [a, b] = span(args, plan)
      // A hook the plan found on these words opens the reel; otherwise everything said before them is cut.
      const hook = plan.hooks.find((h) => h.start <= a + 2 && h.end >= Math.min(b, a + 2) && h.start <= b)
      if (hook) {
        const next = chooseHook(plan, d, hook.id)
        return done(`Opens with ${quote(plan, hook.start, hook.end)}${why}`, { hookId: next.hookId, hookText: next.hookText, cut: next.cut })
      }
      const cut = new Set(d.cut)
      for (let i = 0; i < a; i++) cut.add(i)
      for (let i = a; i <= b; i++) cut.delete(i)
      const dropped = sorted(cut).filter((i) => !d.cut.includes(i)).length
      return done(`Starts with ${quote(plan, a, b)}: cut ${dropped} word${dropped === 1 ? '' : 's'} before it${why}`, { hookId: null, cut: sorted(cut) })
    }
    case 'set_hook_text': {
      const text = typeof args.text === 'string' && !args.text.trim() ? '' : chatText(args.text, 'text', MAX_HOOK_TEXT_CHARS)
      if (text && text.split(' ').length < 2) fail('Hook text needs at least two words (or "" for none).')
      return done(text ? `Hook text set to “${text}”${why}` : `Hook text removed${why}`, { hookText: text })
    }
    case 'set_end_on_cta': {
      if (typeof args.on !== 'boolean') return fail('on must be true or false.')
      if (!plan.cta) fail('No call to action was found in the recording.')
      return done(`${args.on ? 'Ends' : 'Doesn’t end'} on your call to action${why}`, { endOnCta: args.on })
    }
    case 'set_popup': {
      const popup = plan.popups.find((p) => p.id === args.id && p.kind !== 'card')
      if (!popup) return fail(`No pop-up ${String(args.id).slice(0, 10)}. Pop-ups are listed in the context (cards use set_card).`)
      const item = d.popups.find((p) => p.id === popup.id)!
      const text = args.text === undefined ? item.text : chatText(args.text, 'text', MAX_POPUP_TEXT_CHARS)
      const on = args.on === undefined ? item.on : args.on
      if (typeof on !== 'boolean') return fail('on must be true or false.')
      if (on && d.cut.includes(popup.word)) fail('Its word is cut, so it can’t show. Keep the word first.')
      const popups = d.popups.map((p) => p.id === popup.id ? { ...p, on, text } : p)
      return done(`Pop-up “${text}” ${on ? 'on' : 'off'}${why}`, { popups })
    }
    case 'set_card': {
      const popup = plan.popups.find((p) => p.id === args.id && p.kind === 'card')
      if (!popup) return fail(`No card ${String(args.id).slice(0, 10)}. Cards are listed in the context.`)
      const item = d.popups.find((p) => p.id === popup.id)!
      const card: EditCard = structuredClone(item.card ?? popup.card!)
      if (args.title !== undefined) card.title = typeof args.title === 'string' && !args.title.trim() ? '' : chatText(args.title, 'title', MAX_CARD_TITLE_CHARS)
      if (args.items !== undefined) {
        if (!Array.isArray(args.items) || args.items.length > MAX_CARD_ITEMS) return fail(`items must be a list of up to ${MAX_CARD_ITEMS} lines.`)
        card.items = args.items.map((line, i) => chatText(line, `items[${i}]`, MAX_CARD_ITEM_CHARS))
      }
      const on = args.on === undefined ? item.on : args.on
      if (typeof on !== 'boolean') return fail('on must be true or false.')
      const popups = d.popups.map((p) => p.id === popup.id ? { ...p, on, card, text: card.title || card.items[0] || '' } : p)
      return done(`${CARD_TYPE_LABELS[card.type]} half-screen graphic ${args.title !== undefined || args.items !== undefined ? 'changed' : ''}${on ? ' (on)' : ' (off)'}${why}`.replace('  ', ' '), { popups })
    }
    case 'set_sound': {
      const sound = plan.sounds.find((s) => s.id === args.id)
      if (!sound) return fail(`No sound ${String(args.id).slice(0, 10)}. Sounds are listed in the context.`)
      if (typeof args.on !== 'boolean') return fail('on must be true or false.')
      return done(`${SOUND_LABELS[sound.sound]} ${args.on ? 'on' : 'off'}${why}`, { sounds: d.sounds.map((s) => s.id === sound.id ? { ...s, on: args.on as boolean } : s) })
    }
    case 'set_style': {
      if (!isEditRecipeId(args.style)) return fail(`style must be one of ${EDIT_RECIPES.map((r) => r.id).join(', ')}.`)
      const next = applyRecipe(plan, d, args.style)
      return done(`Edit style set to ${editRecipe(args.style).label}${why}`, { recipe: next.recipe, lookExtras: next.lookExtras, popups: next.popups })
    }
    case 'set_extras': {
      if (!Array.isArray(args.extras)) return fail(`extras must be a list of ${LOOK_EXTRAS.map((x) => x.id).join(', ')}.`)
      const extras = parseLookExtras(args.extras)
      if (extras.length !== new Set(args.extras).size) fail(`extras may only be ${LOOK_EXTRAS.map((x) => x.id).join(', ')}.`)
      const label = extras.map((id) => LOOK_EXTRAS.find((x) => x.id === id)!.label).join(', ') || 'none'
      return done(`Extras: ${label}${why}`, { lookExtras: extras })
    }
    case 'set_openings': {
      const patch: EditChatPatch = {}
      if (args.cutout_intro !== undefined) { if (typeof args.cutout_intro !== 'boolean') fail('cutout_intro must be true or false.'); patch.cutoutIntro = args.cutout_intro as boolean }
      if (args.raw_intro !== undefined) { if (typeof args.raw_intro !== 'boolean') fail('raw_intro must be true or false.'); patch.rawIntro = args.raw_intro as boolean }
      if (!Object.keys(patch).length) fail('Give cutout_intro, raw_intro or both.')
      const parts = [patch.cutoutIntro !== undefined ? `Cut-out opening ${patch.cutoutIntro ? 'on' : 'off'}` : '', patch.rawIntro !== undefined ? `Raw-to-edited opening ${patch.rawIntro ? 'on' : 'off'}` : ''].filter(Boolean)
      return done(`${parts.join('; ')}${why}`, patch)
    }
    case 'set_captions': {
      const look = { ...d.look }
      if (args.on !== undefined) { if (typeof args.on !== 'boolean') fail('on must be true or false.'); look.includeCaptions = args.on as boolean }
      if (args.preset !== undefined) { if (!isCaptionPresetId(args.preset)) fail(`preset must be one of ${CAPTION_PRESET_IDS.join(', ')}.`); look.captionPreset = args.preset as string; if (args.on === undefined) look.includeCaptions = true }
      if (args.on === undefined && args.preset === undefined) fail('Give on, preset or both.')
      return done(`${!look.includeCaptions ? 'Captions turned off' : args.preset ? `Captions set to the ${look.captionPreset} style` : 'Captions turned on'}${why}`, { look })
    }
    case 'set_hook_look': {
      const next: Record<string, unknown> = { ...d.look.headlineLook }
      for (const key of ['look', 'color', 'font'] as const) if (args[key] !== undefined) next[key] = args[key]
      let headlineLook
      try { headlineLook = parseHeadlineLook(next) } catch { return fail(`Use look ${HEADLINE_LOOKS.map((l) => l.id).join('/')}, font ${HEADLINE_FONTS.map((f) => f.id).join('/')} and color as #RRGGBB.`) }
      const label = HEADLINE_LOOKS.find((l) => l.id === headlineLook.look)?.label ?? headlineLook.look
      return done(`Hook text look set to ${label}${why}`, { look: { ...d.look, headlineLook } })
    }
    case 'add_graphic': case 'update_graphic': {
      const graphics = d.graphics ?? []
      const current = name === 'update_graphic' ? graphics.find((g) => g.id === args.id) : undefined
      if (name === 'update_graphic' && !current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The graphics are listed in the context.`)
      if (name === 'add_graphic' && graphics.length >= MAX_REEL_GRAPHICS) fail(`A reel can have up to ${MAX_REEL_GRAPHICS} graphics.`)
      if (name === 'add_graphic' && !REEL_GRAPHIC_TEMPLATES.some((t) => t.id === args.template)) return fail(`template must be one of ${REEL_GRAPHIC_TEMPLATES.map((t) => t.id).join(', ')}.`)
      const template = (current?.template ?? args.template) as GraphicTemplateId
      const word = args.word === undefined && current ? current.word : wordIndex(args.word, 'word', plan)
      if (d.cut.includes(word)) fail('That word is cut, so the graphic wouldn’t show. Use a word that is kept.')
      const duration = args.duration_ms === undefined ? current?.duration_ms ?? 3000 : args.duration_ms
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < GRAPHIC_MIN_MS || duration > GRAPHIC_MAX_MS) return fail(`duration_ms must be between ${GRAPHIC_MIN_MS} and ${GRAPHIC_MAX_MS}.`)
      const placement = args.placement === undefined ? current?.placement ?? (template === 'lower_third' ? 'bottom' : 'top') : args.placement
      if (!(GRAPHIC_PLACEMENTS as readonly unknown[]).includes(placement)) return fail(`placement must be ${GRAPHIC_PLACEMENTS.join(', ')}.`)
      const fields = graphicFields(template, current?.fields ?? {}, args.fields)
      // A graphic can't play during a card: say so now, so the model can move it.
      const starts = reelWordStarts(plan, d), at = starts.get(word) ?? 0
      const card = reelCardWindows(plan, d, starts).find((w) => at < w.end && at + duration / 1000 > w.start)
      if (card) fail(`That would play during a card (${card.start.toFixed(1)}–${card.end.toFixed(1)}s of the reel), so it would be left out. Use a word after the card ends, or turn the card off.`)
      const base = current ?? newEditGraphic(newGraphic(template, 0, { origin: 'chat', taken: graphics.map((g) => g.id) }), word)
      const pin = pinArg(args, points)
      let graphic: EditGraphic = { ...base, ...(newId && !current ? { id: newId() } : {}), word, duration_ms: Math.round(duration), placement: placement as GraphicPlacement, fields, origin: current?.origin ?? 'chat' }
      if (pin) { const aimed = aimGraphic(graphic, pin, typeof (args.fields as Record<string, unknown> | undefined)?.shape === 'string'); graphic = { ...aimed, placement: args.placement !== undefined ? graphic.placement : aimed.placement } }
      const next = current ? graphics.map((g) => g.id === graphic.id ? graphic : g) : [...graphics, graphic]
      const label = templateInfo(template).label.toLowerCase()
      return done(`${current ? 'Changed the' : 'Added a'} ${label} on ${quote(plan, word, word)}${why}`, { graphics: next.sort((x, y) => x.word - y.word) })
    }
    case 'remove_graphic': {
      const graphics = d.graphics ?? [], current = graphics.find((g) => g.id === args.id)
      if (!current) return fail(`No graphic ${String(args.id).slice(0, 40)}. The graphics are listed in the context.`)
      return done(`Removed the ${templateInfo(current.template).label.toLowerCase()} on ${quote(plan, current.word, current.word)}${why}`, { graphics: graphics.filter((g) => g.id !== current.id) })
    }
    case 'move_clip': case 'remove_clip': case 'restore_clip': case 'order_clips': case 'set_transitions': {
      const combine = plan.combine
      if (!combine || !d.clipOrder) return fail('This edit is one recording, not clips to combine.')
      const count = combine.startOrder.length
      const clip = (): number => {
        const n = args.clip
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > count) fail(`clip must be a clip number from 1 to ${count}.`)
        return (n as number) - 1
      }
      if (name === 'set_transitions') {
        if (typeof args.on !== 'boolean') return fail('on must be true or false.')
        return done(`${args.on ? 'Quick transitions between clips' : 'Clean cuts between clips'}${why}`, { transitions: args.on })
      }
      if (name === 'order_clips') {
        const filmed = Array.from({ length: count }, (_, i) => i)
        if (args.order === 'ai') {
          if (!combine.aiOrder) return fail('The AI didn’t suggest an order for these clips. Move clips with move_clip instead.')
          if (sameOrder(d.clipOrder, combine.aiOrder)) fail('The clips are already in the AI’s order.')
          return done(`Put the clips in the AI’s order${combine.orderWhy ? `: ${combine.orderWhy}` : ''}${why}`, { clipOrder: [...combine.aiOrder] })
        }
        if (args.order === 'filmed') {
          if (sameOrder(d.clipOrder, filmed)) fail('The clips are already in the order they were filmed.')
          return done(`Put the clips back in the order they were filmed${why}`, { clipOrder: filmed })
        }
        return fail('order must be "ai" or "filmed".')
      }
      const src = clip()
      if (name === 'restore_clip') {
        if (d.clipOrder.includes(src)) fail(`Clip ${src + 1} is already in the reel.`)
        return done(`Put clip ${src + 1} back${why}`, { clipOrder: restoreClip(d.clipOrder, src) })
      }
      if (!d.clipOrder.includes(src)) fail(`Clip ${src + 1} was removed. Use restore_clip to put it back first.`)
      if (name === 'remove_clip') {
        if (d.clipOrder.length === 1) fail('That is the only clip left in the reel.')
        return done(`Removed clip ${src + 1}${why}`, { clipOrder: removeClip(d.clipOrder, src) })
      }
      const position = args.position
      if (typeof position !== 'number' || !Number.isInteger(position) || position < 1 || position > d.clipOrder.length) return fail(`position must be from 1 to ${d.clipOrder.length}.`)
      if (d.clipOrder.indexOf(src) === position - 1) fail(`Clip ${src + 1} already plays there.`)
      return done(`Moved clip ${src + 1} to play ${ordinal(position)}${why}`, { clipOrder: moveClip(d.clipOrder, src, 0, position - 1) })
    }
    default:
      return fail(`There is no tool called ${String(name).slice(0, 40)}.`)
  }
}

const ordinal = (n: number): string => n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`

/** The page's check before applying: every step's values in order, merged, and valid like Make my reel. */
export function mergeEditChatSteps(d: EditDecisions, steps: unknown, ctx: EditChatContext): EditChatPatch {
  if (!Array.isArray(steps) || steps.length > 12) throw new Error('The chat sent an invalid edit.')
  const patch: Record<string, unknown> = {}
  for (const step of steps as EditChatStep[]) {
    const p = step?.patch
    if (!p || typeof p !== 'object' || Object.keys(p).some((key) => !(PATCH_KEYS as readonly string[]).includes(key))) throw new Error('The chat sent an invalid edit.')
    Object.assign(patch, structuredClone(p))
  }
  let next: EditDecisions
  try { next = parseEditDecisions({ ...d, ...patch }, ctx.plan, ctx.images) } catch { throw new Error('The chat’s change doesn’t fit your edit anymore. Ask again.') }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) out[key] = (next as unknown as Record<string, unknown>)[key]
  return out as EditChatPatch
}

export function parseEditChatSteps(value: unknown): EditChatStep[] {
  return parseStepsLoose<EditChatStep>(value, (s) => s.patch && typeof s.patch === 'object' ? { patch: s.patch as EditChatPatch } : null)
}

/** The review as the model sees it: every word with its index (cut ones struck), takes, hooks, cards, pop-ups, sounds, graphics and the look. */
export function editChatContext(d: EditDecisions, ctx: EditChatContext, sources: readonly { name: string; shot?: ShotType }[]): string {
  const { plan } = ctx
  const cut = new Set(d.cut)
  const lines: string[] = []
  const hook = plan.hooks.find((h) => h.id === d.hookId)
  if (plan.combine && d.clipOrder) {
    const order = d.clipOrder
    lines.push(`The reel is about ${formatClock(reelSeconds(plan, d))} long, COMBINED from ${sources.length} clips filmed one after another (parts of one video, numbered in filming order): ${sources.map((s, i) => `clip ${i + 1}: ${chatPlainText(s.name, 60)} (${s.shot ? SHOT_LABELS[s.shot].toLowerCase() : 'video'})`).join('; ')}.`)
    lines.push(`They play in this order: ${order.map((src) => `clip ${src + 1}`).join(', ')}.${sources.length > order.length ? ` Removed: ${sources.map((_, i) => i).filter((i) => !order.includes(i)).map((i) => `clip ${i + 1}`).join(', ')}.` : ''} The AI's order: ${plan.combine.aiOrder ? `${plan.combine.aiOrder.map((src) => src + 1).join(', ')}${plan.combine.orderWhy ? ` (${chatPlainText(plan.combine.orderWhy, 160)})` : ''}` : 'none'}. Transitions: ${d.transitions ? 'quick dip between clips' : 'clean cuts'}. Use move_clip, remove_clip, restore_clip, order_clips and set_transitions for these.`)
    lines.push(`It plays: the hook first (if any), then each clip's kept words, clip by clip, then the call to action (when it ends on it). ${reelOrder(plan, d).length} of ${plan.words.length} words play.`)
  } else {
    lines.push(`The reel is about ${formatClock(reelSeconds(plan, d))} long, made from ${sources.length} take${sources.length === 1 ? '' : 's'} (${sources.map((s, i) => `take ${i + 1}: ${chatPlainText(s.name, 80)}`).join('; ')}).`)
    lines.push(`It plays: the hook first (if any), then the kept words in order, then the call to action (when it ends on it). ${reelOrder(plan, d).length} of ${plan.words.length} words are kept.`)
  }
  lines.push('')
  lines.push('Transcript. Each word is index:word; ~word~ is cut, with why in brackets. A new line starts at a sentence end or a long pause.')
  let line: string[] = [], src = -1
  const flush = (): void => { if (line.length) lines.push(line.join(' ')); line = [] }
  plan.words.forEach((w, i) => {
    const prev = plan.words[i - 1]
    if (w.src !== src) { flush(); lines.push(`— ${plan.combine ? 'Clip' : 'Take'} ${w.src + 1} —`); src = w.src }
    else if (prev && (/[.!?…]["')\]]*$/.test(prev.text) || w.startMs - prev.endMs > 1500)) flush()
    line.push(cut.has(i) ? `${i}:~${w.text}~${w.cut ? `[${CUT_LABELS[w.cut]}]` : ''}` : `${i}:${w.text}`)
  })
  flush()
  lines.push('')
  lines.push(plan.hooks.length ? `Hooks found (choose_hook): ${plan.hooks.map((h) => `id ${h.id}: words ${h.start}–${h.end} “${h.text}”${h.id === d.hookId ? ' (chosen)' : ''}`).join('; ')}.` : 'No hooks were found.')
  lines.push(hook ? `Opens with hook ${hook.id}.` : 'No hook: it starts from the beginning.')
  lines.push(`Hook text on screen: ${d.hookText ? `“${d.hookText}”` : 'none'} (look ${d.look.headlineLook.look}, font ${d.look.headlineLook.font}).`)
  lines.push(plan.cta ? `Call to action: words ${plan.cta.start}–${plan.cta.end}; ${d.endOnCta ? 'moved to the end' : 'left where it was said'}.` : 'No call to action was found.')
  const cards = plan.popups.filter((p) => p.kind === 'card'), pops = plan.popups.filter((p) => p.kind !== 'card')
  const choice = (id: number): EditDecisions['popups'][number] | undefined => d.popups.find((p) => p.id === id)
  lines.push(pops.length ? `Pop-ups (set_popup): ${pops.map((p) => `id ${p.id} on word ${p.word} “${choice(p.id)?.text ?? p.text}” ${choice(p.id)?.on ? 'on' : 'off'}`).join('; ')}.` : 'Pop-ups: none planned.')
  const windows = reelCardWindows(plan, d)
  lines.push(cards.length ? `Half-screen cards (set_card): ${cards.map((p) => { const c = choice(p.id)?.card ?? p.card!; const w = windows.find((x) => x.id === p.id); return `id ${p.id} ${c.type} on word ${p.word}: title “${c.title}”, items ${JSON.stringify(c.items)}, ${choice(p.id)?.on ? `on${w ? ` (${w.start.toFixed(1)}–${w.end.toFixed(1)}s of the reel)` : ''}` : 'off'}` }).join('; ')}.` : 'Half-screen cards: none planned.')
  lines.push(plan.sounds.length ? `Sounds (set_sound): ${plan.sounds.map((s) => `id ${s.id} ${s.sound} ${s.at === 'title' ? 'as the hook text appears' : `on word ${s.at}`} ${d.sounds.find((x) => x.id === s.id)?.on ? 'on' : 'off'}`).join('; ')}.` : 'Sounds: none planned.')
  const starts = reelWordStarts(plan, d)
  lines.push((d.graphics ?? []).length ? `Graphics: ${(d.graphics ?? []).map((g) => `${g.id} ${g.template} on word ${g.word}${starts.has(g.word) ? ` (${starts.get(g.word)!.toFixed(1)}s)` : ' (word cut: not shown)'} for ${g.duration_ms} ms (${g.placement}): ${Object.entries(g.fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`).join('; ')}.` : 'Graphics: none.')
  lines.push(`Edit style: ${d.recipe} (${EDIT_RECIPES.map((r) => `${r.id}: ${r.label}`).join('; ')}). Extras on: ${d.lookExtras.join(', ') || 'none'}.`)
  lines.push(`Openings: cut-out opening ${d.cutoutIntro ? 'on' : 'off'}; raw-to-edited opening ${d.rawIntro ? 'on' : 'off'}. Captions: ${d.look.includeCaptions ? `on, style ${d.look.captionPreset}` : 'off'}.`)
  return lines.join('\n')
}

const reason = { type: 'string', maxLength: 120, description: 'Optional: why, in a few words for the member.' }
const index = (description: string): Record<string, unknown> => ({ type: 'integer', minimum: 0, description })
const fieldsProp = {
  type: 'object', additionalProperties: { type: 'string' },
  description: `Template text. stat: value, label · title: text · list/checklist: title, items (newline-separated, up to 5) · lower_third: name, role · before_after: before, after · quote: text, author · highlight: shape (arrow or circle), x, y (0..1 as text). Up to ${MAX_GRAPHIC_FIELD_CHARS} characters each. Words and numbers must come from what is said or from the member.`
}

/** The tools as OpenRouter functions. */
export const EDIT_CHAT_TOOLS: { name: EditChatToolName; description: string; parameters: Record<string, unknown> }[] = [
  { name: 'cut_words', description: 'Cut words start..end (inclusive word indexes) from the reel: a retake, a false start, filler, a tangent.', parameters: { type: 'object', properties: { start: index('First word index.'), end: index('Last word index (inclusive).'), reason }, required: ['start', 'end'], additionalProperties: false } },
  { name: 'keep_words', description: 'Keep words start..end that are cut.', parameters: { type: 'object', properties: { start: index('First word index.'), end: index('Last word index (inclusive).'), reason }, required: ['start', 'end'], additionalProperties: false } },
  { name: 'choose_hook', description: 'Open the reel with one of the hooks found (its words play first), or null to start from the beginning.', parameters: { type: 'object', properties: { hook_id: { type: ['integer', 'null'] }, reason }, required: ['hook_id'], additionalProperties: false } },
  { name: 'start_with', description: 'Make the reel start with words start..end: a hook found on them opens the reel, otherwise everything said before them is cut.', parameters: { type: 'object', properties: { start: index('First word index of the line.'), end: index('Last word index of the line.'), reason }, required: ['start', 'end'], additionalProperties: false } },
  { name: 'set_hook_text', description: `Set the hook text shown on screen (2+ words, up to ${MAX_HOOK_TEXT_CHARS} characters, true to what is said), or "" for none.`, parameters: { type: 'object', properties: { text: { type: 'string', maxLength: MAX_HOOK_TEXT_CHARS }, reason }, required: ['text'], additionalProperties: false } },
  { name: 'set_end_on_cta', description: 'Move the call to action they said to the end (true) or leave it where it was said (false).', parameters: { type: 'object', properties: { on: { type: 'boolean' }, reason }, required: ['on'], additionalProperties: false } },
  { name: 'set_popup', description: `Turn a text pop-up on or off, or change its words (up to ${MAX_POPUP_TEXT_CHARS} characters).`, parameters: { type: 'object', properties: { id: { type: 'integer' }, on: { type: 'boolean' }, text: { type: 'string', maxLength: MAX_POPUP_TEXT_CHARS }, reason }, required: ['id'], additionalProperties: false } },
  { name: 'set_card', description: `Turn a half-screen card on or off, or change its title (up to ${MAX_CARD_TITLE_CHARS}) and items (up to ${MAX_CARD_ITEMS}, ${MAX_CARD_ITEM_CHARS} each). Its type stays.`, parameters: { type: 'object', properties: { id: { type: 'integer' }, on: { type: 'boolean' }, title: { type: 'string' }, items: { type: 'array', items: { type: 'string' }, maxItems: MAX_CARD_ITEMS }, reason }, required: ['id'], additionalProperties: false } },
  { name: 'set_sound', description: 'Turn a planned sound effect on or off.', parameters: { type: 'object', properties: { id: { type: 'integer' }, on: { type: 'boolean' }, reason }, required: ['id', 'on'], additionalProperties: false } },
  { name: 'set_style', description: `Pick the edit style (pacing and what starts on): ${EDIT_RECIPES.map((r) => `${r.id}: ${r.detail}`).join(' ')}`, parameters: { type: 'object', properties: { style: { type: 'string', enum: EDIT_RECIPES.map((r) => r.id) }, reason }, required: ['style'], additionalProperties: false } },
  { name: 'set_extras', description: `Set the extras on top of the look (the full list): ${LOOK_EXTRAS.map((x) => `${x.id}: ${x.detail}`).join(' ')}`, parameters: { type: 'object', properties: { extras: { type: 'array', items: { type: 'string', enum: LOOK_EXTRAS.map((x) => x.id) } }, reason }, required: ['extras'], additionalProperties: false } },
  { name: 'set_openings', description: 'Turn the cut-out opening (background removed for the first 3 seconds) or the raw-to-edited opening (a 3.5-second card showing the raw take first) on or off.', parameters: { type: 'object', properties: { cutout_intro: { type: 'boolean' }, raw_intro: { type: 'boolean' }, reason }, additionalProperties: false } },
  { name: 'set_captions', description: 'Turn captions on or off, or choose their style.', parameters: { type: 'object', properties: { on: { type: 'boolean' }, preset: { type: 'string', enum: [...CAPTION_PRESET_IDS] }, reason }, additionalProperties: false } },
  { name: 'set_hook_look', description: 'Change how the hook text looks. Give only what changes.', parameters: { type: 'object', properties: { look: { type: 'string', enum: HEADLINE_LOOKS.map((l) => l.id) }, font: { type: 'string', enum: HEADLINE_FONTS.map((f) => f.id) }, color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, reason }, additionalProperties: false } },
  { name: 'add_graphic', description: `Add a motion graphic that starts as a word is said (${REEL_GRAPHIC_TEMPLATES.map((t) => `${t.id}: ${t.detail}`).join(' ')}). It can't play during a half-screen card. With pin ("put an arrow here"): a highlight points at the pin; another template sits in the band nearest it.`, parameters: { type: 'object', properties: { template: { type: 'string', enum: REEL_GRAPHIC_TEMPLATES.map((t) => t.id) }, word: index('The word index it starts on (a kept word).'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: GRAPHIC_MAX_MS }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, fields: fieldsProp, pin: PIN_PROP, reason }, required: ['template', 'word', 'fields'], additionalProperties: false } },
  { name: 'update_graphic', description: 'Change a graphic by id. Give only what changes. With pin ("move it here"): an arrow or circle points at the pin; another graphic moves to the band nearest it.', parameters: { type: 'object', properties: { id: { type: 'string' }, word: index('The word index it starts on.'), duration_ms: { type: 'number', minimum: GRAPHIC_MIN_MS, maximum: GRAPHIC_MAX_MS }, placement: { type: 'string', enum: [...GRAPHIC_PLACEMENTS] }, fields: fieldsProp, pin: PIN_PROP, reason }, required: ['id'], additionalProperties: false } },
  { name: 'remove_graphic', description: 'Remove a graphic by id.', parameters: { type: 'object', properties: { id: { type: 'string' }, reason }, required: ['id'], additionalProperties: false } },
  { name: 'move_clip', description: 'Combined clips only: move a clip (its number, in filming order) to play at a position (1 = first).', parameters: { type: 'object', properties: { clip: { type: 'integer', minimum: 1 }, position: { type: 'integer', minimum: 1 }, reason }, required: ['clip', 'position'], additionalProperties: false } },
  { name: 'remove_clip', description: 'Combined clips only: leave a clip out of the reel.', parameters: { type: 'object', properties: { clip: { type: 'integer', minimum: 1 }, reason }, required: ['clip'], additionalProperties: false } },
  { name: 'restore_clip', description: 'Combined clips only: put a removed clip back (where it was filmed).', parameters: { type: 'object', properties: { clip: { type: 'integer', minimum: 1 }, reason }, required: ['clip'], additionalProperties: false } },
  { name: 'order_clips', description: 'Combined clips only: play the clips in the AI’s suggested order ("ai": hook, points, proof, close) or in the order they were filmed ("filmed").', parameters: { type: 'object', properties: { order: { type: 'string', enum: ['ai', 'filmed'] }, reason }, required: ['order'], additionalProperties: false } },
  { name: 'set_transitions', description: 'Combined clips only: a quick 0.2 s dip through black between clips (true) or clean cuts (false).', parameters: { type: 'object', properties: { on: { type: 'boolean' }, reason }, required: ['on'], additionalProperties: false } }
]

export { ChatToolError }
