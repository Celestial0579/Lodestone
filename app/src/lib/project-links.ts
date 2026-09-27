/**
 * Where this build of Lodestone lives.
 *
 * The app points at its own repository in three places: the update check, the
 * crash reporter's issue tracker link, and the help menu. Keeping the address
 * here means a fork only has to change it once.
 */

/** The repository this build is published from. */
export const ProjectRepositoryURL = 'https://github.com/Celestial0579/Lodestone'

/**
 * Addresses this project was published from before, newest first.
 *
 * Builds up to v1.0.0-beta.2 were published from a Forgejo instance that has
 * since been retired. Nothing links there any more; the list exists so that an
 * update source still naming one of these can be recognised as the old
 * default rather than as a deliberate choice. See `getUpdateSourceURL`.
 */
export const RetiredProjectRepositoryURLs: ReadonlyArray<string> = [
  'https://git.firestrike.de/tim.heyne/Lodestone',
]

/** Where users report problems with this build. */
export const ProjectIssuesURL = `${ProjectRepositoryURL}/issues`

/** Where users file a new problem report. */
export const ProjectNewIssueURL = `${ProjectIssuesURL}/new`
