/**
 * Paths that Git itself opens on every call and that can name another
 * machine (#98). On Windows, reading `\\host\share\...` connects to that host
 * and sends the user's credentials. So before Git runs in a folder, the files
 * that name such paths are read here, with every path checked as a string
 * before anything is opened, and a repository that names a network or device
 * path, or that cannot be read safely, is refused.
 *
 * Read: the `.git` entry at the top and the Git directory it names,
 * `config`, `config.worktree`, `commondir` and the alternates file of every
 * Git directory (the common one, the modules of submodules and the targets of
 * populated submodules' `.git` files included). Configuration is read with
 * Git's own parser (`git config --file <f> --no-includes --list -z`, run from
 * a folder outside the repository); files named by `include.path` and
 * `includeIf.*.path` are followed to a depth of 10, alternates to a depth of
 * 5, whatever the conditions say. Keys are checked as well as values, since a
 * network path can be a subsection name (`url.<base>.insteadOf`).
 *
 * Before the first Git call, every Git directory (the main one, the common one,
 * the modules, the targets of submodules' `.git` files) is walked completely
 * with `readdir(..., { withFileTypes })`, and any link or junction in it is a
 * refusal, because Git opens most of what is in there (the index and its lock
 * file, HEAD, refs, info/exclude, pack files). Path values of
 * `core.excludesFile`, `core.attributesFile`, `core.hooksPath` and
 * `mailmap.file` are checked part by part.
 *
 * Refused as well: a file Git cannot parse (Git follows an include as soon as
 * it reaches it, before it fails on a later line), a quoted alternates line
 * that does not decode, a link or junction where the repository's own files
 * are, and a file that is not a small regular file.
 */

import { exec } from 'dugite'
import { lstat, mkdir, open, readdir, readFile } from 'fs/promises'
import type { Stats } from 'fs'
import { tmpdir } from 'os'
import * as Path from 'path'

/** Longest file read. */
const MaxBytes = 1024 * 1024

/** Most files looked at for one repository. */
const MaxFiles = 400

/** Most directory entries one repository's Git directories may have. */
const MaxEntries = 250_000

const MaxIncludeDepth = 10
const MaxAlternatesDepth = 5

const isSeparator = (c: string | undefined) => c === '/' || c === '\\'

/**
 * Whether a path value is a network or device path. Windows takes two
 * separators of either kind at the start for a UNC or device path (`\\host`,
 * `//host`, `\/host`, `/\host`, `\\?\`, `\\.\`), and `\??\` for an NT path.
 * `file://host/share` becomes `\\host\share`; `file:///C:/x` has an empty
 * host and is local. A config file writes a backslash twice, so that form is
 * checked too.
 */
