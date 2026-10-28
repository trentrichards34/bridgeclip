// Single source for product identity, shared by the main process (menu,
// window title) and the renderer.
export const APP_NAME = 'CreatorClips'
export const APP_TAGLINE = 'AI video clipping for creators'

/**
 * Release identity compiled in by electron.vite.config.ts (see
 * src/shared/release-identity.ts). Undefined when the source runs without that
 * build step (unit tests): then nothing is trusted to update the app.
 */
declare const __CREATORCLIPS_RELEASE__: { releasesRepository: string; macTeamId: string; windowsPublisher: string } | undefined
export const RELEASE_IDENTITY: Readonly<{ releasesRepository: string; macTeamId: string; windowsPublisher: string }> =
  typeof __CREATORCLIPS_RELEASE__ === 'object' && __CREATORCLIPS_RELEASE__
    ? __CREATORCLIPS_RELEASE__
    : { releasesRepository: 'trentrichards34/creatorclips-releases', macTeamId: '', windowsPublisher: '' }

/** The public page members download from. The source repository is private. */
export const REPO_URL = `https://github.com/${RELEASE_IDENTITY.releasesRepository}`
export const ISSUES_URL = `${REPO_URL}/issues`
export const RELEASES_URL = `${REPO_URL}/releases`
export const LICENSE_NAME = 'MIT'
export const BRIDGEMIND_URL = 'https://www.bridgemind.ai'
export const DISCORD_URL = 'https://www.bridgemind.ai/discord'

export const PROVIDER_LINKS = {
  openrouter: 'https://openrouter.ai/keys',
  zernio: 'https://zernio.com/dashboard/api-keys',
  pexels: 'https://www.pexels.com/api/',
  fal: 'https://fal.ai/dashboard/keys',
  heygen: 'https://platform.heygen.com/api-keys'
} as const

/** Where members see their real bills and add credit (Settings → Spending). */
export const SPENDING_LINKS = {
  openrouterCredits: 'https://openrouter.ai/settings/credits',
  openrouterActivity: 'https://openrouter.ai/activity',
  falBilling: 'https://fal.ai/dashboard/billing',
  /** HeyGen's self-serve API plans and credit (from developers.heygen.com/llms.txt). */
  heygenBilling: 'https://platform.heygen.com/pricing',
  /** HeyGen's published API prices, the source of the app's HeyGen estimates. */
  heygenPricing: 'https://developers.heygen.com/docs/pricing'
} as const

export const ZERNIO_LINKS = {
  signup: 'https://zernio.com/signup',
  pricing: 'https://zernio.com/pricing',
  billing: 'https://zernio.com/dashboard/billing'
} as const
