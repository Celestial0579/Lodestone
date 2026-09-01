/**
 * Working out whether an arbitrary host is a Gitea instance.
 *
 * The git credential helper needs this: when git asks for credentials for a
 * host we have never seen, we have to decide whether to authenticate with an
 * account the app holds or to fall back to asking the user. Upstream answers
 * the same question for GitHub by probing `/meta` and looking for a GitHub
 * response header; Gitea answers `/api/v1/version` with its version number,
 * which serves the same purpose.
 */

import { getGiteaAPIURL } from './gitea-endpoint'
import { getUserAgent } from '../http-core'
import {
  clearCertificateErrorSuppressionFor,
  suppressCertificateErrorFor,
} from '../suppress-certificate-error'

/** Hosts we know are not Gitea, so we never bother asking them. */
const knownThirdPartyHosts = new Set([
  'github.com',
  'gist.github.com',
  'dev.azure.com',
  'gitlab.com',
  'bitbucket.org',
  'amazonaws.com',
  'visualstudio.com',
])

const isKnownThirdPartyHost = (hostname: string) => {
  if (knownThirdPartyHosts.has(hostname)) {
    return true
  }

  for (const knownHost of knownThirdPartyHosts) {
    if (hostname.endsWith(`.${knownHost}`)) {
      return true
    }
  }

  return false
}

/** Results are cached per origin; an instance does not stop being Gitea. */
const cache = new Map<string, boolean>()

/**
 * Attempts to determine whether or not the url belongs to a Gitea instance.
 *
 * This is a best-effort attempt and returns undefined if the discovery request
 * could not be completed, so that callers can tell "not Gitea" apart from
 * "couldn't find out".
 */
export async function isGiteaHost(url: string): Promise<boolean | undefined> {
  let origin: string
  let hostname: string

  try {
    ;({ origin, hostname } = new URL(url))
  } catch {
    return false
  }

  if (isKnownThirdPartyHost(hostname)) {
    return false
  }

  const cached = cache.get(origin)

  if (cached !== undefined) {
    return cached
  }

  // Add a unique identifier to the URL so our certificate error suppression
  // only catches this request.
  const versionUrl = `${getGiteaAPIURL(
    origin
  )}/version?ghd=${crypto.randomUUID()}`

  const ac = new AbortController()
  const timeoutId = setTimeout(() => ac.abort(), 2000)
  suppressCertificateErrorFor(versionUrl)

  try {
    const response = await fetch(versionUrl, {
      headers: { 'user-agent': getUserAgent() },
      signal: ac.signal,
      credentials: 'omit',
      redirect: 'error',
    })

    if (!response.ok) {
      return false
    }

    // Every Gitea instance answers this with {"version":"1.24.3"}. Anything
    // else on that path is not a Gitea we can talk to.
    const body = await response.json()
    const isGitea = typeof body?.version === 'string'

    cache.set(origin, isGitea)
    return isGitea
  } catch (e) {
    log.debug(`isGiteaHost: failed with ${origin}`, e)
    return undefined
  } finally {
    clearTimeout(timeoutId)
    clearCertificateErrorSuppressionFor(versionUrl)
  }
}
