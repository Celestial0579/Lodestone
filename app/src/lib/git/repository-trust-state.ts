/**
 * What the app knows about each repository's trust, as far as running Git is
 * concerned (#98). The store that asks the user and keeps the answers sets it;
 * the one place that runs Git reads it. Nothing here asks or stores anything.
 */

import * as Path from 'path'
import {
  getOverrideArguments,
  getTransportBlockKeys,
  IRepositoryFindings,
} from './repository-trust'

/** What may run in a repository. */
export type RepositoryTrust =
  /** Not looked at yet. Treated as untrusted until it has been. */
  | 'pending'
  /** The user said no, or has not answered. Nothing the repository names runs. */
  | 'untrusted'
  /** The user said yes, for this fingerprint. Git behaves as on the command line. */
  | 'trusted'

export interface IRepositoryGitPolicy {
  readonly trust: RepositoryTrust
  /** `-c` arguments that switch off what the repository names. */
  readonly overrideArguments: ReadonlyArray<string>
  /** Transport keys the repository sets. With any, there are no network operations. */
  readonly transportKeys: ReadonlyArray<string>
  /**
   * Environment variables that outrank keys a command line cannot override.
   * core.gitProxy is read once and the first value stands, a `-c` comes too
   * late; the environment variable is read before the file.
   */
  readonly environment: Readonly<Record<string, string>>
  /**
   * The repository names its own upload-pack or receive-pack. These keys keep
   * the first value as well, so the command is named as an option instead.
   */
  readonly overridesUploadPack: boolean
  readonly overridesReceivePack: boolean
}

const policies = new Map<string, IRepositoryGitPolicy>()

/** The key a path is filed under: absolute, and in lower case where the file system is. */
export function repositoryPolicyKey(path: string): string {
  const resolved = Path.resolve(path)
  return __WIN32__ || __DARWIN__ ? resolved.toLowerCase() : resolved
}

/** Where untrusted repositories' hooks point: a directory that stays empty. */
let emptyHooksDirectory = Path.join(
  process.env.TMPDIR ?? process.env.TEMP ?? '/tmp',
  'lodestone-empty-hooks'
)

export function getEmptyHooksDirectory(): string {
  return emptyHooksDirectory
}

export function setEmptyHooksDirectory(path: string) {
  emptyHooksDirectory = path
}

/** Record how Git is to be run in a repository. */
export function setRepositoryGitPolicy(
  path: string,
  policy: IRepositoryGitPolicy | null
) {
  const key = repositoryPolicyKey(path)

  if (policy === null) {
    policies.delete(key)
  } else {
    policies.set(key, policy)
  }
}

export function getRepositoryGitPolicy(
  path: string
): IRepositoryGitPolicy | null {
  return policies.get(repositoryPolicyKey(path)) ?? null
}

/** The policy of a repository that has not been looked at: nothing it names may run. */
export function pendingPolicy(): IRepositoryGitPolicy {
  return {
    trust: 'pending',
    overrideArguments: [
      '-c',
      'core.fsmonitor=false',
      '-c',
      `core.hooksPath=${getEmptyHooksDirectory()}`,
    ],
    // Until the repository has been looked at, nothing goes over the network.
    transportKeys: ['(not checked yet)'],
    environment: {},
    overridesUploadPack: false,
    overridesReceivePack: false,
  }
}

/** How Git is to be run in a repository, from what it was found to bring. */
export function buildRepositoryGitPolicy(
  trust: RepositoryTrust,
  findings: IRepositoryFindings
): IRepositoryGitPolicy {
  const has = (re: RegExp) =>
    findings.commandEntries.some(e => re.test(e.key.toLowerCase()))

  return {
    trust,
    overrideArguments: getOverrideArguments(findings, getEmptyHooksDirectory()),
    transportKeys: getTransportBlockKeys(findings),
    environment: has(/^core\.gitproxy$/) ? { GIT_PROXY_COMMAND: '' } : {},
    overridesUploadPack: has(/^remote\..+\.uploadpack$/),
    overridesReceivePack: has(/^remote\..+\.receivepack$/),
  }
}

/** What every Git run gets, trusted or not. */
export const AlwaysArguments: ReadonlyArray<string> = [
  '--no-pager',
  // A bare repository hidden in a work tree is never picked up implicitly.
  '-c',
  'safe.bareRepository=explicit',
]

/**
 * The arguments for a Git run in `path`: what every run gets, what an
 * untrusted repository adds before the command, and the options for the
 * commands whose keys a `-c` cannot override.
 */
export function getGitArgumentsFor(
  path: string,
  args: ReadonlyArray<string> = []
): ReadonlyArray<string> {
  const policy = getRepositoryGitPolicy(path)

  if (policy === null || policy.trust === 'trusted') {
    return [...AlwaysArguments, ...args]
  }

  const withOptions = [...args]
  const command = getGitCommand(args)
  const at = command === null ? -1 : args.indexOf(command)

  if (at !== -1 && policy.overridesUploadPack) {
    if (['fetch', 'pull', 'ls-remote'].includes(command!)) {
      withOptions.splice(at + 1, 0, '--upload-pack=git-upload-pack')
    }
  }
  if (at !== -1 && policy.overridesReceivePack && command === 'push') {
    withOptions.splice(at + 1, 0, '--receive-pack=git-receive-pack')
  }

  return [...AlwaysArguments, ...policy.overrideArguments, ...withOptions]
}

/** Environment variables for a Git run in `path`. */
export function getGitEnvironmentFor(
  path: string
): Readonly<Record<string, string>> {
  const policy = getRepositoryGitPolicy(path)
  return policy === null || policy.trust === 'trusted' ? {} : policy.environment
}

/** Commands that connect to another machine. */
const NetworkCommands: ReadonlySet<string> = new Set([
  'fetch',
  'pull',
  'push',
  'ls-remote',
  'clone',
  'send-pack',
  'fetch-pack',
])

/** The command of an argument list, after any `-c key=value` pairs and options. */
export function getGitCommand(args: ReadonlyArray<string>): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]

    if (a === '-c' || a === '-C') {
      i++
    } else if (!a.startsWith('-')) {
      return a
    }
  }

  return null
}

/**
 * If this command may not connect to another machine from this repository,
 * the keys that are the reason; otherwise null. Only an untrusted repository
 * with transport keys (or one not looked at yet) is blocked.
 */
export function getNetworkBlock(
  path: string,
  args: ReadonlyArray<string>
): ReadonlyArray<string> | null {
  const policy = getRepositoryGitPolicy(path)

  if (
    policy === null ||
    policy.trust === 'trusted' ||
    policy.transportKeys.length === 0
  ) {
    return null
  }

  const command = getGitCommand(args)
  const isNetwork =
    command !== null &&
    (NetworkCommands.has(command) ||
      (command === 'remote' && args.includes('update')))

  return isNetwork ? policy.transportKeys : null
}

export class RepositoryNetworkBlockedError extends Error {
  public constructor(public readonly keys: ReadonlyArray<string>) {
    super(
      `This repository is not trusted and its own configuration sets ${keys.join(
        ', '
      )}, which changes where Git connects or what it trusts. Lodestone does not connect to other machines from it. Trust the repository in its settings, or remove those entries, to fetch, pull or push.`
    )
    this.name = 'RepositoryNetworkBlockedError'
  }
}