export function isNetworkPath(value: string): boolean {
  const trimmed = value.trim().replace(/^"/, '')

  return [trimmed, trimmed.replace(/\\\\/g, '\\')].some(candidate => {
    const afterScheme = /^file:/i.test(candidate)
      ? candidate.slice('file:'.length)
      : candidate
    const isFileUrl = afterScheme !== candidate

    if (/^[\\/]\?\?[\\/]/.test(afterScheme)) {
      return true
    }

    if (!isSeparator(afterScheme[0]) || !isSeparator(afterScheme[1])) {
      return false
    }

    // file:///C:/x and file:///home/x: an empty host, a local path.
    return !(
      isFileUrl &&
      isSeparator(afterScheme[2]) &&
      !isSeparator(afterScheme[3])
    )
  })
}

const show = (where: string, value: string) =>
  `${where}: ${value.replace(/[\x00-\x1f\x7f]/g, '?')}`

interface IScan {
  /** The folder the check is for: paths are checked from where it and they part. */
  readonly base: string
  /** Why the repository is refused. */
  readonly found: string[]
  /** Directory entries looked at by the walks, against a limit. */
  entries: number
  readonly walked: Set<string>
  /** Files and directories looked at, against a limit. */
  files: number
  /** The smallest include depth a config file was scanned at. */
  readonly configs: Map<string, number>
  readonly alternates: Map<string, number>
  readonly gitDirectories: Set<string>
}

const newScan = (base: string): IScan => ({
  base,
  found: [],
  entries: 0,
  walked: new Set(),
  files: 0,
  configs: new Map(),
  alternates: new Map(),
  gitDirectories: new Set(),
})

/** Whether a name holds a character Windows does not allow in one. */
export function hasWindowsForbiddenCharacter(name: string): boolean {
  return /[<>"|?*]/.test(name)
}

/**
 * The name an MSYS2 program (Git for Windows' ssh-keygen) uses for a name
 * with characters Windows forbids: each one is U+F000 plus its code.
 */
export function msys2Name(name: string): string {
  return name.replace(/[<>"|?*]/g, c =>
    String.fromCharCode(0xf000 + c.charCodeAt(0))
  )
}

/** The keys whose value Git hands to ssh-keygen. */
const SshKeygenKeys: ReadonlySet<string> = new Set([
  'user.signingkey',
  'gpg.ssh.allowedsignersfile',
  'gpg.ssh.revocationfile',
])

/**
 * The name Cygwin and MSYS2 use for a name with characters Windows forbids:
 * every control character 1 to 31 and `" * : < > ? |` becomes U+F000 plus its
 * code (winsup/cygwin/strfuncs.cc). `lnk:s` is `lnk` U+F03A `s`, a name that
 * can exist, not a stream of `lnk`.
 */
export function cygwinName(name: string): string {
  return name.replace(/[\x01-\x1f"*:<>?|]/g, c =>
    String.fromCharCode(0xf000 + c.charCodeAt(0))
  )
}

/**
 * How an MSYS2 or Cygwin ssh-keygen reads a value. Only `X:\` and `X:/` are
 * Windows paths to it; a single leading `/` is a POSIX path (`/proc/self/cwd`
 * is the repository, `/c/` and `/tmp/` go through the mount table), which is
 * refused; anything else is a relative POSIX name, whose parts are mapped
 * (`C:lnk` is `C` U+F03A `lnk`) and opened in the repository.
 */
export function cygwinReading(value: string): {
  readonly refuse?: string
  readonly relative?: string
} {
  if (/^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}/.test(value)) {
    return {}
  }

  if (/^[\\/]/.test(value)) {
    return { refuse: 'a POSIX absolute path an MSYS2 ssh-keygen would resolve' }
  }

  return { relative: value.split(/[\\/]/).map(cygwinName).join('/') }
}

/**
 * The name to look at for one part of a path on Windows. A colon after the
 * first character names a stream: the file is the part before it, so that
 * `lnk:stream` looks at `lnk`, which a junction may be. Characters Windows
 * forbids become their MSYS2 names. A plain name is returned as it is.
 */
export function windowsLookName(name: string): string {
  const colon = name.indexOf(':')
  const file = colon > 0 ? name.slice(0, colon) : name
  return hasWindowsForbiddenCharacter(file) ? msys2Name(file) : file
}

/** Whether the last part of a path ends in a dot or a space (not `.` or `..`). */
export function hasTrailingDotOrSpace(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? ''
  return name !== '.' && name !== '..' && /[. ]$/.test(name)
}

/** Whether an error says the path is not there (and not that it could not be looked at). */
const isMissing = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const errorCode = (e: unknown) =>
  (e as NodeJS.ErrnoException | null)?.code ?? 'error'

const isWindows = () => process.platform === 'win32'

const sameName = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/**
 * The parts of a path to look at: every part below the deepest folder it
 * shares with the folder the check is for (the ancestors of the folder the
 * user chose are theirs to trust), from there down to the path itself.
 */
function partsToLook(base: string, path: string): ReadonlyArray<string> {
  const a = Path.resolve(base).split(Path.sep)
  const target = Path.resolve(path)
  const b = target.split(Path.sep)

  let shared = 0
  while (
    shared < a.length &&
    shared < b.length &&
    sameName(a[shared], b[shared])
  ) {
    shared++
  }

  let current: string
  let rest: string[]
  if (shared === 0) {
    current = Path.parse(target).root
    rest = target.slice(current.length).split(Path.sep)
  } else {
    current = Path.resolve(b.slice(0, shared).join(Path.sep) + Path.sep)
    rest = b.slice(shared)
  }

  const parts = new Array<string>()
  for (const part of rest.filter(p => p !== '')) {
    current = Path.join(current, part)
    parts.push(current)
  }
  return parts
}

/**
 * Look at a path without following a link: the path as text first, then
 * every part of it below the folder it shares with the check's own folder.
 * A link or junction is a refusal, because Windows follows one to a remote
 * target and `lstat` itself follows the ones higher up. Null for a path that
 * is not there or was refused.
 */
async function lookAt(scan: IScan, path: string): Promise<Stats | null> {
  if (isNetworkPath(path)) {
    scan.found.push(show('network path', path))
    return null
  }

  if (++scan.files > MaxFiles) {
    if (scan.files === MaxFiles + 1) {
      scan.found.push('more files than can be checked')
    }
    return null
  }

  const parts = [...partsToLook(scan.base, path)]
  if (parts.length === 0) {
    parts.push(path)
  }

  let info: Stats | null = null
  // When a part with a character Windows refuses was replaced by its MSYS2
  // name, the parts below it are rewritten the same way.
  let renamedFrom = ''
  let renamedTo = ''
  for (const original of parts) {
    let part =
      renamedFrom !== '' && original.startsWith(renamedFrom)
        ? renamedTo + original.slice(renamedFrom.length)
        : original

    // Windows drops trailing dots and spaces from the last part of a name when
    // Git opens it, but not Node's lstat, which then sees nothing there.
    if (isWindows() && hasTrailingDotOrSpace(part)) {
      scan.found.push(show('name ends in a dot or a space', part))
      return null
    }

    // What Windows or an MSYS2 program opens for this name: a stream colon cuts
    // the name (`lnk:stream` opens `lnk`, which lstat would not follow), and
    // `< > " | ? *` end the walk as not there unless the MSYS2 name exists.
    if (isWindows()) {
      const name = Path.basename(part)
      const looked = windowsLookName(name)
      if (looked !== name) {
        renamedFrom = original
        renamedTo = Path.join(Path.dirname(part), looked)
        part = renamedTo
      }
    }

    try {
      info = await lstat(part)
    } catch (e) {
      // Only "not there" is not a problem. Any other error means the check
      // could not look, and Git may still open the path.
      if (!isMissing(e)) {
        scan.found.push(show(`cannot be looked at (${errorCode(e)})`, part))
      } else if (isWindows() && (await hasShortcutBeside(part))) {
        // Cygwin opens `foo` through a read-only `foo.lnk` when `foo` is missing.
        scan.found.push(show('a .lnk shortcut stands for it', `${part}.lnk`))
      }
      return null
    }

    if (info.isSymbolicLink()) {
      scan.found.push(show('link or junction', part))
      return null
    }

    // Cygwin and MSYS2 programs (the ssh-keygen that Git may start) follow
    // links that Node reports as plain files: a .lnk shortcut, and a small
    // file that starts `!<symlink>` or the Interix cookie.
    if (isWindows() && info.isFile()) {
      if (/\.lnk$/i.test(part)) {
        scan.found.push(show('a .lnk shortcut', part))
        return null
      }
      if (info.size >= CygwinLinkCookie.length && info.size <= 4096) {
        if (await startsWithCygwinLinkCookie(part)) {
          scan.found.push(show('a Cygwin or MSYS2 link', part))
          return null
        }
      }
    }
  }

  return info
}

/** The first bytes of a Cygwin or MSYS2 symbolic link written as a file. */
const CygwinLinkCookie = '!<symlink>'
const InterixLinkCookie = 'IntxLNK\x01'

/** Whether a small file starts with the cookie of a Cygwin symlink or an Interix link. */
async function startsWithCygwinLinkCookie(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(CygwinLinkCookie.length)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return isCygwinLinkHead(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

/** Whether these first bytes of a file are the cookie of a Cygwin symlink or an Interix link. */
export function isCygwinLinkHead(head: Buffer): boolean {
  const text = head.toString('latin1')
  return text.startsWith(CygwinLinkCookie) || text.startsWith(InterixLinkCookie)
}

/** Whether `<path>.lnk` is there as a file. */
async function hasShortcutBeside(path: string): Promise<boolean> {
  if (/\.lnk$/i.test(path)) {
    return false
  }
  try {
    return (await lstat(`${path}.lnk`)).isFile()
  } catch {
    return false
  }
}

/**
 * Walk a directory completely and refuse any link or junction in it. Entries
 * are read as the file system lists them, so nothing is followed.
 */
async function walk(scan: IScan, directory: string) {
  const pending = [directory]

  while (pending.length > 0) {
    const current = pending.pop()!
    if (scan.walked.has(current)) {
      continue
    }
    scan.walked.add(current)

    const entries = await readdir(current, { withFileTypes: true }).catch(
      () => null
    )

    // A directory that cannot be listed can still be opened by name.
    if (entries === null) {
      scan.found.push(show('cannot be listed', current))
      continue
    }

    for (const entry of entries) {
      if (++scan.entries > MaxEntries) {
        if (scan.entries === MaxEntries + 1) {
          scan.found.push(
            show('too many entries to check in', current) +
              ' (git gc packs loose objects)'
          )
        }
        return
      }

      const path = Path.join(current, entry.name)
      if (entry.isSymbolicLink()) {
        scan.found.push(show('link or junction', path))
      } else if (entry.isDirectory()) {
        pending.push(path)
      }
    }
  }
}

/** A small regular file's text, or null (missing, or refused and noted). */
async function readChecked(
  scan: IScan,
  path: string,
  /** The text is read as paths: bytes that are not UTF-8 are a refusal. */
  asPaths = false
): Promise<string | null> {
  const info = await lookAt(scan, path)

  if (info === null) {
    return null
  }

  if (!info.isFile() || info.size > MaxBytes) {
    scan.found.push(show('not a small regular file', path))
    return null
  }

  try {
    const text = await readFile(path, 'utf8')

    // Invalid UTF-8 became U+FFFD: the name read here would not be the one
    // Git reads. Only where the text names paths; a config file Git reads
    // fine (an ANSI comment, a name with an umlaut) is not refused for it.
    if (asPaths && text.includes('\uFFFD')) {
      scan.found.push(show('not valid UTF-8', path))
      return null
    }

    return text
  } catch (e) {
    if (!isMissing(e)) {
      scan.found.push(show(`cannot be read (${errorCode(e)})`, path))
    }
    return null
  }
}

/** The subsection of a key such as `url.<base>.insteadof`, or null. */
function subsectionOf(key: string): string | null {
  const first = key.indexOf('.')
  const last = key.lastIndexOf('.')
  return first === -1 || first === last ? null : key.slice(first + 1, last)
}

/** Entries of one config file as Git parses it, or null when Git cannot. */
async function listConfigFile(
  file: string
): Promise<ReadonlyArray<{ key: string; value: string }> | null> {
  // From an empty folder of our own, with nothing above it to look in.
  const cwd = Path.join(tmpdir(), 'lodestone-empty-cwd')
  await mkdir(cwd, { recursive: true }).catch(() => undefined)
  const result = await exec(
    ['config', '--file', file, '--no-includes', '--list', '-z'],
    cwd,
    { env: { GIT_CEILING_DIRECTORIES: tmpdir() } }
  ).catch(() => null)

  if (result === null || result.exitCode !== 0) {
    return null
  }

  return result.stdout
    .split('\0')
    .filter(e => e !== '')
    .map(e => {
      const newline = e.indexOf('\n')
      return newline === -1
        ? { key: e, value: '' }
        : { key: e.slice(0, newline), value: e.slice(newline + 1) }
    })
}

/**
 * Keys whose value is a path Git opens, or a directory it runs hooks from.
 * Taken from Git's source (master at f7de814569, read on 2026-11-20): every
 * call of `git_config_pathname` and `repo_config_get_pathname`, plus
 * `user.signingkey`, which `ssh-keygen` reads as a file when `gpg.format` is
 * `ssh`. The app's own calls reach these: `diff.orderFile` (every porcelain
 * diff, log and show: diff.ts, diff-check.ts, log.ts, show.ts),
 * `format.signatureFile` (format-patch.ts), `core.excludesFile` and
 * `core.attributesFile` (status and diff), `core.hooksPath` (every hook),
 * `mailmap.file` (log, which has `log.mailmap` on), and `user.signingkey`
 * with `commit.gpgsign` (commit). The others are opened by Git when a command
 * the app does not run today asks for them, or when the user's own
 * configuration turns an option on (`fetch.fsckObjects` for the skip lists);
 * they are looked at the same way, so a link in a relative value cannot reach
 * a network path.
 */
export const PathKeys: ReadonlySet<string> = new Set([
  'core.excludesfile',
  'core.attributesfile',
  'core.hookspath',
  'mailmap.file',
  'diff.orderfile',
  'format.signaturefile',
  'commit.template',
  'blame.ignorerevsfile',
  'gpg.ssh.allowedsignersfile',
  'gpg.ssh.revocationfile',
  'fsck.skiplist',
  'fetch.fsck.skiplist',
  'receive.fsck.skiplist',
  'http.sslcainfo',
  'http.sslcapath',
  'http.cookiefile',
  'http.sslcert',
  'http.sslkey',
  'http.pinnedpubkey',
  'http.proxysslcert',
  'http.proxysslkey',
  'http.proxysslcainfo',
  'user.signingkey',
])

/** The last part of a `http.<url>.<key>` key that names a file (Git's urlmatch). */
const HttpScopedPathKeys = new Set(
  [...PathKeys]
    .filter(k => k.startsWith('http.'))
    .map(k => k.slice('http.'.length))
)

/**
 * The path a key's value names, to be looked at, or null when the key is not
 * one that names a path or the value is not one (a literal key, an id).
 */
function pathNamedBy(lower: string, value: string): string | null {
  const scoped = /^http\..+\.([^.]+)$/.exec(lower)
  const isPathKey =
    PathKeys.has(lower) ||
    (scoped !== null && HttpScopedPathKeys.has(scoped[1]))

  if (!isPathKey || value === '' || value.startsWith('~')) {
    return null
  }

  // http.pinnedPubKey takes a hash as well as a file.
  if (/pinnedpubkey$/.test(lower) && value.startsWith('sha256//')) {
    return null
  }

  // user.signingkey is a key id, an e-mail address, a name with an address or
  // a path, and ssh-keygen opens it as a file. Only `key::` and `ssh-` mark a
  // literal key, exactly as Git reads it (is_literal_ssh_key). Every other
  // value is looked at: a link named like an id is opened as a file. A value
  // that Windows cannot name (`Name <me@example.com>`) ends lookAt's walk as
  // not there. A drive-relative path and a name with a stream are read as Windows does
  // by Path.resolve and by lookAt.
  if (lower === 'user.signingkey') {
    if (/^(key::|ssh-)/.test(value)) {
      return null
    }
    // A value with `< > " | ? *` (`Name <me@example.com>`) is resolved like any
    // other: the parts before such a character are looked at (`lnk/a<b`), and
    // lookAt ends the walk at the part that holds it.
  }

  return value
}

/**
 * Check one config file, and follow the files it includes. A file is scanned
 * again when it is reached at a smaller depth than before, because what
 * follows it may then be within the limit.
 */
async function scanConfig(scan: IScan, file: string, depth: number) {
  const before = scan.configs.get(file)
  if (
    depth > MaxIncludeDepth + 1 ||
    (before !== undefined && before <= depth)
  ) {
    return
  }
  scan.configs.set(file, depth)

  // Git looks at the include one level past its limit before it stops, so the
  // file is looked at before the depth is.
  if (depth > MaxIncludeDepth) {
    await lookAt(scan, file)
    return
  }

  if ((await readChecked(scan, file)) === null) {
    return
  }

  const entries = await listConfigFile(file)
  if (entries === null) {
    scan.found.push(show('Git cannot parse', file))
    return
  }

  for (const { key, value } of entries) {
    const subsection = subsectionOf(key)
    const lower = key.toLowerCase()

    // A value or subsection that names a path, with bytes that are not UTF-8:
    // Git reads another name than the U+FFFD this check has. (Git for Windows
    // maps such bytes to Latin-1, `j\xe4` is `jä`.) Refuse it. Other values,
    // `user.name` with an umlaut among them, are not paths.
    const namesPath =
      lower === 'include.path' ||
      /^includeif\..+\.path$/.test(lower) ||
      pathNamedBy(lower, value) !== null ||
      PathKeys.has(lower) ||
      lower.startsWith('url.')
    if (
      namesPath &&
      (value.includes('\uFFFD') || (subsection ?? '').includes('\uFFFD'))
    ) {
      scan.found.push(show('not valid UTF-8', `${Path.basename(file)}: ${key}`))
      continue
    }

    if (
      isNetworkPath(value) ||
      (subsection !== null &&
        (isNetworkPath(subsection) ||
          // An includeIf condition is `gitdir:<path>`, `onbranch:<name>`, ...
          (lower.startsWith('includeif.') &&
            isNetworkPath(subsection.replace(/^[a-z/]+:/i, '')))))
    ) {
      scan.found.push(show(Path.basename(file), `${key} = ${value}`))
    } else if (
      lower === 'include.path' ||
      /^includeif\..+\.path$/.test(lower)
    ) {
      await scanConfig(scan, Path.resolve(Path.dirname(file), value), depth + 1)
    } else {
      // Git opens (or runs hooks from) this path: look at it part by part.
      const named = pathNamedBy(lower, value)
      if (named !== null) {
        const target = Path.resolve(scan.base, named)
        await lookAt(scan, target)
        if (lower === 'core.hookspath') {
          await walk(scan, target)
        }

        // ssh-keygen may be an MSYS2 or Cygwin build, which reads the name by
        // other rules: look at that reading as well.
        if (isWindows() && SshKeygenKeys.has(lower)) {
          const reading = cygwinReading(named)
          if (reading.refuse !== undefined) {
            scan.found.push(show(reading.refuse, `${key} = ${named}`))
          } else if (reading.relative !== undefined) {
            await lookAt(scan, Path.resolve(scan.base, reading.relative))
          }
        }
      }
    }
  }
}

/**
 * Git's `unquote_c_style` for an alternates line: the line starts with a
 * quote and ends at the closing one; `\a \b \f \n \r \t \v \\ \"` and
 * three-digit octal escapes are decoded. Null when Git would not accept it.
 */
export function unquoteAlternate(line: string): string | null {
  if (!line.startsWith('"')) {
    return line
  }

  const bytes = new Array<number>()
  const simple: Record<string, number> = {
    a: 7,
    b: 8,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
    '\\': 92,
    '"': 34,
  }
  const text = Buffer.from(line.slice(1), 'utf8')

  for (let i = 0; i < text.length; i++) {
    const c = String.fromCharCode(text[i])

    if (c === '"') {
      return i === text.length - 1 ? Buffer.from(bytes).toString('utf8') : null
    }

    if (c !== '\\') {
      bytes.push(text[i])
      continue
    }

    const next = String.fromCharCode(text[i + 1])
    if (next in simple) {
      bytes.push(simple[next])
      i++
    } else if (/[0-3]/.test(next)) {
      const octal = text.subarray(i + 1, i + 4).toString('latin1')
      if (!/^[0-3][0-7][0-7]$/.test(octal)) {
        return null
      }
      bytes.push(parseInt(octal, 8))
      i += 3
    } else {
      return null
    }
  }

  // No closing quote.
  return null
}

/** Follow an alternates file and those its entries have, to a depth of 5. */
async function scanAlternates(scan: IScan, objects: string, depth: number) {
  const file = Path.join(objects, 'info', 'alternates')
  const before = scan.alternates.get(file)
  if (
    depth > MaxAlternatesDepth + 1 ||
    (before !== undefined && before <= depth)
  ) {
    return
  }
  scan.alternates.set(file, depth)

  // Git looks at the file one level past its limit before it stops.
  if (depth > MaxAlternatesDepth) {
    await lookAt(scan, file)
    return
  }

  const text = await readChecked(scan, file, true)

  // Lines as Git reads them: split at a line feed only, nothing trimmed.
  for (const line of text?.split('\n') ?? []) {
    if (line === '' || line.startsWith('#')) {
      continue
    }

    const entry = unquoteAlternate(line)
    if (entry === null) {
      scan.found.push(show('alternates line Git would not accept', line))
    } else if (isNetworkPath(entry)) {
      scan.found.push(show('alternates', entry))
    } else {
      await scanAlternates(scan, Path.resolve(objects, entry), depth + 1)
    }
  }
}

/** Check one Git directory: walk it, then its files and its common directory. */
async function scanGitDirectory(scan: IScan, directory: string) {
  if (scan.gitDirectories.has(directory)) {
    return
  }
  scan.gitDirectories.add(directory)

  // Nothing in it is read, nor does Git run in it, before it is known to hold
  // no link. The modules of submodules are inside it and are walked with it.
  if ((await lookAt(scan, directory)) === null) {
    return
  }
  await walk(scan, directory)
  if (scan.found.length > 0) {
    return
  }

  await scanConfig(scan, Path.join(directory, 'config'), 0)
  await scanConfig(scan, Path.join(directory, 'config.worktree'), 0)
  await scanAlternates(scan, Path.join(directory, 'objects'), 0)

  // In a linked work tree the common directory holds config and objects.
  const raw = await readChecked(scan, Path.join(directory, 'commondir'), true)
  const common = raw?.replace(/\n$/, '')
  if (common !== undefined && common !== '') {
    if (/^\s|\s$|\uFEFF|\0/.test(common)) {
      scan.found.push(show('commondir is not a plain path', common))
    } else if (isNetworkPath(common)) {
      scan.found.push(show('commondir', common))
    } else {
      await scanGitDirectory(scan, Path.resolve(directory, common))
    }
  }

  // Submodule Git directories under modules/ have a config of their own.
  await scanModuleConfigs(scan, Path.join(directory, 'modules'))
}

/** Scan the config and alternates of the Git directories under `modules`. */
async function scanModuleConfigs(scan: IScan, modules: string, depth = 0) {
  if (depth > 8) {
    return
  }

  let entries
  try {
    entries = await readdir(modules, { withFileTypes: true })
  } catch (e) {
    if (!isMissing(e)) {
      scan.found.push(show(`cannot be listed (${errorCode(e)})`, modules))
    }
    return
  }

  for (const entry of entries) {
    const directory = Path.join(modules, entry.name)
    if (!entry.isDirectory()) {
      continue
    }

    let isGitDirectory = false
    try {
      await lstat(Path.join(directory, 'HEAD'))
      isGitDirectory = true
    } catch (e) {
      if (!isMissing(e)) {
        scan.found.push(
          show(`cannot be looked at (${errorCode(e)})`, directory)
        )
        continue
      }
    }

    if (isGitDirectory) {
      await scanGitDirectory(scan, directory)
    } else {
      await scanModuleConfigs(scan, directory, depth + 1)
    }
  }
}

/**
 * The target a `.git` file names, byte for byte as Git reads it: the content
 * must start with exactly `gitdir: `, and only trailing line ends are cut.
 * Leading spaces belong to the path. Null for anything else, a leading byte
 * order mark and a second line included.
 */
export function parseGitFile(text: string): string | null {
  if (!text.startsWith('gitdir: ') || text.length > 4096) {
    return null
  }

  const target = text.slice('gitdir: '.length).replace(/[\r\n]+$/, '')
  return target === '' || /[\r\n\0]/.test(target) ? null : target
}

/** The target of a `.git` file, or null when it is not a plain gitdir file. */
async function gitFileTarget(
  scan: IScan,
  file: string
): Promise<string | null> {
  const text = await readChecked(scan, file, true)
  const target = text === null ? null : parseGitFile(text)

  if (target === null) {
    scan.found.push(show('not a plain gitdir file', file))
    return null
  }

  if (isNetworkPath(target)) {
    scan.found.push(show('network path', `${file} -> ${target}`))
    return null
  }

  return Path.resolve(Path.dirname(file), target)
}

/** A `.git` entry (a directory, or a file naming one): scan what it leads to. */
async function scanDotGit(scan: IScan, dotGit: string) {
  const info = await lookAt(scan, dotGit)

  if (info === null) {
    return
  }

  if (info.isDirectory()) {
    await scanGitDirectory(scan, dotGit)
  } else {
    const target = await gitFileTarget(scan, dotGit)
    if (target !== null) {
      await scanGitDirectory(scan, target)
    }
  }
}

/** Where populated submodules are, from the index: the gitlinks. */
async function gitlinkPaths(folder: string): Promise<ReadonlyArray<string>> {
  const staged = await exec(
    [
      '--no-pager',
      '-c',
      'safe.bareRepository=explicit',
      'ls-files',
      '--stage',
      '-z',
    ],
    folder
  ).catch(() => null)

  const paths = new Array<string>()
  for (const record of staged?.stdout.split('\0') ?? []) {
    const match = /^160000 [0-9a-f]+ \d\t(.+)$/.exec(record)
    if (match !== null) {
      paths.push(match[1])
    }
  }
  return paths
}

/** Scan the files of one Git directory, as the repository at `base` has it. */
export async function findNetworkPathsInGitDirectory(
  directory: string
): Promise<ReadonlyArray<string>> {
  const scan = newScan(directory)
  await scanGitDirectory(scan, directory)
  return scan.found
}

/**
 * Why a repository folder is refused: the network or device paths it names,
 * and what cannot be read safely. Empty when there is nothing. Opens nothing
 * that is itself a network path, and asks Git nothing until the files Git
 * would read on its first call have been checked.
 */
export async function findNetworkPaths(
  folder: string
): Promise<ReadonlyArray<string>> {
  const scan = newScan(folder)
  const dotGit = Path.join(folder, '.git')

  try {
    await lstat(dotGit)
  } catch (e) {
    return isMissing(e)
      ? []
      : [show(`cannot be looked at (${errorCode(e)})`, dotGit)]
  }

  await scanDotGit(scan, dotGit)

  // Only now is it safe to ask Git for the index, to find the submodules.
  if (scan.found.length === 0) {
    for (const submodule of await gitlinkPaths(folder)) {
      await scanDotGit(scan, Path.join(folder, submodule, '.git'))
    }
  }

  return scan.found
}

/**
 * The same for a folder and every folder above it, because Git looks for the
 * `.git` entry upwards from where it is asked.
 */
export async function findNetworkPathsUpward(
  folder: string
): Promise<ReadonlyArray<string>> {
  let current = Path.resolve(folder)

  for (let i = 0; i < 64; i++) {
    const found = await findNetworkPaths(current)
    if (found.length > 0) {
      return found
    }

    const parent = Path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return []
}
