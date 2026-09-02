/**
 * Where this build of Gitea Desktop lives.
 *
 * The app points at its own repository in three places: the update check, the
 * crash reporter's issue tracker link, and the help menu. Keeping the address
 * here means a fork only has to change it once.
 */

/** The repository this build is published from. */
export const ProjectRepositoryURL =
  'https://git.firestrike.de/tim.heyne/Gitea_Desktop'

/** Where users report problems with this build. */
export const ProjectIssuesURL = `${ProjectRepositoryURL}/issues`

/** Where users file a new problem report. */
export const ProjectNewIssueURL = `${ProjectIssuesURL}/new`
