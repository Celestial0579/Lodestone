/**
 * Reading what a repository brings with it: its own configuration, including
 * the files that include, and its hooks (#98). Reading changes nothing and
 * runs no program: `git config --list` and a directory listing.
 */

import { exec } from 'dugite'
import { lstat, readdir, readFile } from 'fs/promises'
import {
  findNetworkPathsInGitDirectory,
  isNetworkPath,
} from './repository-trust-paths'
import { setRepositoryRefusal } from './repository-trust-state'
import * as Path from 'path'
import {
  findRepositoryFindings,
  IConfigEntry,
  IHookFile,
  IRepositoryFindings,
  parseConfigList,
  sha256Hex,
} from './repository-trust'

const ReadOnly = ['--no-pager', '-c', 'safe.bareRepository=explicit']

/** A hook larger than this is hashed by its first part and its size. */
const MaxHookBytes = 5 * 1024 * 1024

async function readHooks(directory: string): Promise<ReadonlyArray<IHookFile>> {
  // Entries as the file system lists them: nothing is followed through a link.
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => []
  )
  const hooks = new Array<IHookFile>()

  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = entry.name
    const path = Path.join(directory, name)

    if (entry.isSymbolicLink()) {
      // Not read; it changes the fingerprint and is asked about as a hook.
      hooks.push({ name, sha256: 'link' })
      continue
    }

    const info = entry.isFile() ? await lstat(path).catch(() => null) : null

    if (info === null || !info.isFile()) {
      continue
    }

    const bytes = await readFile(path).catch(() => Buffer.alloc(0))
    const head = bytes.subarray(0, MaxHookBytes)
    const sha256 = sha256Hex(
      info.size > MaxHookBytes
        ? Buffer.concat([head, Buffer.from(`size:${info.size}`)])
        : head
    )
    hooks.push({ name, sha256 })
  }

  return hooks
}

const isInside = (parent: string, child: string) => {
  const relative = Path.relative(parent, child)
  return (
    relative !== '' && !relative.startsWith('..') && !Path.isAbsolute(relative)
  )
}

const isGitDirectory = (directory: string) =>
  lstat(Path.join(directory, 'HEAD')).then(
    i => i.isFile(),
    () => false
  )

/** Git directories under a `modules` directory, nested modules included. */
async function collectModuleDirectories(
  modules: string,
  found: Set<string>,
  depth = 0
) {
  if (depth > 8) {
    return
  }

  // Directory entries as they are: a link or junction is not a directory here.
  const entries = await readdir(modules, { withFileTypes: true }).catch(
    () => []
  )

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const directory = Path.join(modules, entry.name)

    if (await isGitDirectory(directory)) {
      found.add(directory)
      await collectModuleDirectories(
        Path.join(directory, 'modules'),
        found,
        depth + 1
      )
    } else {
      await collectModuleDirectories(directory, found, depth + 1)
    }
  }
}

/**
 * The Git directories of the submodules: those under `modules`, and the target
 * of the `.git` file in every populated submodule, which can point anywhere.
 */
async function findSubmoduleDirectories(
  path: string,
  workTree: string,
  commonDir: string,
  notes: string[]
): Promise<ReadonlyArray<string>> {
  const found = new Set<string>()
  await collectModuleDirectories(Path.join(commonDir, 'modules'), found)

  const staged = await exec(
    [...ReadOnly, 'ls-files', '--stage', '-z'],
    path
  ).catch(() => null)

  for (const record of staged?.stdout.split('\0') ?? []) {
    const match = /^160000 [0-9a-f]+ \d\t(.+)$/.exec(record)
    if (match === null) {
      continue
    }

    const submodulePath = Path.join(workTree, match[1])
    const dotGit = Path.join(submodulePath, '.git')
    const info = await lstat(dotGit).catch(() => null)

    if (info === null) {
      continue
    }

    if (info.isDirectory()) {
      found.add(dotGit)
      continue
    }

    // A .git file can point anywhere, a network path included. Only a small
    // regular file is read, and only a target inside this repository's own
    // Git directory is followed; any other target is a finding, not read.
    const text =
      info.isFile() && info.size <= 4096
        ? await readFile(dotGit, 'utf8').catch(() => '')
        : ''
    const target = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1]

    if (target === undefined) {
      notes.push(
        `submodule ${match[1]}: its .git entry is not a plain gitdir file`
      )
      continue
    }

    const directory = Path.resolve(submodulePath, target)
    if (isNetworkPath(target) || !isInside(commonDir, directory)) {
      notes.push(
        `submodule ${match[1]}: its .git file points outside this repository's .git directory: ${target}`
      )
      continue
    }

    found.add(directory)
    await collectModuleDirectories(Path.join(directory, 'modules'), found)
  }

  return [...found].sort()
}

