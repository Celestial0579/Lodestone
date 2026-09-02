/**
 * Browser sign-in, for any forge that has an OAuth application registered.
 *
 * Why this exists: on an instance that authenticates its users through an
 * external identity provider — Keycloak, Entra, an OIDC or SAML gateway — a
 * personal access token still works, but creating one means finding the token
 * page behind the SSO login. Sending the user through the forge's own OAuth2
 * flow instead means they sign in the way they always do, in the browser, with
 * whatever their organisation put in front of it. The app never sees the
 * password, and never needs to know an identity provider is involved.
 *
 * Gitea, Forgejo and GitHub all expose the same OAuth2 endpoints
 * (`/login/oauth/authorize`, `/login/oauth/access_token`), so one flow serves
 * all of them. Two things are added to what upstream had:
 *
 *  - PKCE (RFC 7636). A desktop application cannot keep a client secret, so it
 *    registers as a public client and proves possession of the authorization
 *    code with a verifier instead.
 *  - A client id per instance. This build ships no registered application for
 *    any provider, so somebody with admin rights registers one on the instance
 *    they use and the id is entered here. The id is not a secret.
 */

import * as crypto from 'crypto'
import { ForgeFamily, getForgeFamily } from './forge-type'

/** localStorage key holding the OAuth client id for one instance. */
const clientIdKey = (endpoint: string) => `forge-oauth-client-id:${endpoint}`

/** Where the forge sends the browser back to. Registered in main.ts. */
export const OAuthRedirectURI = 'x-lodestone-client://oauth'

/**
 * The scopes the app asks for.
 *
 * Deliberately the same set the token instructions name, so that a user who has
 * seen one is not surprised by the other. Gitea derives read/write from the
 * HTTP method, so `write:user` is needed to publish to the personal account and
 * `write:organization` to publish into an organisation.
 */
export const OAuthScopes = [
  'write:user',
  'write:repository',
  'read:issue',
  'write:organization',
]

/** The client id registered for this instance, if the user has entered one. */
export function getForgeOAuthClientId(endpoint: string): string | null {
  try {
    const stored = localStorage.getItem(clientIdKey(endpoint))
    return stored !== null && stored.length > 0 ? stored : null
  } catch {
    return null
  }
}

/** Store the client id for an instance. Pass an empty string to forget it. */
export function setForgeOAuthClientId(endpoint: string, clientId: string) {
  const trimmed = clientId.trim()

  try {
    if (trimmed === '') {
      localStorage.removeItem(clientIdKey(endpoint))
    } else {
      localStorage.setItem(clientIdKey(endpoint), trimmed)
    }
  } catch {
    // Losing this only means the user has to enter it again.
  }
}

/**
 * Whether browser sign-in can be offered for this instance.
 *
 * The same question for every provider: is there an OAuth application we can
 * identify ourselves with? For GitHub-family endpoints that would be one
 * supplied at build time; for every other instance, one registered by its
 * administrator and entered here. Where there is none, token sign-in is
 * offered instead, which needs no registration anywhere.
 */
export function supportsForgeOAuth(endpoint: string): boolean {
  if (getForgeFamily(endpoint) === ForgeFamily.GitHub) {
    return typeof __OAUTH_CLIENT_ID__ === 'string' && __OAUTH_CLIENT_ID__ !== ''
  }

  return getForgeOAuthClientId(endpoint) !== null
}

const base64url = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** One PKCE exchange: the secret we keep and the challenge we publish. */
export interface IPkcePair {
  readonly verifier: string
  readonly challenge: string
}

/**
 * A fresh PKCE pair.
 *
 * The verifier is 32 random bytes as base64url, comfortably inside the 43 to
 * 128 character range the specification allows.
 */
export function createPkcePair(): IPkcePair {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(
    crypto.createHash('sha256').update(verifier).digest()
  )

  return { verifier, challenge }
}

/**
 * The URL to open in the browser to start sign-in.
 *
 * Returns null when no client id has been registered for the instance, which
 * is the signal to offer token sign-in instead.
 */
export function getForgeAuthorizationURL(
  htmlURL: string,
  endpoint: string,
  state: string,
  challenge: string
): string | null {
  const clientId = getForgeOAuthClientId(endpoint)

  if (clientId === null) {
    return null
  }

  // Appended rather than rooted: an instance served under a sub path keeps it,
  // so https://example.com/gitea stays https://example.com/gitea/login/...
  const url = new URL(`${htmlURL.replace(/\/+$/, '')}/login/oauth/authorize`)

  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', OAuthRedirectURI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', OAuthScopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return url.toString()
}

/** The body that exchanges an authorization code for an access token. */
export function getForgeTokenRequestBody(
  endpoint: string,
  code: string,
  verifier: string
): Record<string, string> | null {
  const clientId = getForgeOAuthClientId(endpoint)

  if (clientId === null) {
    return null
  }

  return {
    client_id: clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: OAuthRedirectURI,
    // Instead of a client secret: proof that this is the same client that
    // started the flow.
    code_verifier: verifier,
  }
}
