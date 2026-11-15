/**
 * One entry for `GIT_CONFIG_PARAMETERS`, the variable git reads configuration
 * from that is given for a single command.
 *
 * git takes the variable apart the way a shell takes apart single-quoted
 * words, so a quote inside a value has to leave the quoting, stand escaped,
 * and enter it again: `'\''`. Without that a value with a quote in it makes
 * the whole variable unreadable, and git refuses to run at all.
 */
export function getGitConfigParameter(key: string, value: string): string {
  return `'${`${key}=${value}`.replace(/'/g, `'\\''`)}'`
}
