/**
 * Paths that Git itself opens on every call and that can name another
 * machine (#98). On Windows, reading `\\host\share\...` connects to that host
 * and sends the user's credentials. So before Git runs in a folder, the files
 * that name such paths are read here as plain text, with the path checked as a
 * string first, and a repository that names a network or device path is
 * refused.
 *
 * Read: the `.git` file at the top (and the file's target when it lies
 * elsewhere), `config` and `config.worktree` of the Git directory (with
 * Git's own parser, `git config --file <f> --no-includes --list -z`, run from
 * a folder outside the repository), the local files named by `include.path`
 * and `includeIf.*.path` (to a depth of 10), and the alternates file (to a
 * depth of 5). Keys are checked as well as values, since a network path can
 * be a subsection name (`url.<base>.insteadOf`). Only small regular files are
 * read, and links are not followed.
 */

import { exec } from 'dugite'
import { lstat, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'

/** Longest file read as text. */
const MaxBytes = 1024 * 1024

/**
 * Whether a path value is a network or device path: `\\host\share`,
 * `//host/share`, `\\?\UNC\...`, `\\.\...`. Config files write a backslash
 * twice, so both forms are checked.
 */
export function isNetworkPath(value: string): boolean {
  const trimmed = value.trim().replace(/^"/, '')
  const candidates = [trimmed, trimmed.replace(/\\\\/g, '\\')]
  return candidates.some(c => /^(\\\\|\/\/)/.test(c) || /^\\\\[?.]\\/.test(c))
}

async function readSmallFile(path: string): Promise<string | null> {
  if (isNetworkPath(path)) {
    return null
  }

  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > MaxBytes) {
      return null
    }
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const describe = (where: string, value: string) =>
  `${where}: ${value.replace(/[\x00-\x1f\x7f]/g, '?')}`

/** The subsection of a key such as `url.<base>.insteadof`, or null. */
function subsectionOf(key: string): string | null {
  const first = key.indexOf('.')
  const last = key.lastIndexOf('.')
  return first === -1 || first === last ? null : key.slice(first + 1, last)
}

/** Entries of one config file as Git parses it, without following includes. */
async function listConfigFile(
  file: string
): Promise<ReadonlyArray<{ key: string; value: string }>> {
  // From a folder outside the repository, so that no repository is opened.
  const result = await exec(
    ['config', '--file', file, '--no-includes', '--list', '-z'],
    tmpdir()
  ).catch(() => null)

  if (result === null || result.exitCode !== 0) {
    return []
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

/** Check one config file, and follow the local files it includes. */
async function scanConfig(
  file: string,
  found: string[],
  seen: Set<string>,
  depth: number
) {
  if (seen.has(file) || depth > 10) {
    return
  }
  seen.add(file)

  // Only a small regular file is handed to Git.
  if ((await readSmallFile(file)) === null) {
    return
  }

  for (const { key, value } of await listConfigFile(file)) {
    const subsection = subsectionOf(key)
    const lower = key.toLowerCase()

    if (
      isNetworkPath(value) ||
      (subsection !== null &&
        (isNetworkPath(subsection) ||
          isNetworkPath(subsection.replace(/^[a-z/]+:/i, ''))))
    ) {
      found.push(describe(Path.basename(file), `${key} = ${value}`))
    } else if (
      lower === 'include.path' ||
      /^includeif\..+\.path$/.test(lower)
    ) {
      await scanConfig(
        Path.resolve(Path.dirname(file), value),
        found,
        seen,
        depth + 1
      )
    }
  }
}

/** Follow an alternates file and the ones its entries have, to a depth of 5. */
async function scanAlternates(
  objects: string,
  found: string[],
  seen: Set<string>,
  depth: number
) {
  const file = Path.join(objects, 'info', 'alternates')
  if (seen.has(file) || depth > 5) {
    return
  }
  seen.add(file)

  const text = await readSmallFile(file)
  for (const raw of text?.split(/\r?\n/) ?? []) {
    let line = raw.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    if (line.startsWith('"') && line.endsWith('"')) {
      line = line.slice(1, -1).replace(/\\(.)/g, '$1')
    }

    if (isNetworkPath(line)) {
      found.push(describe('alternates', line))
    } else {
      await scanAlternates(Path.resolve(objects, line), found, seen, depth + 1)
    }
  }
}

/** Scan the files of one Git directory. */
export async function findNetworkPathsInGitDirectory(
  directory: string
): Promise<ReadonlyArray<string>> {
  const found = new Array<string>()
  const seen = new Set<string>()
  await scanConfig(Path.join(directory, 'config'), found, seen, 0)
  await scanConfig(Path.join(directory, 'config.worktree'), found, seen, 0)
  await scanAlternates(Path.join(directory, 'objects'), found, new Set(), 0)
  return found
}

/**
 * The network or device paths a repository folder names, as text. Empty when
 * there are none. Opens nothing that is itself a network path.
 */
export async function findNetworkPaths(
  folder: string
): Promise<ReadonlyArray<string>> {
  const dotGit = Path.join(folder, '.git')

  let info
  try {
    info = await lstat(dotGit)
  } catch {
    return []
  }

  if (info.isDirectory()) {
    return findNetworkPathsInGitDirectory(dotGit)
  }

  const text =
    info.isFile() && info.size <= 4096 ? await readSmallFile(dotGit) : null
  const target =
    text === null ? undefined : /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1]

  if (target === undefined) {
    return []
  }

  if (isNetworkPath(target)) {
    return [describe('.git file', target)]
  }

  return findNetworkPathsInGitDirectory(Path.resolve(folder, target))
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
