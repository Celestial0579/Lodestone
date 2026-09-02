/**
 * Keeping a browser sign-in alive.
 *
 * A personal access token does not expire, so nothing in this app ever had to
 * deal with one that does. An OAuth2 access token is different: Gitea and
 * Forgejo issue them with a one hour lifetime by default
 * (`[oauth2] ACCESS_TOKEN_EXPIRATION_TIME`), and hand back a long-lived
 * refresh token alongside. Without spending that refresh token, a browser
 * sign-in stops working an hour later — and because the stored token is also
 * what the credential helper gives git, fetch and push stop with it.
 *
 * The awkward part is that the request layer knows only the token string; it
 * has no account, no login, no context. So the refresh material is kept in a
 * map keyed by the access token itself, which is exactly what a caller has
 * when a request comes back 401.
 *
 * Persisting it across restarts is the accounts store's job: it owns the
 * secure store. This module asks for that through a callback rather than
 * importing it, which would be a cycle.
 */

import { getUserAgent } from '../http-core'
import { getForgeOAuthClientId, OAuthRedirectURI } from './forge-oauth'

/** What is needed to trade a refresh token for a new access token. */
export interface IRefreshMaterial {
  /** The API endpoint, used to find the client id registered for it. */
  readonly endpoint: string
  /** The web address, where the token endpoint lives. */
  readonly htmlURL: string
  /** The refresh token itself. As sensitive as the access token. */
  readonly refreshToken: string
}

const byAccessToken = new Map<string, IRefreshMaterial>()

/** In-flight refreshes, so a burst of 401s produces one request, not ten. */
const inFlight = new Map<string, Promise<string | null>>()

type TokenRefreshedCallback = (
  previousToken: string,
  nextToken: string,
  material: IRefreshMaterial
) => Promise<void>

let onRefreshed: TokenRefreshedCallback | null = null

/**
 * Register how a refreshed token gets persisted. Called once at startup by
 * whoever owns the secure store.
 */
export function setTokenRefreshedCallback(callback: TokenRefreshedCallback) {
  onRefreshed = callback
}

/** Remember how to renew this access token when it expires. */
export function rememberRefreshMaterial(
  accessToken: string,
  material: IRefreshMaterial
): void {
  if (accessToken.length > 0 && material.refreshToken.length > 0) {
    byAccessToken.set(accessToken, material)
  }
}

/** Forget an access token's refresh material, on sign-out. */
export function forgetRefreshMaterial(accessToken: string): void {
  byAccessToken.delete(accessToken)
  inFlight.delete(accessToken)
}

/** What we hold for this token, if anything. */
export function getRefreshMaterial(
  accessToken: string
): IRefreshMaterial | undefined {
  return byAccessToken.get(accessToken)
}

/** Whether a failed request with this token is worth retrying after a renew. */
export function canRefresh(accessToken: string | null): boolean {
  return accessToken !== null && byAccessToken.has(accessToken)
}

/**
 * Trade the refresh token for a new access token.
 *
 * Returns the new token, or null when there is nothing to refresh with or the
 * server refused — a refused refresh means the grant is gone for good, so the
 * material is dropped rather than retried.
 *
 * Never throws: callers are error paths already.
 */
export function refreshAccessToken(
  accessToken: string
): Promise<string | null> {
  const existing = inFlight.get(accessToken)

  if (existing !== undefined) {
    return existing
  }

  const attempt = performRefresh(accessToken).finally(() => {
    inFlight.delete(accessToken)
  })

  inFlight.set(accessToken, attempt)

  return attempt
}

async function performRefresh(accessToken: string): Promise<string | null> {
  const material = byAccessToken.get(accessToken)

  if (material === undefined) {
    return null
  }

  const clientId = getForgeOAuthClientId(material.endpoint)

  if (clientId === null) {
    // The application was deregistered while we were signed in.
    byAccessToken.delete(accessToken)
    return null
  }

  const url = `${material.htmlURL.replace(/\/+$/, '')}/login/oauth/access_token`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'user-agent': getUserAgent(),
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: material.refreshToken,
        client_id: clientId,
        redirect_uri: OAuthRedirectURI,
      }),
      credentials: 'omit',
    })

    if (!response.ok) {
      // A rejected refresh token does not become valid again, so stop trying.
      log.warn(
        `[forge-token-refresh] ${material.htmlURL} refused to renew the token (${response.status})`
      )
      byAccessToken.delete(accessToken)
      return null
    }

    const body = await response.json()
    const nextToken = body?.access_token

    if (typeof nextToken !== 'string' || nextToken.length === 0) {
      byAccessToken.delete(accessToken)
      return null
    }

    // A refresh usually rotates the refresh token too; keep whichever is
    // current, against the new access token.
    const nextMaterial: IRefreshMaterial = {
      ...material,
      refreshToken:
        typeof body?.refresh_token === 'string' && body.refresh_token.length > 0
          ? body.refresh_token
          : material.refreshToken,
    }

    byAccessToken.delete(accessToken)
    byAccessToken.set(nextToken, nextMaterial)

    if (onRefreshed !== null) {
      try {
        await onRefreshed(accessToken, nextToken, nextMaterial)
      } catch (e) {
        // The token still works for this session even if it did not persist.
        log.warn('[forge-token-refresh] failed persisting the renewed token', e)
      }
    }

    return nextToken
  } catch (e) {
    log.warn(`[forge-token-refresh] failed renewing against ${url}`, e)
    return null
  }
}

/** Testing seam. */
export function clearRefreshMaterial(): void {
  byAccessToken.clear()
  inFlight.clear()
}
