import * as URL from 'url'
import * as Path from 'path'

import { Account } from '../models/account'
import { IRemote } from '../models/remote'
import { getHTMLURL } from './api'
import {
  IGitRemoteURL,
  parseRemote,
  parseRepositoryIdentifier,
} from './remote-parsing'
import { caseInsensitiveEquals } from './compare'
import { GitHubRepository } from '../models/github-repository'

export interface IMatchedGitHubRepository {
  /**
   * The name of the repository, e.g., for https://github.com/user/repo, the
   * name is `repo`.
   */
  readonly name: string

  /**
   * The login of the owner of the repository, e.g., for
   * https://github.com/user/repo, the owner is `user`.
   */
  readonly owner: string

  /** The account matching the repository remote */
  readonly account: Account
}

/** Try to use the list of users and a remote URL to guess a GitHub repository. */
export function matchGitHubRepository(
  accounts: ReadonlyArray<Account>,
  remote: string
): IMatchedGitHubRepository | null {
  const parsedRemote = parseRemote(remote)

  if (parsedRemote === null) {
    return null
  }

  for (const account of accounts) {
    if (remoteIsOnHostOf(remote, parsedRemote, getHTMLURL(account.endpoint))) {
      return { name: parsedRemote.name, owner: parsedRemote.owner, account }
    }
  }

  return null
}

/** Split what a remote gives as its host into the name and the port. */
function splitHost(host: string): { name: string; port: string | null } {
  const match = /^(.*?)(?::(\d+))?$/.exec(host)
  const name = match === null ? host : match[1]

  return {
    // `[::1]` in a URL is `::1` once parsed, so compare without the brackets.
    name: name.replace(/^\[(.*)\]$/, '$1').toLowerCase(),
    port: match?.[2] ?? null,
  }
}

/**
 * Whether a remote lives on the host a web address names.
 *
 * Over HTTP the port is part of the answer. Gitea and Forgejo listen on 3000
 * unless told otherwise, and two instances can share a machine. `parseRemote`
 * keeps the port in what it calls the hostname, and comparing that with the
 * bare name of the account's host matched no account for any instance that has
 * a port in its address.
 *
 * Over SSH the port is that of the SSH server, which says nothing about where
 * the web interface is, so only the names are compared.
 */
function remoteIsOnHostOf(
  remoteURL: string,
  remote: IGitRemoteURL,
  htmlURL: string
): boolean {
  const account = URL.parse(htmlURL)

  if (account.hostname === null) {
    return false
  }

  const host = splitHost(remote.hostname)

  if (host.name !== account.hostname.toLowerCase()) {
    return false
  }

  if (remote.protocol === 'ssh') {
    return true
  }

  // With no port written on either side, do not hold `http` against `https`:
  // an old remote often still says `http` for a host that moved on.
  if (host.port === null && account.port === null) {
    return true
  }

  const defaultPort = (protocol: string) =>
    protocol === 'http:' ? '80' : '443'
  const remoteProtocol = /^http:/i.test(remoteURL) ? 'http:' : 'https:'

  return (
    (host.port ?? defaultPort(remoteProtocol)) ===
    (account.port ?? defaultPort(account.protocol ?? 'https:'))
  )
}

/**
 * Find an existing repository associated with this path
 *
 * @param repos The list of repositories tracked in the app
 * @param path The path on disk which might be a repository
 */
export function matchExistingRepository<T extends { readonly path: string }>(
  repos: ReadonlyArray<T>,
  path: string
): T | undefined {
  // Windows is guaranteed to be case-insensitive so we can be a bit less strict
  const normalize = __WIN32__
    ? (p: string) => Path.normalize(p).toLowerCase()
    : (p: string) => Path.normalize(p)

  const needle = normalize(path)
  return repos.find(r => normalize(r.path) === needle)
}

/**
 * Check whether or not a GitHub repository matches a given remote.
 *
 * @param gitHubRepository the repository containing information from the GitHub API
 * @param remote the remote details found in the Git repository
 */
export function repositoryMatchesRemote(
  gitHubRepository: GitHubRepository,
  remote: IRemote
): boolean {
  return (
    urlMatchesRemote(gitHubRepository.htmlURL, remote) ||
    urlMatchesRemote(gitHubRepository.cloneURL, remote)
  )
}

/**
 * Check whether or not a GitHub repository URL matches a given remote, by
 * parsing and comparing the structure of the each URL.
 *
 * @param url a URL associated with the GitHub repository
 * @param remote the remote details found in the Git repository
 */
export function urlMatchesRemote(url: string | null, remote: IRemote): boolean {
  if (url == null) {
    return false
  }

  const cloneUrl = parseRemote(url)
  const remoteUrl = parseRemote(remote.url)

  if (remoteUrl == null || cloneUrl == null) {
    return false
  }

  if (!caseInsensitiveEquals(remoteUrl.hostname, cloneUrl.hostname)) {
    return false
  }

  if (remoteUrl.owner == null || cloneUrl.owner == null) {
    return false
  }

  if (remoteUrl.name == null || cloneUrl.name == null) {
    return false
  }

  return (
    caseInsensitiveEquals(remoteUrl.owner, cloneUrl.owner) &&
    caseInsensitiveEquals(remoteUrl.name, cloneUrl.name)
  )
}

/**
 * Match a URL-like string to the Clone URL of a GitHub Repository
 *
 * @param url A remote-like URL to verify against the existing information
 * @param gitHubRepository GitHub API details for a repository
 */
export function urlMatchesCloneURL(
  url: string,
  gitHubRepository: GitHubRepository
): boolean {
  if (gitHubRepository.cloneURL === null) {
    return false
  }

  return urlsMatch(gitHubRepository.cloneURL, url)
}

export function urlsMatch(url1: string, url2: string) {
  const firstIdentifier = parseRepositoryIdentifier(url1)
  const secondIdentifier = parseRepositoryIdentifier(url2)

  return (
    firstIdentifier !== null &&
    secondIdentifier !== null &&
    firstIdentifier.hostname === secondIdentifier.hostname &&
    firstIdentifier.owner === secondIdentifier.owner &&
    firstIdentifier.name === secondIdentifier.name
  )
}
