// GSAP's core, as text, served to the custom graphics sandbox (custom-render.ts) from memory: the sandbox loads nothing
// from disk or the network. GSAP is bundled the same way for the template page (standard "no charge" license; its
// notice is in THIRD_PARTY_LICENSES.txt).
import gsapSource from 'gsap/dist/gsap.min.js?raw'

export const GSAP_SOURCE: string = gsapSource
