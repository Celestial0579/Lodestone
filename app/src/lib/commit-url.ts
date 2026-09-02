import { GitHubRepository } from '../models/github-repository'

/**
 * The url for viewing a commit.
 *
 * Upstream appends `#diff-<sha256 of the file path>` to jump to a particular
 * file. Gitea ids its diff boxes differently, so that anchor would land
 * nowhere; the commit page itself is the honest destination.
 */
export function createCommitURL(
  gitHubRepository: GitHubRepository,
  SHA: string,
  filePath?: string
): string | null {
  const baseURL = gitHubRepository.htmlURL

  if (baseURL === null) {
    return null
  }

  return `${baseURL}/commit/${SHA}`
}

/**
 * The url for viewing a pull request.
 *
 * The forge serves pull requests from `/pulls/{index}`; the `/pull/{number}` path
 * GitHub uses does not exist there.
 */
export function createPullRequestURL(
  gitHubRepository: GitHubRepository,
  pullRequestNumber: number
): string | null {
  const baseURL = gitHubRepository.htmlURL

  return baseURL === null ? null : `${baseURL}/pulls/${pullRequestNumber}`
}

/**
 * The url for browsing the files on a branch.
 *
 * The forge serves these from `/src/branch/{name}`, where GitHub uses
 * `/tree/{name}`.
 */
export function createBranchURL(
  gitHubRepository: GitHubRepository,
  branchName: string
): string | null {
  const baseURL = gitHubRepository.htmlURL

  return baseURL === null
    ? null
    : `${baseURL}/src/branch/${encodeURIComponent(branchName)}`
}

/**
 * The url for comparing a branch with the branch it would be merged into.
 *
 * GitHub fills in the base itself when given `/compare/{head}`; Gitea wants
 * both sides, so the caller has to say what to compare against.
 */
export function createCompareURL(
  gitHubRepository: GitHubRepository,
  baseBranchName: string,
  headBranchName: string
): string | null {
  const baseURL = gitHubRepository.htmlURL

  if (baseURL === null) {
    return null
  }

  const base = encodeURIComponent(baseBranchName)
  const head = encodeURIComponent(headBranchName)

  return `${baseURL}/compare/${base}...${head}`
}
