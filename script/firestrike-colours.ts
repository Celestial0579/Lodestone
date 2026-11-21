/**
 * Compares the colour values of `app/styles/_firestrike.scss` with the export
 * of the Firestrike tokens in Celestial0579/firestrike-branding
 * (`exporte/_firestrike.scss`), which is the one source of the values (#100).
 * Only the colours are compared (`$fs-name: #rrggbb;`): the comments, the
 * light and dark maps and the font stacks may differ.
 *
 *   ts-node script/firestrike-colours.ts <export file> <copy>
 *
 * CI runs it against the export at a pinned commit of the branding repository.
 */

import { readFileSync } from 'fs'

const ColourLine = /^\s*\$([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/gm

/** The colour variables of a Sass file, name to lower-case value. */
export function parseColours(text: string): ReadonlyMap<string, string> {
  const colours = new Map<string, string>()

  for (const [, name, value] of text.matchAll(ColourLine)) {
    colours.set(name, value.toLowerCase())
  }

  return colours
}

/** What differs between the source and the copy, one line each; empty when they agree. */
export function compareColours(source: string, copy: string): string[] {
  const from = parseColours(source)
  const to = parseColours(copy)
  const problems = new Array<string>()

  if (from.size === 0) {
    problems.push('the source holds no colour variable (wrong file?)')
  }

  for (const [name, value] of from) {
    const other = to.get(name)
    if (other === undefined) {
      problems.push(`$${name} is in the source (${value}) and not in the copy`)
    } else if (other !== value) {
      problems.push(
        `$${name} is ${other} in the copy and ${value} in the source`
      )
    }
  }

  for (const [name, value] of to) {
    if (!from.has(name)) {
      problems.push(`$${name} is in the copy (${value}) and not in the source`)
    }
  }

  return problems
}

if (require.main === module) {
  const [sourcePath, copyPath] = process.argv.slice(2)

  if (sourcePath === undefined || copyPath === undefined) {
    console.error('usage: firestrike-colours.ts <export file> <copy>')
    process.exit(2)
  }

  /* eslint-disable no-sync */
  const copy = readFileSync(copyPath, 'utf8')
  const problems = compareColours(readFileSync(sourcePath, 'utf8'), copy)
  /* eslint-enable no-sync */

  if (problems.length > 0) {
    console.error(`${copyPath} differs from ${sourcePath}:`)
    problems.forEach(p => console.error(`  ${p}`))
    process.exit(1)
  }

  console.log(
    `The colours of ${copyPath} match ${sourcePath} (${
      parseColours(copy).size
    } values)`
  )
}
