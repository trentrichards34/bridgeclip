/**
 * The Explainer style's layout numbers (no imports: custom-graphics, graphic-layout and explainer all read them).
 */
/** The longest an Explainer section's composition lasts (motion-graphics CUSTOM_GRAPHIC_MAX_MS). */
export const CUSTOM_SECTION_MAX_MS = 30000
/** The Explainer's canvas band (shares of a 9:16 frame): from the section line at the top down to just over the speaker's head. */
export const EXPLAINER_BAND = { top: 0.02, bottom: 0.585 } as const
/** Inside that band, the captions' zone (frame shares) the canvas keeps empty. */
export const EXPLAINER_CAPTION_ZONE = { top: 0.06, bottom: 0.178 } as const
/** The Explainer's paper, ink and accent (without a brand color that reads on paper). */
export const EXPLAINER_PAPER = '#F4F1EA'
export const EXPLAINER_INK = '#161616'
export const EXPLAINER_ACCENT = '#E8412C'
