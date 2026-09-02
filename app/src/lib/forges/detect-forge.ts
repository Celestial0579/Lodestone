/**
 * Identifying which forge product an endpoint belongs to.
 *
 * The family follows from the URL, but telling Gitea from Forgejo needs asking
 * the server. Two signals, both checked against live instances on 2026-09-02:
 *
 *  - `GET <base>/api/forgejo/v1/version` answers 200 on Forgejo and 404 on
 *    Gitea. codeberg.org answered 200, gitea.com and a private Gitea 1.27.3
 *    both answered 404. This is the authoritative test.
 *  - The version string itself gives it away without a second request: Forgejo
 *    reports `16.0.0-dev-714-11075108+gitea-1.22.0`, Gitea reports `1.27.3`.
 *
 * There is deliberately no header check. Forgejo instances do send
 * `x-server-name` and `x-backend-name`, but those come from Codeberg's proxy,
 * not from the application, and are absent elsewhere.
 */

import { getUserAgent } from '../http-core'
import { ForgeFamily, ForgeKind, guessGiteaKindFromVersion } from './forge-type'
import { getKnownForge, recordForge } from './forge-registry'

/** The web origin and base path an API endpoint belongs to. */
function getInstanceBase(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    const path = url.pathname.replace(/\/+$/, '')
    const base = path.endsWith('/api/v1')
      ? path.slice(0, path.length - '/api/v1'.length)
      : path

    return `${url.origin}${base}`
  } catch {
    return null
  }
}

async function fetchJson(url: string, token: string | null, timeoutMs = 4000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'user-agent': getUserAgent(),
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
      signal: controller.signal,
      credentials: 'omit',
    })

    return response.ok ? await response.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Work out which product serves this endpoint and remember the answer.
 *
 * Safe to call repeatedly: it returns early once the endpoint has been
 * identified. Never throws; an unreachable instance simply stays unverified.
 */
export async function detectForge(
  endpoint: string,
  token: string | null = null
): Promise<ForgeKind> {
  const known = getKnownForge(endpoint)

  if (known.verified) {
    return known.kind
  }

  if (known.family === ForgeFamily.GitHub) {
    // The GitHub side is already told apart by endpoint-capabilities, which
    // needs no probe: the hostnames are known.
    return known.kind
  }

  const base = getInstanceBase(endpoint)

  if (base === null) {
    return ForgeKind.Unknown
  }

  const version = await fetchJson(`${base}/api/v1/version`, token)
  const reported = typeof version?.version === 'string' ? version.version : null

  // The version alone usually settles it; only ask a second time when it does
  // not, or when it says Gitea and we want to be sure it is not a Forgejo that
  // reports a Gitea-shaped version.
  const guess = guessGiteaKindFromVersion(reported)

  if (guess === ForgeKind.Forgejo) {
    recordForge(endpoint, {
      kind: ForgeKind.Forgejo,
      version: reported,
      verified: true,
    })
    return ForgeKind.Forgejo
  }

  const forgejo = await fetchJson(`${base}/api/forgejo/v1/version`, token)
  const kind =
    forgejo !== null
      ? ForgeKind.Forgejo
      : reported !== null
      ? ForgeKind.Gitea
      : ForgeKind.Unknown

  recordForge(endpoint, {
    kind,
    version: reported,
    // An unreachable instance is not evidence of anything, so leave it open.
    verified: kind !== ForgeKind.Unknown,
  })

  return kind
}
