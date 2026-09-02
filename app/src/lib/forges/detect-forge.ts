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

/** What an address turned out to be, and where its API lives. */
export interface IResolvedInstance {
  readonly kind: ForgeKind
  readonly family: ForgeFamily
  /** The API endpoint to store on the account. */
  readonly endpoint: string
  /** The web address, for links shown to the user. */
  readonly htmlURL: string
  readonly version: string | null
}

/**
 * Work out what forge runs at an address the user typed.
 *
 * No forge is privileged here. The same probe decides between all of them:
 * `/api/v1/version` answers on Gitea and Forgejo, `/api/v3/meta` on GitHub
 * Enterprise Server, and github.com is recognised by name because its API
 * lives on a different host entirely.
 *
 * Returns null when nothing recognisable answers, which the sign-in flow
 * reports rather than guessing an endpoint that will fail later.
 */
export async function resolveInstance(
  address: string
): Promise<IResolvedInstance | null> {
  let base: string

  try {
    const trimmed = address.trim()
    const url = new URL(
      /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    )

    // Resolving an address must give the same answer when the answer is fed
    // back in. Sign-in does exactly that: re-authenticating an existing
    // account passes its stored API endpoint here, and users paste whatever
    // they were handed, which is often already an API URL. Without this, the
    // probes go to `<base>/api/v1/api/v1/version` and the instance is
    // reported unreachable.
    base = `${url.origin}${url.pathname
      .replace(/\/+$/, '')
      .replace(/\/api\/v[13]$/, '')}`
  } catch {
    return null
  }

  const { hostname } = new URL(base)

  // github.com serves its API from another host, so it cannot be probed the
  // same way. It is recognised by name, not treated as a default.
  if (hostname === 'github.com' || hostname === 'api.github.com') {
    return {
      kind: ForgeKind.DotCom,
      family: ForgeFamily.GitHub,
      endpoint: 'https://api.github.com',
      htmlURL: 'https://github.com',
      version: null,
    }
  }

  // Gitea and Forgejo first: they answer on a path GitHub Enterprise does not
  // serve, so a positive answer is unambiguous.
  const giteaVersion = await fetchJson(`${base}/api/v1/version`, null)

  if (typeof giteaVersion?.version === 'string') {
    const endpoint = `${base}/api/v1`
    const kind = await detectForge(endpoint)

    return {
      kind: kind === ForgeKind.Unknown ? ForgeKind.Gitea : kind,
      family: ForgeFamily.Gitea,
      endpoint,
      htmlURL: base,
      version: giteaVersion.version,
    }
  }

  // GitHub Enterprise Server. `/api/v3/meta` needs no authentication and is
  // the same probe upstream uses.
  const ghesMeta = await fetchJson(`${base}/api/v3/meta`, null)

  if (ghesMeta !== null) {
    const endpoint = `${base}/api/v3`
    const version =
      typeof ghesMeta?.installed_version === 'string'
        ? ghesMeta.installed_version
        : null

    recordForge(endpoint, {
      kind: ForgeKind.GHES,
      version,
      verified: true,
    })

    return {
      kind: ForgeKind.GHES,
      family: ForgeFamily.GitHub,
      endpoint,
      htmlURL: base,
      version,
    }
  }

  return null
}
