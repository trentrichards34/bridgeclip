import { systemPreferences } from 'electron'

/**
 * Camera and microphone, for "Me, on camera" recordings in Remix. Only the
 * app's own page may ask, only for capture (not screen sharing), and every
 * other permission stays denied.
 */
export function isAppPage(url: string, devUrl: string | undefined): boolean {
  try {
    const page = new URL(url)
    if (page.protocol === 'file:') return true
    return Boolean(devUrl) && page.origin === new URL(devUrl as string).origin
  } catch { return false }
}

export function allowMediaRequest(permission: string, url: string, mediaTypes: readonly string[] | undefined, devUrl: string | undefined): boolean {
  if (permission !== 'media' || !isAppPage(url, devUrl)) return false
  const types = mediaTypes ?? []
  return types.length > 0 && types.every((type) => type === 'video' || type === 'audio')
}

export function allowMediaCheck(permission: string, origin: string, devUrl: string | undefined): boolean {
  return permission === 'media' && isAppPage(origin, devUrl)
}

/** macOS asks the user once per device; elsewhere access is decided by the system settings. */
export async function requestMediaAccess(): Promise<{ camera: boolean; microphone: boolean }> {
  if (process.platform !== 'darwin') return { camera: true, microphone: true }
  const ask = async (kind: 'camera' | 'microphone'): Promise<boolean> => {
    const status = systemPreferences.getMediaAccessStatus(kind)
    if (status === 'granted') return true
    if (status === 'denied' || status === 'restricted') return false
    try { return await systemPreferences.askForMediaAccess(kind) } catch { return false }
  }
  const camera = await ask('camera')
  const microphone = await ask('microphone')
  return { camera, microphone }
}

/**
 * Whether the camera and microphone may be used, without asking: true or false
 * where the system says (macOS, Windows), null when it can't tell yet ("not
 * determined": the first recording asks). Linux has no system switch.
 */
export function mediaAccessStatus(): { camera: boolean | null; microphone: boolean | null } {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return { camera: true, microphone: true }
  const read = (kind: 'camera' | 'microphone'): boolean | null => {
    try {
      const status = systemPreferences.getMediaAccessStatus(kind)
      return status === 'granted' ? true : status === 'denied' || status === 'restricted' ? false : null
    } catch { return null }
  }
  return { camera: read('camera'), microphone: read('microphone') }
}
