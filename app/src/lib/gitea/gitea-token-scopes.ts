import { ForgeFamily } from '../forges/forge-type'

/**
 * The scopes a Gitea personal access token needs for Lodestone to work.
 *
 * Gitea derives the required scope level from the HTTP method: a GET under
 * `/orgs/{org}` needs `read:organization`, a POST needs `write:organization`.
 * Publishing a repository into an organisation is a POST to
 * `orgs/{org}/repos`, so listing only `read:organization` here produces a token
 * that can show the organisation in the publish dialog but not publish to it,
 * and the failure looks like a permissions problem on the organisation rather
 * than a missing scope.
 *
 * Keep this list as the single source of truth: it is shown to the user in both
 * sign-in surfaces, and getting it wrong is not something they can diagnose.
 */
export const RequiredTokenScopes = [
  // `POST user/repos` publishes to the personal account, and Gitea reads the
  // level off the method, so listing `read:user` produces a token that cannot
  // publish anywhere.
  'write:user',
  'write:repository',
  // Issues and pull requests are only ever read; nothing here writes one.
  'read:issue',
  // Publishing into an organisation is `POST orgs/{org}/repos`.
  'write:organization',
]

/**
 * The scopes a GitHub personal access token needs.
 *
 * A different vocabulary entirely: GitHub grants by area rather than by verb,
 * and none of the Gitea scope names above exists there. These are the same
 * three the app asks for over OAuth.
 */
export const RequiredGitHubTokenScopes = ['repo', 'user', 'workflow']

/**
 * The scope list to show somebody creating a token, for the provider they are
 * actually creating it on.
 */
export const formatTokenScopes = (family: ForgeFamily) =>
  (family === ForgeFamily.GitHub
    ? RequiredGitHubTokenScopes
    : RequiredTokenScopes
  ).join(', ')
