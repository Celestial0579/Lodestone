/**
 * Mask credentials in a log entry before it is written anywhere.
 *
 * Nothing should log a secret on purpose, but the log takes in what others
 * produce: the command line of a git command that failed, the last part of
 * its output, error messages with the URL of a request. A clone URL like
 * `https://user:token@host/repo.git` would otherwise reach the log as it was
 * typed, and from there any bug report the log is attached to.
 *
 * This works on the text, so it masks what looks like a credential rather
 * than what is one. It errs on the side of masking.
 */

const Mask = '***'

/** Query parameters whose value is a credential. */
const SecretParameters = [
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'private_token',
  'client_secret',
  'password',
  'passwd',
  'secret',
  'api_key',
  'apikey',
  'key',
  'sig',
  'signature',
]

type Rule = readonly [RegExp, (match: string, ...groups: string[]) => string]

const rules: ReadonlyArray<Rule> = [
  // A password or token in the userinfo of a URL: scheme://user:secret@host
  [
    /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*):([^\s/@]+)@/gi,
    (_, scheme, user) => `${scheme}${user}:${Mask}@`,
  ],

  // A token on its own in the userinfo, the way GitHub and Gitea accept one.
  // A user name as people choose them stays.
  [
    /\b([a-z][a-z0-9+.-]*:\/\/)([A-Za-z0-9_-]{30,})@/gi,
    (_, scheme) => `${scheme}${Mask}@`,
  ],

  // Authorization headers and the like, wherever they are written out.
  [
    /\b((?:proxy-)?authorization["']?\s*[:=]\s*["']?)((?:bearer|basic|token|digest)\s+)?[^\s"',;]+/gi,
    (_, name, scheme) => `${name}${scheme ?? ''}${Mask}`,
  ],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, (_, bearer) => `${bearer}${Mask}`],

  // Credentials in a query string or a form body.
  [
    new RegExp(`([?&;](?:${SecretParameters.join('|')})=)[^\\s&#;"']+`, 'gi'),
    (_, name) => `${name}${Mask}`,
  ],

  // GitHub tokens, which carry their kind in a prefix.
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    () => Mask,
  ],
]

export function redactSecrets(text: string): string {
  return rules.reduce(
    (result, [pattern, replace]) =>
      result.replace(pattern, replace as (m: string) => string),
    text
  )
}
