/**
 * What kind of forge an endpoint belongs to.
 *
 * Two questions are worth keeping apart:
 *
 *  - Which REST dialect does it speak? That selects the adapter, and there are
 *    only two answers: the GitHub shape this app was written against, and the
 *    Gitea `/api/v1` shape that Gitea and Forgejo share.
 *  - Which product is it? That decides wording and which features to offer, and
 *    it needs a network probe to answer.
 *
 * This module answers the first question only, from the endpoint string alone.
 * It has no dependencies so the low level HTTP layer can import it without an
 * import cycle.
 */

/** The REST dialect an endpoint speaks. Selects the adapter. */
export enum ForgeFamily {
  /** github.com, GitHub Enterprise. The shape the app natively speaks. */
  GitHub = 'github',
  /** Gitea and Forgejo, which share `/api/v1`. */
  Gitea = 'gitea',
}

/** The specific product behind an endpoint. Gates wording and capabilities. */
export enum ForgeKind {
  DotCom = 'dotcom',
  GHE = 'ghe',
  GHES = 'ghes',
  Gitea = 'gitea',
  Forgejo = 'forgejo',
  /** Reachable but not identified, or not probed yet. */
  Unknown = 'unknown',
}

/** What we know about the forge behind an endpoint. */
export interface IForgeInfo {
  readonly kind: ForgeKind
  readonly family: ForgeFamily
  /**
   * The version string exactly as the server reported it, never parsed as
   * semver: Forgejo reports things like `16.0.0-dev-714+gitea-1.22.0`.
   */
  readonly version: string | null
  /** False when inferred from the URL rather than confirmed by a probe. */
  readonly verified: boolean
  readonly observedAt: number
}

/** The path every Gitea and Forgejo instance serves its REST API from. */
export const GiteaAPIPath = '/api/v1'

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '')

/**
 * The dialect an endpoint speaks, from the URL alone.
 *
 * Endpoints are either built by us or restored from a stored account, so the
 * `/api/v1` suffix is a reliable marker rather than a guess. Anything else,
 * including a malformed string, is treated as the GitHub shape, which is what
 * the unmodified upstream code assumes.
 */
export function getForgeFamily(endpoint: string): ForgeFamily {
  try {
    return withoutTrailingSlash(new URL(endpoint).pathname).endsWith(
      GiteaAPIPath
    )
      ? ForgeFamily.Gitea
      : ForgeFamily.GitHub
  } catch {
    return ForgeFamily.GitHub
  }
}

/**
 * Guess the product from a version string, without going back to the network.
 *
 * Forgejo brands its own major version (16.x while Gitea is on 1.x) and appends
 * the Gitea release it is compatible with, so `16.0.0-dev-714+gitea-1.22.0`
 * identifies itself. A bare `1.27.3` is Gitea. This is a hint, not proof: the
 * authoritative test is whether `/api/forgejo/v1/version` answers.
 */
export function guessGiteaKindFromVersion(version: string | null): ForgeKind {
  if (version === null || version.length === 0) {
    return ForgeKind.Unknown
  }

  if (/\+gitea-/.test(version)) {
    return ForgeKind.Forgejo
  }

  const major = parseInt(version, 10)

  return Number.isNaN(major)
    ? ForgeKind.Unknown
    : major >= 2
    ? ForgeKind.Forgejo
    : ForgeKind.Gitea
}

/** A name for the forge that can be shown to a user. */
export function getForgeDisplayName(kind: ForgeKind): string {
  switch (kind) {
    case ForgeKind.DotCom:
    case ForgeKind.GHE:
      return 'GitHub'
    case ForgeKind.GHES:
      return 'GitHub Enterprise'
    case ForgeKind.Gitea:
      return 'Gitea'
    case ForgeKind.Forgejo:
      return 'Forgejo'
    case ForgeKind.Unknown:
      // Deliberately vague rather than wrong: this is shown in sentences like
      // "View on X", and naming the wrong product is worse than being general.
      return 'the server'
  }
}

/**
 * Where a user creates a personal access token on this forge.
 *
 * The path differs by family: Gitea and Forgejo keep tokens under the
 * applications page, GitHub under its own token settings.
 */
export function getTokenSettingsURL(
  htmlURL: string,
  family: ForgeFamily
): string {
  const base = htmlURL.replace(/\/+$/, '')

  return family === ForgeFamily.GitHub
    ? `${base}/settings/tokens`
    : `${base}/user/settings/applications`
}

/**
 * Where an administrator registers an OAuth application, as a path to quote at
 * the user rather than a link, since it needs signing in to reach.
 */
export function getOAuthApplicationSettingsPath(endpoint: string): string {
  return getForgeFamily(endpoint) === ForgeFamily.GitHub
    ? 'Settings, Developer settings, OAuth Apps'
    : 'Settings, Applications, OAuth2 Applications'
}
