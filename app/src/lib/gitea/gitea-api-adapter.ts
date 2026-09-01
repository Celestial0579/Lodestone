/**
 * Translation layer between the GitHub REST API this app was written against
 * and the Gitea REST API (`/api/v1`) it actually talks to.
 *
 * The rest of the app is deliberately left unaware of Gitea: it keeps calling
 * the GitHub shaped endpoints in `api.ts`, and every one of those calls funnels
 * through `request` in `http.ts`. When the endpoint belongs to a Gitea instance
 * that function delegates here, and we
 *
 *  1. rewrite the request path and query string to their Gitea equivalents,
 *  2. answer GitHub-only endpoints locally instead of hitting the server, and
 *  3. reshape the response body so it matches what the caller expects.
 *
 * Keeping the translation in one place means upstream changes to the app can be
 * merged without conflicting with the Gitea support.
 */

import { coreRequest, HTTPMethod } from '../http-core'

/** Everything needed to perform (or fake) a single API request. */
export interface IGiteaRequestOptions {
  readonly endpoint: string
  readonly token: string | null
  readonly method: HTTPMethod
  readonly path: string
  readonly jsonBody?: Object
  readonly customHeaders?: Object
  readonly reloadCache: boolean
}

/**
 * How a GitHub API route is served against Gitea.
 *
 * `rewrite`    - send a different path to the server
 * `transform`  - reshape the successful response body
 * `synthesize` - never touch the network, answer with this body instead
 * `notFound`   - the feature does not exist in Gitea, answer with a 404
 */
interface IGiteaRoute {
  readonly rewrite?: string
  readonly transform?: (json: any) => any
  readonly synthesize?: () => any
  readonly notFound?: true
}

const isPlainObject = (value: any): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Gitea repository payloads carry almost everything the app needs but name a
 * few things differently, and omit `pushed_at` entirely. Rather than teaching
 * every call site about that we normalise repositories and users wherever they
 * appear in a response, including nested ones such as the head and base
 * repositories of a pull request.
 */
function normalizePayload(value: any): any {
  if (Array.isArray(value)) {
    return value.map(normalizePayload)
  }

  if (!isPlainObject(value)) {
    return value
  }

  const result: Record<string, any> = {}
  for (const [key, nested] of Object.entries(value)) {
    result[key] = normalizePayload(nested)
  }

  // A repository, identified by its clone URL which no other payload carries.
  if (typeof result['clone_url'] === 'string') {
    // Gitea tracks a single `updated_at` timestamp whereas the app sorts and
    // filters repositories by `pushed_at`, so fall back to it.
    result['pushed_at'] ??= result['updated_at'] ?? null
    result['has_issues'] ??= true
    result['archived'] ??= false
    return result
  }

  // A user or an organisation. Gitea calls the display name `full_name`.
  if (typeof result['login'] === 'string') {
    result['name'] ??= result['full_name'] ?? result['login']
    result['type'] ??=
      result['is_organization'] === true ? 'Organization' : 'User'
    return result
  }

  return result
}

/** Map a Gitea user onto the shape the mentionables cache expects. */
const toMentionable = (user: any) => ({
  login: user?.login ?? '',
  name: user?.full_name || user?.login || '',
  avatar_url: user?.avatar_url ?? '',
  email: user?.email ?? null,
})

/**
 * Split a path into its route and query string so routes can be matched without
 * having to account for query parameters.
 */
const splitPath = (path: string) => {
  const index = path.indexOf('?')
  return index === -1
    ? { route: path, query: '' }
    : { route: path.substring(0, index), query: path.substring(index + 1) }
}

/**
 * Gitea reads its pagination size from `limit`, not `per_page`, and caps it at
 * the instance's `MAX_RESPONSE_ITEMS`. Passing `per_page` through unchanged
 * would silently give us the default page size for every paged request.
 */
function translateQuery(query: string): string {
  if (query === '') {
    return ''
  }

  const params = new URLSearchParams(query)
  const perPage = params.get('per_page')

  if (perPage !== null) {
    params.delete('per_page')
    params.set('limit', perPage)
  }

  // Branch protection is filtered client side, see the branches route below.
  params.delete('protected')

  const result = params.toString()
  return result === '' ? '' : `?${result}`
}

const stripLeadingSlash = (path: string) =>
  path.startsWith('/') ? path.substring(1) : path

/**
 * Determine how a given GitHub API route should be served against Gitea.
 * Returns `undefined` when the route works as-is, which is true for the large
 * majority of what Desktop uses.
 */
