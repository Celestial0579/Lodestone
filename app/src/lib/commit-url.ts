import * as crypto from 'crypto'
import { GitHubRepository } from '../models/github-repository'

/** Method to create the url for viewing a commit on dotcom */
export function createCommitURL(
  gitHubRepository: GitHubRepository,
  SHA: string,
  filePath?: string
): string | null {
  const baseURL = gitHubRepository.htmlURL

  if (baseURL === null) {
    return null
  }

  if (filePath === undefined) {
    return `${baseURL}/commit/${SHA}`
  }

  const fileHash = crypto.createHash('sha256').update(filePath).digest('hex')
  const fileSuffix = '#diff-' + fileHash

  return `${baseURL}/commit/${SHA}${fileSuffix}`
}

/**
 * The url for viewing a pull request.
 *
 * Gitea serves pull requests from `/pulls/{index}`; the `/pull/{number}` path
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
 * Gitea serves these from `/src/branch/{name}`, where GitHub uses
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
