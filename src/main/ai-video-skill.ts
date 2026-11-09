import { app, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, statSync } from 'fs'
import { cp, mkdir, rm, stat } from 'fs/promises'
import { isAbsolute, join, resolve } from 'path'
import { isWithinDirectory } from './security'

/**
 * AI explainers: a third-party skill (shipped unchanged in resources/ai-video-skill) that members run in their own
 * Claude. CreatorClips only saves a copy of the folder where they choose; it never runs it.
 */

/** The saved folder's name; "AI Video 2", "AI Video 3"... when it is taken. */
export const AI_VIDEO_FOLDER_NAME = 'AI Video'
/** How many numbered names to try before giving up. */
const MAX_NAME_TRIES = 999

/** The bundled skill folder: next to the app in a packaged build, the repo's resources/ in development. */
export function bundledSkillDir(): string {
  return app.isPackaged
    ? resolve(join(process.resourcesPath, 'ai-video-skill'))
    : resolve(join(__dirname, '..', '..', 'resources', 'ai-video-skill'))
}

/** A folder that looks like the skill's workspace (its start page and the skill itself). */
export function isSkillFolder(dir: unknown): dir is string {
  if (typeof dir !== 'string' || !isAbsolute(dir)) return false
  try {
    return statSync(dir).isDirectory() && existsSync(join(dir, 'START HERE.md')) && existsSync(join(dir, 'skill', 'SKILL.md'))
  } catch {
    return false
  }
}

export function aiVideoSkillInfo(): { available: boolean } {
  return { available: isSkillFolder(bundledSkillDir()) }
}

/** "AI Video", then "AI Video 2", "AI Video 3"... */
export function folderNameFor(attempt: number, base = AI_VIDEO_FOLDER_NAME): string {
  return attempt <= 1 ? base : `${base} ${attempt}`
}

/**
 * Claims a new, empty folder for the copy in `parent`: the first free name, created at once so two saves never
 * pick the same one. Anything already there (a folder or a file) is left alone.
 */
async function claimFolder(parent: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_NAME_TRIES; attempt++) {
    const target = join(parent, folderNameFor(attempt))
    try {
      await mkdir(target)
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error(`There are already too many "${AI_VIDEO_FOLDER_NAME}" folders here. Choose another folder.`)
}

/**
 * Copies the skill folder (everything in it, dotfolders included) into a new "AI Video" folder inside `parent` and
 * returns the new folder's path. Never overwrites: an existing "AI Video" gets a numbered sibling instead.
 */
export async function copySkillFolder(source: unknown, parent: unknown): Promise<string> {
  if (!isSkillFolder(source)) throw new Error('The AI video skill is missing from this copy of CreatorClips. Reinstall CreatorClips, then try again.')
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new Error('Choose a folder to save the AI video skill in.')
  const where = resolve(parent)
  let info
  try { info = await stat(where) } catch { throw new Error('That folder could not be found. Choose another folder.') }
  if (!info.isDirectory()) throw new Error('Choose a folder to save the AI video skill in.')
  if (isWithinDirectory(where, resolve(source))) throw new Error('Choose a folder outside CreatorClips to save the AI video skill in.')
  const target = await claimFolder(where)
  try {
    await cp(source, target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true })
  } catch (error) {
    // Only the folder made just now is removed: a half copy would not work.
    await rm(target, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return target
}

/** Folders saved in this session: the only ones "Show in Finder" opens. */
const savedFolders = new Set<string>()

/** Asks where to save (Documents to start), copies the skill there and shows it. Null when cancelled. */
export async function saveAiVideoSkill(window: BrowserWindow | null): Promise<string | null> {
  if (!window) return null
  const source = bundledSkillDir()
  if (!isSkillFolder(source)) throw new Error('The AI video skill is missing from this copy of CreatorClips. Reinstall CreatorClips, then try again.')
  const result = await dialog.showOpenDialog(window, {
    title: `Choose where to save the "${AI_VIDEO_FOLDER_NAME}" folder`,
    buttonLabel: 'Save here',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  const saved = await copySkillFolder(source, result.filePaths[0])
  savedFolders.add(saved)
  shell.showItemInFolder(saved)
  return saved
}

/** Shows a folder saved by saveAiVideoSkill in Finder (Explorer on Windows). */
export function revealAiVideoSkill(path: unknown): boolean {
  if (typeof path !== 'string' || !savedFolders.has(path) || !existsSync(path)) return false
  shell.showItemInFolder(path)
  return true
}
