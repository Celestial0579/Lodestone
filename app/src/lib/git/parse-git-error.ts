import { GitError as DugiteError, parseError } from 'dugite'

/**
 * What git says in a folder that is not a repository when its search upwards
 * ends at the boundary of a filesystem:
 *
 *     fatal: not a git repository (or any parent up to mount point /)
 *     Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).
 *
 * dugite knows the other wording, "(or any of the parent directories): .git",
 * and returns nothing for this one. It is the same finding: a folder on a
 * volume of its own, such as a temp folder on a tmpfs, is no less "not a
 * repository" than one on the system disk.
 */
const notARepositoryUpToMountPoint =
  /fatal: [Nn]ot a git repository \(or any parent up to mount point .*\)/

/** Classify what git wrote, including what dugite's own table does not have. */
export function parseGitError(output: string): DugiteError | null {
  const error = parseError(output)

  if (error !== null) {
    return error
  }

  return notARepositoryUpToMountPoint.test(output)
    ? DugiteError.NotAGitRepository
    : null
}
