import * as URL from 'url'

/** The name for errors thrown because of an invalid URL. */
export const InvalidURLErrorName = 'invalid-url'

/** The name for errors thrown because of an invalid protocol. */
export const InvalidProtocolErrorName = 'invalid-protocol'

/** Hosts for which we accept a plain http connection. */
const loopbackHosts = ['localhost', '127.0.0.1', '[::1]']

const isLoopback = (host: string) =>
  loopbackHosts.some(x => host === x || host.startsWith(`${x}:`))

/**
 * Validate the URL for a Gitea instance.
 *
 * Returns the validated URL, or throws if the URL cannot be validated.
 */
export function validateURL(address: string): string {
  // ensure user has specified text and not just whitespace
  // we will interact with this server so we can be fairly
  // relaxed here about what we accept for the server name
  const trimmed = address.trim()
  if (trimmed.length === 0) {
    const error = new Error('Unknown address')
    error.name = InvalidURLErrorName
    throw error
  }

  let url = URL.parse(trimmed)
  if (!url.host) {
    // E.g., if the user entered 'git.example.com', assume they mean https.
    address = `https://${trimmed}`
    url = URL.parse(address)
  }

  if (!url.protocol) {
    const error = new Error('Invalid URL')
    error.name = InvalidURLErrorName
    throw error
  }

  // Tokens are sent to this host, so require TLS everywhere except loopback
  // addresses, where a development instance commonly runs over plain http.
  if (url.protocol !== 'https:') {
    const allowInsecure = url.protocol === 'http:' && isLoopback(url.host ?? '')

    if (!allowInsecure) {
      const error = new Error('Invalid protocol')
      error.name = InvalidProtocolErrorName
      throw error
    }
  }

  return address
}
