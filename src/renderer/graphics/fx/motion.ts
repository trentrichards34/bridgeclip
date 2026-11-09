/**
 * Shared motion for the Effects adapter and the timelines CreatorClips adds to HyperFrames snippets, tuned to the
 * measured pro moves in motionmaxxing (Apache-2.0; SKILL.md "Craft laws", references/motion.md): entries decelerate
 * (most travel in the first 4-8 frames, then a long tail, no bounce) and arrive from slight oversize, never from
 * zero; exits ease in and leave or shrink rather than just fading; a median move is about 10 frames at 30 fps;
 * words land 2-12 frames apart at speech rhythm. Snippet timelines read these as `window.__ccMotion`.
 */
export const FX_MOTION = {
  /** A typical move (10 frames at 30 fps). */
  move_s: 10 / 30,
  /** Entries: fast start, long tail, no overshoot. */
  enter: 'expo.out',
  /** Exits: ease in, then gone. */
  exit: 'power2.in',
  /** Arrive from this much oversize. */
  from_scale: 1.08,
  /** Words or items land this far apart (6 frames: a headline's rhythm). */
  stagger_s: 6 / 30,
  /** The graphic's own leave at its end (ms): it shrinks a little as it goes. */
  out_ms: 240,
  out_scale: .96,
  /** A glass backing leaves over this long (ms): as long as the units' own exits (a slam's lift), never empty. */
  glass_out_ms: 460
} as const

/** Ease-in for the adapter's own exit (power2.in). */
export const easeIn = (p: number): number => Math.max(0, Math.min(1, p)) ** 2
