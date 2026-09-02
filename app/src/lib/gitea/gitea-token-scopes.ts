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
  'read:user',
  'write:repository',
  'write:issue',
  'write:organization',
]

/** The scope list as shown to the user. */
export const formatTokenScopes = () => RequiredTokenScopes.join(', ')