/** A submodule's own configuration, read as if it were the repository's. */
async function readSubmoduleConfig(
  path: string,
  directory: string,
  label: string
): Promise<ReadonlyArray<IConfigEntry>> {
  const result = await exec(
    [
      ...ReadOnly,
      'config',
      '--list',
      '--show-origin',
      '--show-scope',
      '-z',
      '--includes',
      '--file',
      Path.join(directory, 'config'),
    ],
    path
  ).catch(() => null)

  if (result === null || result.exitCode !== 0) {
    return []
  }

  return parseConfigList(result.stdout).map(e => ({
    ...e,
    scope: 'local',
    submodule: label,
  }))
}

/**
 * What the repository at `path` brings with it, or null if Git could not be
 * asked (not a repository, or one Git refuses). A repository that cannot be
 * read stays untrusted.
 */
export async function readRepositoryFindings(
  path: string
): Promise<IRepositoryFindings | null> {
  const config = await exec(
    [...ReadOnly, 'config', '--list', '--show-origin', '--show-scope', '-z'],
    path
  ).catch(() => null)

  const dirs = await exec(
    [
      ...ReadOnly,
      'rev-parse',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
    ],
    path
  ).catch(() => null)

  if (
    config === null ||
    config.exitCode !== 0 ||
    dirs === null ||
    dirs.exitCode !== 0
  ) {
    return null
  }

  const [toplevel, gitDir, commonDir] = dirs.stdout.split('\n')
  const workTree = Path.resolve(path, toplevel)
  const gitDirectories = [
    Path.resolve(path, gitDir),
    Path.resolve(path, commonDir),
  ]
  const entries = parseConfigList(config.stdout)

  const resolveOrigin = (origin: string) => Path.resolve(path, origin)
  const isInWorkTree = (file: string) => {
    const absolute = Path.resolve(path, file)
    return (
      isInside(workTree, absolute) &&
      !gitDirectories.some(g => absolute === g || isInside(g, absolute))
    )
  }

  const hooksPathEntry = entries.find(
    e =>
      (e.scope === 'local' || e.scope === 'worktree') &&
      e.key.toLowerCase() === 'core.hookspath'
  )
  const hooksPath =
    hooksPathEntry === undefined
      ? null
      : Path.resolve(workTree, hooksPathEntry.value)

  const notes = new Array<string>()
  const submoduleDirectories = await findSubmoduleDirectories(
    path,
    workTree,
    gitDirectories[1],
    notes
  )
  // A submodule's configuration and alternates name paths Git opens too.
  const submoduleNetworkPaths = new Array<string>()
  for (const directory of submoduleDirectories) {
    submoduleNetworkPaths.push(
      ...(await findNetworkPathsInGitDirectory(directory))
    )
  }
  if (submoduleNetworkPaths.length > 0) {
    setRepositoryRefusal(path, submoduleNetworkPaths)
    return null
  }

  const submoduleEntries = new Array<IConfigEntry>()
  const submoduleHooks = new Array<IHookFile>()

  for (const directory of submoduleDirectories) {
    const label = isInside(workTree, directory)
      ? Path.relative(workTree, directory)
      : directory
    submoduleEntries.push(
      ...(await readSubmoduleConfig(path, directory, label))
    )
    for (const h of await readHooks(Path.join(directory, 'hooks'))) {
      submoduleHooks.push({
        name: `submodule ${label}/hooks/${h.name}`,
        sha256: h.sha256,
      })
    }
  }

  const hooks = [
    ...submoduleHooks,
    ...(await readHooks(Path.join(gitDirectories[1], 'hooks'))),
    ...(hooksPath === null
      ? []
      : (await readHooks(hooksPath)).map(h => ({
          name: `core.hooksPath/${h.name}`,
          sha256: h.sha256,
        }))),
  ]

  const findings = findRepositoryFindings(
    entries
      .map(e =>
        e.origin.startsWith('file:')
          ? { ...e, origin: `file:${resolveOrigin(e.origin.slice(5))}` }
          : e
      )
      .concat(submoduleEntries),
    hooks,
    isInWorkTree
  )

  return {
    ...findings,
    hooksPathInWorkTree: hooksPath !== null && isInWorkTree(hooksPath),
    notes,
  }
}
