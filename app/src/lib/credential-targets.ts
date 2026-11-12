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
