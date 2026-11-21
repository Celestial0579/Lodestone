/**
 * Checks that `app/package-lock.json` holds the same app version as
 * `app/package.json` (#141). The lock file repeats the version twice (at the
 * top and under `packages[""]`); a version bump that edits only package.json
 * leaves it behind.
 *
 *   ts-node script/validate-version.ts [<package.json> <package-lock.json>]
 */

import { readFileSync } from 'fs'
import * as Path from 'path'

type Json = { readonly [key: string]: unknown }

/** What differs between the version of package.json and the ones of the lock file; empty when they agree. */
export function versionProblems(pkg: Json, lock: Json): string[] {
  const version = pkg.version
  const problems = new Array<string>()

  if (typeof version !== 'string' || version.length === 0) {
    return ['package.json has no version']
  }

  const root = (lock.packages as Json | undefined)?.['']
  const found: ReadonlyArray<[string, unknown]> = [
    ['version', lock.version],
    ['packages[""].version', (root as Json | undefined)?.version],
  ]

  for (const [where, value] of found) {
    if (value !== version) {
      problems.push(
        `package-lock.json ${where} is ${
          typeof value === 'string' ? value : 'missing'
        }, package.json has ${version}`
      )
    }
  }

  return problems
}

if (require.main === module) {
  const root = Path.dirname(__dirname)
  const [pkgPath, lockPath] =
    process.argv.length > 3
      ? process.argv.slice(2)
      : [
          Path.join(root, 'app', 'package.json'),
          Path.join(root, 'app', 'package-lock.json'),
        ]

  /* eslint-disable no-sync */
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  /* eslint-enable no-sync */

  const problems = versionProblems(pkg, lock)
  if (problems.length > 0) {
    console.error('The app version is not the same in both files:')
    problems.forEach(p => console.error(`  ${p}`))
    console.error('Change it in app/package.json and app/package-lock.json.')
    process.exit(1)
  }

  console.log(`The version of ${lockPath} matches ${pkgPath} (${pkg.version})`)
}
