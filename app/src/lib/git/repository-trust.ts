/**
 * What a repository's own configuration and hooks can make Git run, and what
 * the app does about it (#98).
 *
 * Git starts programs that a repository's local configuration names, and runs
 * the hooks in its hooks directory. A repository that arrives from elsewhere
 * (an archive, a copied folder) carries its own configuration and hooks, so
 * the person who made it, not the user, chose what runs. The Git command line
 * accepts that. An app that runs Git the moment a folder is added does not.
 *
 * This file holds the part that needs no Git and no Electron: reading the
 * output of `git config --list`, deciding which entries run programs or
 * change where Git connects, the arguments that switch them off for one
 * command, a fingerprint of what was found, and the text shown to the user.
 */

import { createHash } from 'crypto'

/** One configuration entry as `git config --list --show-origin --show-scope -z` gives it. */
export interface IConfigEntry {
  /** `system`, `global`, `local`, `worktree` or `command`. */
  readonly scope: string
  /** Where it was read from, such as `file:.git/config`. */
  readonly origin: string
  readonly key: string
  readonly value: string
  /** Set when the entry comes from a submodule's own configuration: where that is. */
  readonly submodule?: string
}

/**
 * Read the output of `git config --list --show-origin --show-scope -z`: for
 * every entry the scope, a NUL, the origin, a NUL, the key, a newline, the
 * value and a NUL. A key without a value (a bare `[section] key` line) comes
 * without the newline and has the value `true`.
 */
export function parseConfigList(output: string): ReadonlyArray<IConfigEntry> {
  const fields = output.split('\0')
  const entries = new Array<IConfigEntry>()

  for (let i = 0; i + 2 < fields.length; i += 3) {
    const scope = fields[i]
    const origin = fields[i + 1]
    const keyAndValue = fields[i + 2]
    const newline = keyAndValue.indexOf('\n')
    const key = newline === -1 ? keyAndValue : keyAndValue.slice(0, newline)
    const value = newline === -1 ? 'true' : keyAndValue.slice(newline + 1)
    entries.push({ scope, origin, key, value })
  }

  return entries
}

/** The scopes whose entries a repository brings with it. */
const RepositoryScopes: ReadonlySet<string> = new Set(['local', 'worktree'])

/**
 * Keys that make Git run a program. The part a user names (a driver, a
 * remote, a URL) may itself hold dots.
 */
const CommandKeyPatterns: ReadonlyArray<RegExp> = [
  /^core\.hookspath$/,
  /^core\.sshcommand$/,
  /^core\.askpass$/,
  /^core\.gitproxy$/,
  /^core\.pager$/,
  /^core\.editor$/,
  /^pager\..+$/,
  /^sequence\.editor$/,
  /^diff\.external$/,
  /^diff\..+\.textconv$/,
  /^diff\..+\.command$/,
  /^merge\..+\.driver$/,
  /^filter\..+\.(clean|smudge|process)$/,
  /^credential\.helper$/,
  /^credential\..+\.helper$/,
  /^gpg\.program$/,
  /^gpg\..+\.program$/,
  /^gpg\.ssh\.defaultkeycommand$/,
  /^remote\..+\.(uploadpack|receivepack)$/,
  /^core\.alternaterefscommand$/,
]

/** Keys that change where Git connects or what it trusts when it does. */
const TransportKeyPatterns: ReadonlyArray<RegExp> = [
  /^http\.(sslverify|sslcainfo|sslcapath|proxy|cookiefile|savecookies)$/,
  /^http\..+\.(sslverify|sslcainfo|sslcapath|proxy|cookiefile|savecookies)$/,
  /^url\..+\.(insteadof|pushinsteadof)$/,
  // protocol.ext.allow=always lets an ext:: remote run a command.
  /^protocol\..+$/,
]

/**
 * Git reads the section and the last part of a key without regard to case and
 * the part in the middle with it. Patterns here are written in lower case, so
 * the key is lowered for matching and kept as it is for overriding.
 */
