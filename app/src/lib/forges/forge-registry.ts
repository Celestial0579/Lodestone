/**
 * What is known about the forge behind each endpoint.
 *
 * Identifying the product needs a network probe, and the app asks "what am I
 * talking to?" from many places, several of them synchronous render paths. So
 * lookups here never block: they answer from what has been learned so far, or
 * infer the family from the URL and say so with `verified: false`.
 *
 * This mirrors the endpoint version cache in `endpoint-capabilities.ts`, which
 * solves the same problem for GitHub Enterprise versions.
 */

import {
  ForgeFamily,
  ForgeKind,
  IForgeInfo,
  getForgeFamily,
  guessGiteaKindFromVersion,
} from './forge-type'

const StorageKeyPrefix = 'forge-kind:'
const OriginKeyPrefix = 'forge-api-endpoint:'

/** Written through to localStorage so a restart does not re-probe. */
const cache = new Map<string, IForgeInfo>()

const readStored = (endpoint: string): IForgeInfo | undefined => {
  try {
    const raw = localStorage.getItem(`${StorageKeyPrefix}${endpoint}`)

    if (raw === null) {
      return undefined
    }

    const parsed = JSON.parse(raw)

    // Anything stored by an older build may not have the shape we expect.
    return typeof parsed?.kind === 'string' &&
      typeof parsed?.family === 'string'
      ? (parsed as IForgeInfo)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * What we currently believe about this endpoint. Never returns undefined: with
 * nothing stored it infers the family from the URL and reports the kind as
 * unknown, unverified.
 */
export function getKnownForge(endpoint: string): IForgeInfo {
  const cached = cache.get(endpoint) ?? readStored(endpoint)

  if (cached !== undefined) {
    cache.set(endpoint, cached)
    return cached
  }

  return {
    kind: ForgeKind.Unknown,
    family: getForgeFamily(endpoint),
    version: null,
    verified: false,
    observedAt: 0,
  }
}

/** Record what a probe or an API response revealed. */
export function recordForge(
  endpoint: string,
  info: Partial<Pick<IForgeInfo, 'kind' | 'version' | 'verified'>>
): void {
  const current = getKnownForge(endpoint)

  const next: IForgeInfo = {
    // The family follows from the URL and is never overridden by a probe.
    family: getForgeFamily(endpoint),
    kind: info.kind ?? current.kind,
    version: info.version ?? current.version,
    verified: info.verified ?? current.verified,
    observedAt: Date.now(),
  }

  // A version can identify the product on its own, so use it when a probe has
  // not said otherwise.
  const derived =
    next.kind === ForgeKind.Unknown && next.family === ForgeFamily.Gitea
      ? guessGiteaKindFromVersion(next.version)
      : next.kind

  const resolved: IForgeInfo = { ...next, kind: derived }

  cache.set(endpoint, resolved)

  try {
    localStorage.setItem(
      `${StorageKeyPrefix}${endpoint}`,
      JSON.stringify(resolved)
    )
  } catch {
    // A full or unavailable localStorage costs us the cache across restarts,
    // nothing more.
  }
}

/**
 * The API endpoint learned for a web origin.
 *
 * Git asks the credential helper about `https://git.example.com`, while the API
 * lives at `https://git.example.com/api/v1`. Remembering the pairing at sign-in
 * saves guessing later.
 */
export function getKnownApiEndpointForOrigin(
  origin: string
): string | undefined {
  try {
    return localStorage.getItem(`${OriginKeyPrefix}${origin}`) ?? undefined
  } catch {
    return undefined
  }
}

export function recordApiEndpointForOrigin(
  origin: string,
  apiEndpoint: string
): void {
  try {
    localStorage.setItem(`${OriginKeyPrefix}${origin}`, apiEndpoint)
  } catch {
    // See above: losing this only means we probe again.
  }
}

/** Testing seam: forget everything learned so far. */
export function clearForgeRegistry(): void {
  cache.clear()
}
