/**
 * The names of the generic credentials listed by `cmdkey /list` that start
 * with the given prefix.
 *
 * Each entry of that list has a line such as
 *
 *     Target: LegacyGeneric:target=Lodestone - https://git.example.com/alice
 *
 * Windows translates the label in front ("Ziel:" in German), not what follows
 * it, so the label is not looked at.
 */
export function parseCredentialTargets(
  cmdkeyOutput: string,
  prefix: string
): ReadonlyArray<string> {
  const targets = new Array<string>()

  for (const line of cmdkeyOutput.split(/\r?\n/)) {
    const match = /:\s*LegacyGeneric:target=(.*\S)\s*$/.exec(line)

    if (match !== null && match[1].startsWith(prefix)) {
      targets.push(match[1])
    }
  }

  return targets
}

/**
 * Split the name of a credential into the two parts keytar builds it from, a
 * key and a login joined by a slash.
 *
 * The key holds an endpoint and has slashes of its own, so the name does not
 * say where it was joined. That does not matter: keytar only ever puts the
 * two together again, and any split at a slash gives the same name back. A
 * name without a slash is not one keytar wrote.
 */
export function splitCredentialTarget(
  target: string
): { readonly key: string; readonly login: string } | null {
  const index = target.lastIndexOf('/')

  return index < 0
    ? null
    : { key: target.slice(0, index), login: target.slice(index + 1) }
}