const matches = (key: string, patterns: ReadonlyArray<RegExp>) =>
  patterns.some(p => p.test(key.toLowerCase()))

/** Whether this entry makes Git run a program. */
export function isCommandKey(entry: IConfigEntry): boolean {
  const key = entry.key.toLowerCase()

  // core.fsmonitor is a program unless it is one of Git's own switches.
  if (key === 'core.fsmonitor') {
    return !/^(true|false|yes|no|on|off|1|0|)$/i.test(entry.value.trim())
  }

  // A submodule update of the form !command runs that command.
  if (/^submodule\..+\.update$/.test(key)) {
    return entry.value.startsWith('!')
  }

  return matches(entry.key, CommandKeyPatterns)
}

/** Whether this entry changes where Git connects or what it trusts. */
export function isTransportKey(entry: IConfigEntry): boolean {
  return matches(entry.key, TransportKeyPatterns)
}

/** A file in a hooks directory that Git would run. */
export interface IHookFile {
  readonly name: string
  readonly sha256: string
}

/** What a repository brings with it. */
export interface IRepositoryFindings {
  readonly commandEntries: ReadonlyArray<IConfigEntry>
  readonly transportEntries: ReadonlyArray<IConfigEntry>
  readonly hooks: ReadonlyArray<IHookFile>
  /** The hooks directory named by core.hooksPath lies in the work tree. */
  readonly hooksPathInWorkTree: boolean
  /** Included configuration files that lie in the work tree. */
  readonly includesInWorkTree: ReadonlyArray<string>
}

/**
 * The entries of the repository's own scopes that matter, split by what they
 * do. A hooks directory with any file that does not end in `.sample` counts,
 * whatever the file's mode: Git for Windows runs a hook that starts with `#!`
 * or is an executable regardless of modes.
 */
export function findRepositoryFindings(
  entries: ReadonlyArray<IConfigEntry>,
  hooks: ReadonlyArray<IHookFile>,
  isInWorkTree: (path: string) => boolean = () => false
): IRepositoryFindings {
  const own = entries.filter(e => RepositoryScopes.has(e.scope))
  const hookFiles = hooks.filter(h => !h.name.endsWith('.sample'))

  const hooksPath = own.find(e => e.key.toLowerCase() === 'core.hookspath')
  const includes = own
    .filter(e => e.origin.startsWith('file:'))
    .map(e => e.origin.slice('file:'.length))
    .filter((origin, i, all) => all.indexOf(origin) === i)
    .filter(origin => isInWorkTree(origin))

  return {
    commandEntries: own.filter(isCommandKey),
    transportEntries: own.filter(isTransportKey),
    hooks: hookFiles,
    hooksPathInWorkTree:
      hooksPath !== undefined && isInWorkTree(hooksPath.value),
    includesInWorkTree: includes,
  }
}

/** Whether the repository brings anything that needs the user's say. */
export function hasFindings(findings: IRepositoryFindings): boolean {
  return (
    findings.commandEntries.length > 0 ||
    findings.transportEntries.length > 0 ||
    findings.hooks.length > 0
  )
}

/**
 * What a fingerprint is made of. Any change to a key, a value, the file a
 * value came from, a hook's name or a hook's content changes it.
 */
export function fingerprintFindings(findings: IRepositoryFindings): string {
  const entry = (e: IConfigEntry) =>
    JSON.stringify([e.key, e.value, e.origin, e.scope])
  const lines = (items: ReadonlyArray<IConfigEntry>) => items.map(entry).sort()

  const body = JSON.stringify({
    command: lines(findings.commandEntries),
    transport: lines(findings.transportEntries),
    hooks: findings.hooks.map(h => JSON.stringify([h.name, h.sha256])).sort(),
  })

  return createHash('sha256').update(body).digest('hex')
}

/** The SHA-256 of some bytes, in hex. */
export const sha256Hex = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex')

