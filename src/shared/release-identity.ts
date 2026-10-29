// Who publishes and signs official CreatorClips builds. Read once, at build
// time, by electron.vite.config.ts and compiled into the app as
// `__CREATORCLIPS_RELEASE__`, so a packaged app can't be pointed elsewhere
// after the fact (app.asar is integrity-checked; see electron-builder.yml).

export interface ReleaseIdentity {
  /** Public GitHub repository (`owner/repo`) that holds installers and update feeds. */
  releasesRepository: string
  /**
   * Apple Developer team ID that signs official macOS builds. Empty: no
   * macOS build of this compile updates itself.
   */
  macTeamId: string
  /**
   * Authenticode publisher (certificate subject CN) of official Windows
   * builds. Empty: the Windows build is unsigned and does not update itself.
   */
  windowsPublisher: string
}

/** Wealthery's public, installers-only releases repository. */
export const DEFAULT_RELEASES_REPOSITORY = 'trentrichards34/creatorclips-releases'

/**
 * The identity for a build, from the environment of `electron-vite build`:
 * CREATORCLIPS_RELEASES_REPO, CREATORCLIPS_MAC_TEAM_ID, CREATORCLIPS_WIN_PUBLISHER.
 * There is deliberately no default signer: a build nobody vouched for stays
 * off the update channel.
 */
export function releaseIdentityFromEnv(env: Record<string, string | undefined>): ReleaseIdentity {
  const releasesRepository = (env.CREATORCLIPS_RELEASES_REPO || DEFAULT_RELEASES_REPOSITORY).trim()
  const macTeamId = (env.CREATORCLIPS_MAC_TEAM_ID || '').trim()
  const windowsPublisher = (env.CREATORCLIPS_WIN_PUBLISHER || '').trim()
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(releasesRepository)) {
    throw new Error('CREATORCLIPS_RELEASES_REPO must look like owner/repo')
  }
  // Apple team IDs are ten uppercase letters and digits.
  if (macTeamId && !/^[A-Z0-9]{10}$/.test(macTeamId)) {
    throw new Error('CREATORCLIPS_MAC_TEAM_ID must be a 10-character Apple team ID, like ABCDE12345')
  }
  if (windowsPublisher && !/^[^\r\n"]{1,128}$/.test(windowsPublisher)) {
    throw new Error('CREATORCLIPS_WIN_PUBLISHER must be a single line')
  }
  return { releasesRepository, macTeamId, windowsPublisher }
}
