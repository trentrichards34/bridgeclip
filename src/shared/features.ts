/**
 * Launch switches for whole tools. A tool switched off keeps all its code, IPC handlers and engine
 * work: only the ways a member reaches it are hidden. Flip the constant to bring it back.
 */

/**
 * Avatar Studio (avatar videos, Top lists, and Remix's AI presenter, which needs its avatars).
 * Off for launch: the sidebar item, its shortcut, the setup and plan steps, Remix's "AI presenter"
 * and the assistant's avatar tools are hidden. Avatar videos already in the Library still show and play.
 */
export const AVATAR_STUDIO_ENABLED = false

/** The renderer's copy of the e2e switch, passed by the main process as a launch argument the preload reads. */
export const AVATAR_STUDIO_E2E_ARG = '--bridgeclip-e2e-avatar-studio'

/** Tests only: Avatar Studio on although the switch is off (BRIDGECLIP_E2E_AVATAR_STUDIO=1 in an e2e run). */
let avatarStudioForTests = rendererTestOverride()

function rendererTestOverride(): boolean {
  const bridge = (globalThis as { bridgeclip?: { features?: { avatarStudio?: boolean } } }).bridgeclip
  return bridge?.features?.avatarStudio === true
}

/** Main process (e2e runs only) and renderer unit tests. */
export function setAvatarStudioForTests(on: boolean): void {
  avatarStudioForTests = on
}

/** Whether members can reach Avatar Studio and make new avatar videos. */
export function isAvatarStudioEnabled(): boolean {
  return AVATAR_STUDIO_ENABLED || avatarStudioForTests
}
