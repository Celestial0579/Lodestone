import { spawn, IGitSpawnOptions } from 'dugite'
import * as GitPerf from '../../ui/lib/git-perf'
import { withTrampolineEnv } from '../trampoline/trampoline-environment'
import {
  getGitArgumentsFor,
  getGitEnvironmentFor,
  getNetworkBlock,
  getRepositoryRefusal,
  RepositoryRefusedError,
  getSubmoduleBlock,
  RepositoryNetworkBlockedError,
  RepositorySubmoduleBlockedError,
} from './repository-trust-state'

type SpawnOptions = IGitSpawnOptions & {
  /**
   * Whether the command about to run is part of a background task or not.
   * This affects error handling and UI such as credential prompts.
   */
  readonly isBackgroundTask?: boolean
}

/**
 * Spawn a Git process, deferring all processing work to the caller.
 *
 * @param args Array of strings to pass to the Git executable.
 * @param path The path to execute the command from.
 * @param name The name of the operation - for tracing purposes.
 * @param successExitCodes An optional array of exit codes that indicate success.
 */
export const spawnGit = (
  args: string[],
  path: string,
  name: string,
  options?: SpawnOptions
) => {
  const refusal = getRepositoryRefusal(path)
  if (refusal.length > 0) {
    return Promise.reject(new RepositoryRefusedError(refusal))
  }
  const blockedBy = getNetworkBlock(path, args)
  if (blockedBy !== null) {
    return Promise.reject(new RepositoryNetworkBlockedError(blockedBy))
  }
  const submoduleBlock = getSubmoduleBlock(path, args)
  if (submoduleBlock !== null) {
    return Promise.reject(new RepositorySubmoduleBlockedError(submoduleBlock))
  }
  args = [...getGitArgumentsFor(path, args)]

  return withTrampolineEnv(
    trampolineEnv =>
      GitPerf.measure(`${name}: git ${args.join(' ')}`, async () =>
        spawn(args, path, {
          ...options,
          env: {
            ...options?.env,
            ...trampolineEnv,
            ...getGitEnvironmentFor(path, args),
          },
        })
      ),
    path,
    options?.isBackgroundTask ?? false,
    options?.env
  )
}