function resolveRoute(
  method: HTTPMethod,
  route: string
): IGiteaRoute | undefined {
  // Endpoint discovery. Desktop probes `/meta`, Gitea reports its version at
  // `/version` and has no equivalent for the rest of that payload.
  if (route === 'meta') {
    return {
      rewrite: 'version',
      transform: (json: any) => ({
        installed_version: json?.version ?? '',
        verifiable_password_authentication: false,
      }),
    }
  }

  // GraphQL backs the Copilot integration only. Gitea has no GraphQL API.
  if (route === 'graphql') {
    return { notFound: true }
  }

  // GitHub.com-only realtime plumbing ("Alive") used to push notifications.
  if (
    route.startsWith('desktop_internal/') ||
    route.startsWith('alive_internal/')
  ) {
    return { notFound: true }
  }

  const repoMatch = /^repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(route)

  if (repoMatch === null) {
    return undefined
  }

  const [, owner, name, rest] = repoMatch

  // Check runs are a GitHub Actions concept. Gitea reports CI state through
  // commit statuses, which Desktop fetches separately and merges in.
  if (/^commits\/.+\/check-runs$/.test(rest)) {
    return { synthesize: () => ({ total_count: 0, check_runs: [] }) }
  }

  if (rest.startsWith('check-suites/')) {
    return { notFound: true }
  }

  // Repository rulesets have no Gitea counterpart. Branch protection is
  // surfaced through the `protected` flag on each branch instead.
  if (rest === 'rulesets' || rest.startsWith('rulesets/')) {
    return { synthesize: () => [] }
  }

  if (rest.startsWith('rules/branches/')) {
    return { synthesize: () => [] }
  }

  // Push protection for leaked secrets is a GitHub Advanced Security feature.
  if (rest.startsWith('secret-scanning/')) {
    return { notFound: true }
  }

  // Desktop asks for `branches?protected=true`. Gitea returns every branch with
  // a `protected` flag, so fetch the whole list and filter it here.
  if (rest === 'branches' && method === 'GET') {
    return {
      transform: (json: any) =>
        Array.isArray(json)
          ? json.filter((branch: any) => branch?.protected === true)
          : json,
    }
  }

  // Gitea has no mentionables endpoint. The set of users that can be assigned
  // to an issue is the closest equivalent and needs no special permissions.
  if (rest === 'mentionables/users') {
    return {
      rewrite: `repos/${owner}/${name}/assignees`,
      transform: (json: any) =>
        Array.isArray(json) ? json.map(toMentionable) : [],
    }
  }

  return undefined
}

/** Build a response that never went over the wire. */
function localResponse(body: any, status: number): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    headers: { 'Content-Type': 'application/json', 'X-Gitea-Desktop': 'local' },
  })
}

/**
 * Replace a response body while keeping its status and headers intact, the
 * `Link` header in particular since that drives pagination.
 */
async function replaceBody(
  response: Response,
  transform: (json: any) => any
): Promise<Response> {
  if (!response.ok || response.status === 204) {
    return response
  }

  let json: any
  try {
    json = await response.clone().json()
  } catch {
    // Not JSON, or empty. Hand the original response back untouched.
    return response
  }

  return new Response(JSON.stringify(transform(json)), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Perform an API request against a Gitea instance, translating both the request
 * and the response between the GitHub shape the app expects and the Gitea shape
 * the server speaks.
 */
export async function giteaRequest(
  options: IGiteaRequestOptions
): Promise<Response> {
  const { endpoint, token, method, jsonBody, customHeaders, reloadCache } =
    options

  const { route, query } = splitPath(stripLeadingSlash(options.path))
  const resolved = resolveRoute(method, route)

  if (resolved?.notFound === true) {
    return localResponse(
      { message: 'This endpoint is not available on Gitea.' },
      404
    )
  }

  if (resolved?.synthesize !== undefined) {
    return localResponse(resolved.synthesize(), 200)
  }

  const translatedPath = `${resolved?.rewrite ?? route}${translateQuery(query)}`

  // Gitea authenticates personal access tokens with the `token` scheme. The
  // `Bearer` scheme is reserved for OAuth2 access tokens on older releases.
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(customHeaders as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `token ${token}`
  }

  const response = await coreRequest(
    endpoint,
    null,
    method,
    translatedPath,
    jsonBody,
    headers,
    reloadCache
  )

  const transform = resolved?.transform ?? normalizePayload
  return replaceBody(response, transform)
}
