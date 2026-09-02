/**
 * Helpers for recognising and deriving Gitea API endpoints.
 *
 * A Gitea instance serves its REST API under `/api/v1` on the same origin that
 * serves the web UI, e.g. the instance at `https://git.example.com` exposes its
 * API at `https://git.example.com/api/v1`. That suffix is what we use to tell a
 * Gitea endpoint apart from the GitHub endpoints the upstream code base was
 * written against.
 *
 * This module deliberately has no dependencies on `api.ts` or any other part of
 * the app so that it can be imported from the low level HTTP layer without
 * introducing an import cycle.
 */

import { ForgeFamily, GiteaAPIPath, getForgeFamily } from '../forges/forge-type'

export { GiteaAPIPath }

/** Strip any trailing slashes from a path or URL fragment. */
const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '')

/**
 * Whether or not the given API endpoint points at a Gitea instance.
 *
 * We consider any endpoint whose path ends in `/api/v1` to be Gitea, which
 * covers instances hosted under a sub path (`https://example.com/gitea`) as
 * well. Endpoints are only ever constructed by us (see `getGiteaAPIURL`) or
 * restored from a previously stored account, so this is a reliable marker
 * rather than a guess.
 */
export function isGiteaEndpoint(endpoint: string): boolean {
  return getForgeFamily(endpoint) === ForgeFamily.Gitea
}

/**
 * Derive the API endpoint for a Gitea instance from the URL of its web UI.
 *
 * https://git.example.com       -> https://git.example.com/api/v1
 * https://git.example.com/      -> https://git.example.com/api/v1
 * https://git.example.com/api/v1 -> https://git.example.com/api/v1
 *
 * Instances hosted under a sub path (`https://example.com/gitea`) are supported
 * as well, the API then lives at `https://example.com/gitea/api/v1`.
 */
export function getGiteaAPIURL(url: string): string {
  const parsed = new URL(url)
  const path = withoutTrailingSlash(parsed.pathname)

  if (path === GiteaAPIPath || path.endsWith(GiteaAPIPath)) {
    return `${parsed.origin}${path}`
  }

  return `${parsed.origin}${path}${GiteaAPIPath}`
}

/**
 * Derive the URL of the web UI from a Gitea API endpoint. This is the inverse
 * of `getGiteaAPIURL`.
 *
 * https://git.example.com/api/v1 -> https://git.example.com
 *
 * The result never carries a trailing slash, matching what `getHTMLURL` returns
 * for GitHub Enterprise Server. Several call sites append a path directly onto
 * it, so a trailing slash there would produce a double slash.
 */
export function getGiteaHTMLURL(endpoint: string): string {
  const parsed = new URL(endpoint)
  const path = withoutTrailingSlash(parsed.pathname)
  const base = path.endsWith(GiteaAPIPath)
    ? path.slice(0, path.length - GiteaAPIPath.length)
    : path

  return `${parsed.origin}${base}`
}
