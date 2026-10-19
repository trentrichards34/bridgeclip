// Single source for product identity, shared by the main process (menu,
// window title) and the renderer.
export const APP_NAME = 'CreatorClips'
export const APP_TAGLINE = 'Open-source AI video clipping'

export const REPO_URL = 'https://github.com/trentrichards34/bridgeclip'
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
