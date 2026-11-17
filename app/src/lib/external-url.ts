/**
 * Which addresses the app may hand to the operating system to open.
 *
 * `shell.openExternal` does not open a web page, it launches whatever program
 * is registered for the address, with the address as its argument. Addresses
 * reach it from forges (the link of a check, the page of a pull request, a
 * link in a comment), and the people who write those are not the user: a
 * `file://` address to another machine makes Windows connect to its share and
 * send the user's credentials, and other schemes start other programs.
 *
 * So only web addresses go through, and only in a form that cannot be read
 * two ways. The decision is a plain allowlist, `http:` and `https:`; nothing
 * else the app opens from a link (mailto, custom schemes) is in use.
 */

/** The schemes that may be opened. */
const AllowedProtocols: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * Control characters, DEL, and the spaces a URL parser strips or ignores. A
 * parser skips leading and trailing ones and removes tabs and line breaks
 * inside, so `" javascript:x"` and `"java\\tscript:x"` are read as
 * `javascript:x` by it while looking like something else to a check on the
 * raw string. Such an address is refused rather than cleaned up.
 */
const UnreadableCharacters = new RegExp(
  `[\\x00-\\x20\\x7f-\\xa0${String.fromCharCode(0x2028, 0x2029)}]`
)

/**
 * The address to open, or null if it is not an http or https address. What is
 * returned is the normalised form, which is also what must be opened: the
 * check and the use then see the same address.
 */
export function getSafeExternalURL(address: unknown): string | null {
  if (typeof address !== 'string' || address.length === 0) {
    return null
  }

  // Spaces inside an address are written %20; one that is not is a sign that
  // something is being smuggled.
  if (UnreadableCharacters.test(address)) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(address)
  } catch {
    return null
  }

  if (!AllowedProtocols.has(parsed.protocol) || parsed.host === '') {
    return null
  }

  return parsed.href
}

/**
 * What to put in the log for an address that was refused: its scheme, not the
 * address, which can carry a secret in its query.
 */
export function describeRefusedAddress(address: unknown): string {
  if (typeof address !== 'string') {
    return `a ${typeof address}`
  }

  const match = /^\s*([A-Za-z][A-Za-z0-9+.-]*):/.exec(address)
  return match === null ? 'no scheme' : `scheme ${match[1].toLowerCase()}:`
}