/**
 * The value a key gets on the command line so that what it names does not run.
 * Git's own default stands in where an empty value would be read as a
 * command.
 */
function neutralValue(key: string, emptyHooksDirectory: string): string {
  const k = key.toLowerCase()

  if (k === 'core.fsmonitor') {
    return 'false'
  }
  if (k === 'core.hookspath') {
    return emptyHooksDirectory
  }
  if (k === 'core.sshcommand') {
    return 'ssh'
  }
  if (k === 'core.editor' || k === 'sequence.editor') {
    return 'true'
  }
  if (/^pager\./.test(k)) {
    return 'false'
  }
  if (/^filter\..+\.(clean|smudge)$/.test(k)) {
    return 'cat'
  }
  if (k === 'gpg.program') {
    return 'gpg'
  }
  if (/^remote\..+\.uploadpack$/.test(k)) {
    return 'git-upload-pack'
  }
  if (/^remote\..+\.receivepack$/.test(k)) {
    return 'git-receive-pack'
  }
  if (/^submodule\..+\.update$/.test(k)) {
    return 'checkout'
  }
  if (k === 'core.alternaterefscommand') {
    return 'true'
  }

  return ''
}

/**
 * The `-c` arguments that switch off every program a repository's own
 * configuration names, plus its hooks. Placed before the command, they win
 * over every file.
 */
export function getOverrideArguments(
  findings: IRepositoryFindings,
  emptyHooksDirectory: string
): ReadonlyArray<string> {
  const keys = new Map<string, string>()

  for (const e of findings.commandEntries) {
    keys.set(e.key, neutralValue(e.key, emptyHooksDirectory))
  }

  // Hooks and the file system monitor are off for an untrusted repository,
  // whether it sets them or not.
  keys.set('core.hooksPath', emptyHooksDirectory)
  keys.set('core.fsmonitor', 'false')
  // Nothing goes into a submodule, whose own configuration is not the one asked about.
  keys.set('submodule.recurse', 'false')

  return [...keys].flatMap(([key, value]) => ['-c', `${key}=${value}`])
}

/** The keys that block network operations, as written in the repository. */
export function getTransportBlockKeys(
  findings: IRepositoryFindings
): ReadonlyArray<string> {
  return [...new Set(findings.transportEntries.map(e => e.key))]
}

/**
 * Control characters, DEL and the C1 controls, the Arabic letter mark, the
 * zero-width and direction marks (U+200B to U+200F), the line and paragraph
 * separators and the bidirectional controls (U+2028 to U+202E, U+2060 to
 * U+2069), and the byte order mark. Built from code points so that the source
 * holds none of them.
 */
const InvisibleCharacters = new RegExp(
  `[\\x00-\\x1f\\x7f-\\x9f${[0x61c, 0xfeff]
    .map(c => String.fromCharCode(c))
    .join('')}${String.fromCharCode(0x200b)}-${String.fromCharCode(
    0x200f
  )}${String.fromCharCode(0x2028)}-${String.fromCharCode(
    0x202e
  )}${String.fromCharCode(0x2060)}-${String.fromCharCode(0x2069)}]`,
  'g'
)

/**
 * Text from a repository shown to the user so that it reads as it is: control
 * characters, bidirectional controls and zero-width characters appear as their
 * code point in square brackets.
 */
export function makeVisible(text: string): string {
  return text.replace(
    InvisibleCharacters,
    c => `[U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`
  )
}

/** One line of the question per finding, as text. */
export function describeFindings(
  findings: IRepositoryFindings
): ReadonlyArray<string> {
  const lines = new Array<string>()

  for (const e of [...findings.commandEntries, ...findings.transportEntries]) {
    const where =
      e.submodule === undefined
        ? ''
        : `[submodule ${makeVisible(e.submodule)}] `
    lines.push(`${where}${makeVisible(e.key)} = ${makeVisible(e.value)}`)
  }

  for (const h of findings.hooks) {
    lines.push(`hook: ${makeVisible(h.name)}`)
  }

  return lines
}
