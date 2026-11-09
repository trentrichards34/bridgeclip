/**
 * Custom graphics' IPC: the review's and the editor's calls (see edit-custom-graphics.ts and editor-custom-graphics.ts),
 * and, in end-to-end tests only, the test hook.
 */
import { app } from 'electron'
import { customGraphicBake, customGraphicJob, installCustomGraphicsTestHook } from './custom-graphics'
import { setCustomGraphicProvider } from './graphics-render'

export function registerCustomGraphics(): void {
  setCustomGraphicProvider({ job: customGraphicJob, bake: customGraphicBake })
  if (!app.isPackaged && process.env.BRIDGECLIP_E2E === '1') installCustomGraphicsTestHook()
}
