import { app } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  MAX_PRESETS, isBeatSheetChoice, isPresetId, parseDefaultBrandId, parseMemberPrefs, parseSampleVideoLink, parseStyleOf, parseSupportLink, presetName,
  type MemberPrefs, type StyleKind, type StylePreset
} from '../shared/member-prefs'
import { parseProfileUpdate } from '../shared/onboarding'

/**
 * The member's remembered styles, saved styles and small app preferences
 * (userData/member-prefs.json). Never API keys: those live in settings.json.
 * An unreadable file loads as the defaults (and is replaced on the next save).
 */

const FILE = 'member-prefs.json'
const VERSION = 1

function prefsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, FILE)
}

let cache: MemberPrefs | null = null

export function readMemberPrefs(): MemberPrefs {
  if (cache) return cache
  let raw: unknown = null
  try { raw = JSON.parse(readFileSync(prefsPath(), 'utf8')) } catch { raw = null }
  cache = parseMemberPrefs(raw)
  return cache
}

function write(prefs: MemberPrefs): MemberPrefs {
  const path = prefsPath()
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ version: VERSION, ...prefs }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true })
  }
  cache = parseMemberPrefs(JSON.parse(JSON.stringify(prefs)))
  return cache
}

function kindOf(value: unknown): StyleKind {
  if (value !== 'create' && value !== 'remix') throw new Error('Choose Create or Remix.')
  return value
}

/** The style the member used last on Create or Remix. */
export function saveLastStyle(kind: unknown, style: unknown): MemberPrefs {
  const k = kindOf(kind)
  const prefs = readMemberPrefs()
  return write({ ...prefs, [k]: parseStyleOf(k, style) })
}

function newId(taken: StylePreset[]): string {
  let id = randomBytes(8).toString('hex')
  while (taken.some((preset) => preset.id === id)) id = randomBytes(8).toString('hex')
  return id
}

/** Save the current style under a name; the same name replaces that style. */
export function savePreset(kind: unknown, name: unknown, style: unknown): MemberPrefs {
  const k = kindOf(kind)
  const clean = presetName(name)
  if (!clean) throw new Error('Name the style (1 to 40 characters).')
  const prefs = readMemberPrefs()
  const list = prefs.presets[k] as StylePreset[]
  const parsed = parseStyleOf(k, style)
  const now = new Date().toISOString()
  const existing = list.find((preset) => preset.name.toLowerCase() === clean.toLowerCase())
  if (!existing && list.length >= MAX_PRESETS) throw new Error(`You can save up to ${MAX_PRESETS} styles. Delete one first.`)
  const next = existing
    ? list.map((preset) => preset.id === existing.id ? { ...preset, name: clean, style: parsed, updatedAt: now } : preset)
    : [...list, { id: newId(list), name: clean, style: parsed, updatedAt: now }]
  return write({ ...prefs, presets: { ...prefs.presets, [k]: next } })
}

export function renamePreset(kind: unknown, id: unknown, name: unknown): MemberPrefs {
  const k = kindOf(kind)
  if (!isPresetId(id)) throw new Error('That style no longer exists.')
  const clean = presetName(name)
  if (!clean) throw new Error('Name the style (1 to 40 characters).')
  const prefs = readMemberPrefs()
  const list = prefs.presets[k] as StylePreset[]
  if (!list.some((preset) => preset.id === id)) throw new Error('That style no longer exists.')
  if (list.some((preset) => preset.id !== id && preset.name.toLowerCase() === clean.toLowerCase())) throw new Error('You already have a style with that name.')
  return write({ ...prefs, presets: { ...prefs.presets, [k]: list.map((preset) => preset.id === id ? { ...preset, name: clean } : preset) } })
}

export function deletePreset(kind: unknown, id: unknown): MemberPrefs {
  const k = kindOf(kind)
  if (!isPresetId(id)) throw new Error('That style no longer exists.')
  const prefs = readMemberPrefs()
  return write({ ...prefs, presets: { ...prefs.presets, [k]: (prefs.presets[k] as StylePreset[]).filter((preset) => preset.id !== id) } })
}

/** The support link (or email), the finished-job notifications switch, the setup checklist and its sample video link, the default brand look, when to show the beat sheet. */
export function saveAppPrefs(update: unknown): MemberPrefs {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('Invalid preferences')
  const raw = update as Record<string, unknown>
  const prefs = readMemberPrefs()
  const next = { ...prefs }
  if ('supportLink' in raw) next.supportLink = parseSupportLink(raw.supportLink)
  if ('notifyOnFinish' in raw) {
    if (typeof raw.notifyOnFinish !== 'boolean') throw new Error('Invalid notification setting')
    next.notifyOnFinish = raw.notifyOnFinish
  }
  if ('setupChecklistDismissed' in raw) {
    if (typeof raw.setupChecklistDismissed !== 'boolean') throw new Error('Invalid checklist setting')
    next.setupChecklistDismissed = raw.setupChecklistDismissed
  }
  if ('sampleVideoLink' in raw) next.sampleVideoLink = parseSampleVideoLink(raw.sampleVideoLink)
  if ('defaultBrandId' in raw) next.defaultBrandId = parseDefaultBrandId(raw.defaultBrandId)
  if ('beatSheet' in raw) {
    if (!isBeatSheetChoice(raw.beatSheet)) throw new Error('Invalid beat sheet setting')
    next.beatSheet = raw.beatSheet
  }
  return write(next)
}

/** The member's profile (goals, platforms) and whether the guided setup is still to come. */
export function saveProfile(update: unknown): MemberPrefs {
  const prefs = readMemberPrefs()
  return write({ ...prefs, profile: parseProfileUpdate(update, prefs.profile) })
}
