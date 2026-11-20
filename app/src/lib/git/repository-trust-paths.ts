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
 * Refused as well: a file Git cannot parse (Git follows an include as soon as
 * it reaches it, before it fails on a later line), a quoted alternates line
 * that does not decode, a link or junction where the repository's own files
 * are, and a file that is not a small regular file.
 */

import { exec } from 'dugite'
import { lstat, readdir, readFile } from 'fs/promises'
import type { Stats } from 'fs'
import { tmpdir } from 'os'
import * as Path from 'path'

/** Longest file read. */
const MaxBytes = 1024 * 1024

/** Most files looked at for one repository. */
const MaxFiles = 400

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

const isInside = (parent: string, child: string) => {
  const relative = Path.relative(parent, child)
  return (
    relative !== '' && !relative.startsWith('..') && !Path.isAbsolute(relative)
  )
}

const show = (where: string, value: string) =>
  `${where}: ${value.replace(/[\x00-\x1f\x7f]/g, '?')}`

interface IScan {
  /** Why the repository is refused. */
  readonly found: string[]
  /** Files and directories looked at, against a limit. */
  files: number
  /** The smallest include depth a config file was scanned at. */
  readonly configs: Map<string, number>
  readonly alternates: Map<string, number>
  readonly gitDirectories: Set<string>
}

const newScan = (): IScan => ({
  found: [],
  files: 0,
  configs: new Map(),
  alternates: new Map(),
  gitDirectories: new Set(),
})

/**
 * Look at a path without following a link: the path as text first, then every
 * part of it below `base` (for a path outside `base`, its folder and itself).
 * A link or junction is a refusal, because Windows follows one to a remote
 * target. Null for a path that is not there or was refused.
 */
async function lookAt(
  scan: IScan,
  path: string,
  base: string | null
): Promise<Stats | null> {
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

  const parts: string[] = []
  if (base !== null && isInside(base, path)) {
    let current = base
    for (const part of Path.relative(base, path).split(Path.sep)) {
      current = Path.join(current, part)
      parts.push(current)
    }
  } else {
    parts.push(Path.dirname(path), path)
  }

  let info: Stats | null = null
  for (const part of parts) {
    try {
      info = await lstat(part)
    } catch {
      return null
    }

    if (info.isSymbolicLink()) {
      scan.found.push(show('link or junction', part))
      return null
    }
  }

  return info
}

