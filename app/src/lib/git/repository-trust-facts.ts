/**
 * Reading what a repository brings with it: its own configuration, including
 * the files that include, and its hooks (#98). Reading changes nothing and
 * runs no program: `git config --list` and a directory listing.
 */

import { exec } from 'dugite'
import { readdir, readFile, stat } from 'fs/promises'
import * as Path from 'path'
import {
  findRepositoryFindings,
  IHookFile,
  IRepositoryFindings,
  parseConfigList,
  sha256Hex,
} from './repository-trust'

const ReadOnly = ['--no-pager', '-c', 'safe.bareRepository=explicit']

/** A hook larger than this is hashed by its first part and its size. */
const MaxHookBytes = 5 * 1024 * 1024

async function readHooks(directory: string): Promise<ReadonlyArray<IHookFile>> {
  const names = await readdir(directory).catch(() => [])
  const hooks = new Array<IHookFile>()

  for (const name of names.sort()) {
    const path = Path.join(directory, name)
    const info = await stat(path).catch(() => null)

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

  const hooks = [
    ...(await readHooks(Path.join(gitDirectories[1], 'hooks'))),
    ...(hooksPath === null
      ? []
      : (await readHooks(hooksPath)).map(h => ({
          name: `core.hooksPath/${h.name}`,
          sha256: h.sha256,
        }))),
  ]

  const findings = findRepositoryFindings(
    entries.map(e =>
      e.origin.startsWith('file:')
        ? { ...e, origin: `file:${resolveOrigin(e.origin.slice(5))}` }
        : e
    ),
    hooks,
    isInWorkTree
  )

  return {
    ...findings,
    hooksPathInWorkTree: hooksPath !== null && isInWorkTree(hooksPath),
  }
}
