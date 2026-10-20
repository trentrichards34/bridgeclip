/**
 * "A look you like": the member's reference image for Create, Edit my
 * recording and Remix (see shared/purpose.ts).
 *
 * A picture chosen in the file dialog is checked here (PNG, JPEG or WebP by its
 * bytes, 8 MB at most) and copied into the app's data folder under a random id;
 * the page only ever sends that id back. When a run starts, the picture is
 * copied into the run folder (kept with the video), and handed to the planning
 * call only when the planning model accepts images (OpenRouter's model list).
 */
import { app } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import {
  REFERENCE_EXTENSIONS, REFERENCE_MAX_BYTES, imageDimensions, isReferenceId, plannerModelFor, referenceCostUsd, referenceImageTokens, referenceKind,
  type ReferenceImage, type ReferenceSupport
} from '../shared/purpose'
import { isModelId } from '../shared/openrouter-models'
import { getModelCatalog } from './openrouter-models'
import { authorizeMedia } from './security'
import { logger } from './logger'

/** Pictures kept in the app's data folder; older ones are removed when more are added (a run keeps its own copy). */
const MAX_KEPT = 40

export function referencesFolder(): string {
  return join(app.getPath('userData'), 'references')
}

/** A picture's bytes, checked: its kind and size, or a plain error. */
export function checkReferenceBytes(bytes: Uint8Array): { kind: 'png' | 'jpg' | 'webp'; width: number; height: number } {
  if (bytes.byteLength > REFERENCE_MAX_BYTES) throw new Error(`Use a picture under ${REFERENCE_MAX_BYTES / 1024 / 1024} MB.`)
  const kind = referenceKind(bytes)
  if (!kind) throw new Error('Use a PNG, JPEG or WebP picture.')
  const size = imageDimensions(bytes)
  if (!size) throw new Error('That picture could not be read. Try another one, or save it again as PNG or JPEG.')
  return { kind, ...size }
}

/** Copy a picture the member chose in the file dialog into the app's data folder. */
export async function addReferenceFile(path: string): Promise<ReferenceImage> {
  if (!REFERENCE_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) throw new Error('Use a PNG, JPEG or WebP picture.')
  let size: number
  try { size = statSync(path).size } catch { throw new Error('That picture could not be opened.') }
  if (size > REFERENCE_MAX_BYTES) throw new Error(`Use a picture under ${REFERENCE_MAX_BYTES / 1024 / 1024} MB.`)
  const bytes = new Uint8Array(await readFile(path))
  const { kind, width, height } = checkReferenceBytes(bytes)
  const folder = referencesFolder()
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const id = randomBytes(12).toString('hex')
  const copy = join(folder, `${id}.${kind}`)
  await writeFile(copy, bytes, { mode: 0o600, flag: 'wx' })
  await pruneReferences(folder).catch(() => undefined)
  // eslint-disable-next-line no-control-regex
  const name = basename(path).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || `reference.${kind}`
  return { id, name, path: authorizeMedia(copy), width, height, bytes: bytes.byteLength }
}

async function pruneReferences(folder: string): Promise<void> {
  const files = readdirSync(folder).filter((name) => /^[a-f0-9]{24}\.(png|jpg|webp)$/.test(name))
    .map((name) => ({ name, at: statSync(join(folder, name)).mtimeMs })).sort((a, b) => b.at - a.at)
  for (const old of files.slice(MAX_KEPT)) await rm(join(folder, old.name), { force: true })
}

/** The kept copy of a picture by its id (a plain error when it's gone). */
export function referencePath(id: unknown): string {
  if (!isReferenceId(id)) throw new Error('Choose your reference image again.')
  for (const kind of ['png', 'jpg', 'webp']) {
    const path = join(referencesFolder(), `${id}.${kind}`)
    if (existsSync(path)) return path
  }
  throw new Error('Your reference image is no longer there. Choose it again.')
}

/** The kept picture's bytes (the page works out a suggested look from them, on this computer). */
export async function referenceBytes(id: unknown): Promise<Uint8Array> {
  return new Uint8Array(await readFile(referencePath(id)))
}

/** Whether this planning model can look at a picture, and about what the picture adds. Unknown (null) when the list can't be read. */
export async function referenceSupport(model: string, id: unknown): Promise<ReferenceSupport> {
  const size = imageDimensions(new Uint8Array(await readFile(referencePath(id))))
  const tokens = size ? referenceImageTokens(size.width, size.height) : 0
  try {
    const catalog = await getModelCatalog()
    const listed = catalog.planning.find((item) => item.id === model) ?? catalog.assistant.find((item) => item.id === model) ?? null
    if (!listed) return { model, modelName: null, supportsImages: null, tokens, costUsd: null }
    return { model, modelName: listed.name, supportsImages: listed.supportsImages, tokens, costUsd: referenceCostUsd(tokens, listed.inputPrice) }
  } catch {
    return { model, modelName: null, supportsImages: null, tokens, costUsd: null }
  }
}

/** The page's question: this picture with the planner a run would use (Create sends its mode and model). */
export function referenceSupportFor(id: unknown, model: unknown): Promise<ReferenceSupport> {
  const raw = model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, unknown> : {}
  const mode = raw.clippingMode === 'quality' || raw.clippingMode === 'economy' || raw.clippingMode === 'advanced' ? raw.clippingMode : undefined
  const planner = mode === 'advanced' && isModelId(raw.plannerModel) ? raw.plannerModel : undefined
  return referenceSupport(plannerModelFor(mode, planner), id)
}

/**
 * For a run starting now: the picture copied into its folder (always kept), and the path to send to the planning
 * call only when the model accepts images. The note says why it was skipped.
 */
export async function referenceForRun(id: unknown, folder: string, model: string): Promise<{ saved: string; send: string | null; note: string | null }> {
  const source = referencePath(id)
  await mkdir(folder, { recursive: true })
  const saved = join(folder, `reference${extname(source)}`)
  await copyFile(source, saved)
  const support = await referenceSupport(model, id)
  if (support.supportsImages) return { saved, send: saved, note: null }
  logger.info('reference.skipped', { model, known: support.supportsImages !== null })
  return { saved, send: null, note: support.supportsImages === false ? 'Your model can’t look at images; the reference is skipped. It’s saved with the video.' : 'The model list couldn’t be checked, so the reference image was skipped. It’s saved with the video.' }
}