/** A small regular file's text, or null (missing, or refused and noted). */
async function readChecked(
  scan: IScan,
  path: string,
  base: string | null
): Promise<string | null> {
  const info = await lookAt(scan, path, base)

  if (info === null) {
    return null
  }

  if (!info.isFile() || info.size > MaxBytes) {
    scan.found.push(show('not a small regular file', path))
    return null
  }

  try {
    return await readFile(path, 'utf8')
  } catch {
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
  // From a folder outside the repository, with nothing above it to look in.
  const result = await exec(
    ['config', '--file', file, '--no-includes', '--list', '-z'],
    tmpdir(),
    { env: { GIT_CEILING_DIRECTORIES: Path.dirname(tmpdir()) } }
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
 * Check one config file, and follow the files it includes. A file is scanned
 * again when it is reached at a smaller depth than before, because what
 * follows it may then be within the limit.
 */
async function scanConfig(
  scan: IScan,
  file: string,
  base: string | null,
  depth: number
) {
  const before = scan.configs.get(file)
  if (depth > MaxIncludeDepth || (before !== undefined && before <= depth)) {
    return
  }
  scan.configs.set(file, depth)

  if ((await readChecked(scan, file, base)) === null) {
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

    if (
      isNetworkPath(value) ||
      (subsection !== null &&
        (isNetworkPath(subsection) ||
          isNetworkPath(subsection.replace(/^[a-z/]+:/i, ''))))
    ) {
      scan.found.push(show(Path.basename(file), `${key} = ${value}`))
    } else if (
      lower === 'include.path' ||
      /^includeif\..+\.path$/.test(lower)
    ) {
      await scanConfig(
        scan,
        Path.resolve(Path.dirname(file), value),
        base,
        depth + 1
      )
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
async function scanAlternates(
  scan: IScan,
  objects: string,
  base: string | null,
  depth: number
) {
  const file = Path.join(objects, 'info', 'alternates')
  const before = scan.alternates.get(file)
  if (depth > MaxAlternatesDepth || (before !== undefined && before <= depth)) {
    return
  }
  scan.alternates.set(file, depth)

  const text = await readChecked(scan, file, base)

  for (const raw of text?.split(/\r?\n/) ?? []) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }

    const entry = unquoteAlternate(line)
    if (entry === null) {
      scan.found.push(show('alternates line Git would not accept', line))
    } else if (isNetworkPath(entry)) {
      scan.found.push(show('alternates', entry))
    } else {
      await scanAlternates(scan, Path.resolve(objects, entry), null, depth + 1)
    }
  }
}

/** Git directories of submodules under `modules`, never through a link. */
async function scanModules(
  scan: IScan,
  modules: string,
  base: string | null,
  depth = 0
) {
  if (depth > 8) {
    return
  }

  const entries = await readdir(modules, { withFileTypes: true }).catch(
    () => []
  )

  for (const entry of entries) {
    const directory = Path.join(modules, entry.name)

    if (entry.isSymbolicLink()) {
      scan.found.push(show('link or junction', directory))
    } else if (entry.isDirectory()) {
      if (await lstat(Path.join(directory, 'HEAD')).catch(() => null)) {
        await scanGitDirectory(scan, directory, base)
      } else {
        await scanModules(scan, directory, base, depth + 1)
      }
    }
  }
}

/** Check one Git directory: its files, its common directory and its modules. */
async function scanGitDirectory(
  scan: IScan,
  directory: string,
  base: string | null
) {
  if (scan.gitDirectories.has(directory)) {
    return
  }
  scan.gitDirectories.add(directory)

  await scanConfig(scan, Path.join(directory, 'config'), base, 0)
  await scanConfig(scan, Path.join(directory, 'config.worktree'), base, 0)
  await scanAlternates(scan, Path.join(directory, 'objects'), base, 0)

  // In a linked work tree the common directory holds config and objects.
  const common = (
    await readChecked(scan, Path.join(directory, 'commondir'), base)
  )?.trim()
  if (common !== undefined && common !== '') {
    if (isNetworkPath(common)) {
      scan.found.push(show('commondir', common))
    } else {
      await scanGitDirectory(scan, Path.resolve(directory, common), null)
    }
  }

  await scanModules(scan, Path.join(directory, 'modules'), base)
}

/** The target of a `.git` file, or null when it is not a plain gitdir file. */
async function gitFileTarget(
  scan: IScan,
  file: string,
  base: string | null
): Promise<string | null> {
  const text = await readChecked(scan, file, base)
  const target =
    text === null || text.length > 4096
      ? undefined
      : /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1]

  if (target === undefined) {
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
async function scanDotGit(scan: IScan, dotGit: string, base: string | null) {
  const info = await lookAt(scan, dotGit, base)

  if (info === null) {
    return
  }

  if (info.isDirectory()) {
    await scanGitDirectory(scan, dotGit, base)
  } else {
    const target = await gitFileTarget(scan, dotGit, base)
    if (target !== null) {
      await scanGitDirectory(scan, target, null)
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
  const scan = newScan()
  await scanGitDirectory(scan, directory, null)
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
  const scan = newScan()
  const dotGit = Path.join(folder, '.git')

  if (!(await lstat(dotGit).catch(() => null))) {
    return []
  }

  await scanDotGit(scan, dotGit, folder)

  // Only now is it safe to ask Git for the index, to find the submodules.
  if (scan.found.length === 0) {
    for (const submodule of await gitlinkPaths(folder)) {
      await scanDotGit(scan, Path.join(folder, submodule, '.git'), folder)
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
