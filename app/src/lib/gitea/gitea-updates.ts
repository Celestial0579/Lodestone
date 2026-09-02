/**
 * Checking a Gitea instance for new releases of Lodestone.
 *
 * The upstream app updates itself from GitHub's Squirrel infrastructure, which
 * only serves GitHub Desktop. Lodestone ships with no update source at all,
 * so nothing is configured until someone points it at a repository they publish
 * releases to. Once they do, we ask that repository's release API whether there
 * is a newer version and, if there is, hand the user a link to it.
 *
 * We deliberately don't download or install anything. Gitea releases are plain
 * file attachments rather than a Squirrel feed, so there is nothing to hand the
 * auto updater. Telling the user that a new version exists and taking them to
 * it is the honest version of this feature.
 */

import { SemVer, parse as parseSemVer, gt } from 'semver'
import { Account } from '../../models/account'
import { getGiteaAPIURL } from './gitea-endpoint'
import { ProjectRepositoryURL } from '../project-links'
import { request, parsedResponse } from '../http'

/** localStorage key holding the repository releases are published to. */
const UpdateSourceKey = 'gitea-update-source-url'

/** A repository on a Gitea instance that publishes Lodestone releases. */
export interface IGiteaUpdateSource {
  /** The API endpoint of the instance, e.g. https://git.example.com/api/v1 */
  readonly endpoint: string
  /** The repository owner, user or organisation. */
  readonly owner: string
  /** The repository name. */
  readonly name: string
  /** The web URL of the repository. */
  readonly htmlURL: string
}

/** A release as published on a Gitea instance. */
export interface IGiteaRelease {
  readonly version: SemVer
  /** The human readable release name, falling back to the tag. */
  readonly name: string
  /** Where the user can download this release. */
  readonly htmlURL: string
}

/** The raw shape of a Gitea release, as far as we care about it. */
interface IAPIGiteaRelease {
  readonly tag_name: string
  readonly name: string | null
  readonly html_url: string
  readonly draft: boolean
  readonly prerelease: boolean
}

/**
 * The repository to check for updates.
 *
 * Defaults to the repository this build is published from. A user who clears
 * the field turns update checks off, and that choice sticks: the stored empty
 * string is kept rather than removed, so it is not mistaken for "never
 * configured" on the next launch.
 */
export function getGiteaUpdateSourceURL(): string {
  return localStorage.getItem(UpdateSourceKey) ?? ProjectRepositoryURL
}

/** Store the repository to check for updates. Pass an empty string to unset. */
export function setGiteaUpdateSourceURL(url: string): void {
  localStorage.setItem(UpdateSourceKey, url.trim())
}

/**
 * Turn a repository URL into the pieces needed to query its releases.
 *
 * https://git.example.com/team/gitea-desktop
 *   -> endpoint https://git.example.com/api/v1, owner team, name gitea-desktop
 *
 * Returns null if the URL isn't a usable repository address, which is what the
 * settings UI uses to tell the user their input won't work.
 */
export function parseGiteaUpdateSource(url: string): IGiteaUpdateSource | null {
  const trimmed = url.trim()

  if (trimmed === '') {
    return null
  }

  let parsed: URL

  try {
    parsed = new URL(
      /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    )
  } catch {
    return null
  }

  // Everything up to the last two path segments belongs to the instance, which
  // lets this work for Gitea installations hosted under a sub path.
  const segments = parsed.pathname.split('/').filter(x => x.length > 0)

  if (segments.length < 2) {
    return null
  }

  const name = segments[segments.length - 1].replace(/\.git$/, '')
  const owner = segments[segments.length - 2]
  const basePath = segments.slice(0, segments.length - 2).join('/')
  const base = `${parsed.origin}${basePath === '' ? '' : `/${basePath}`}`

  if (owner === '' || name === '') {
    return null
  }

  return {
    endpoint: getGiteaAPIURL(base),
    owner,
    name,
    htmlURL: `${base}/${owner}/${name}`,
  }
}

/**
 * The token to use when asking about releases.
 *
 * Update repositories on an internal instance are frequently private, and the
 * user is normally already signed in to that same instance, so reuse that
 * account's token when the hosts line up.
 */
function findTokenForSource(
  source: IGiteaUpdateSource,
  accounts: ReadonlyArray<Account>
): string | null {
  return accounts.find(a => a.endpoint === source.endpoint)?.token ?? null
}

/** Strip a leading `v` so that both `1.2.3` and `v1.2.3` tags work. */
const parseReleaseVersion = (tag: string) => parseSemVer(tag.replace(/^v/, ''))

/**
 * Ask the configured repository for its most recent release.
 *
 * Returns null when no update source is configured, when the instance can't be
 * reached, or when the latest release doesn't carry a version number we can
 * compare against.
 */
export async function fetchLatestGiteaRelease(
  source: IGiteaUpdateSource,
  accounts: ReadonlyArray<Account>
): Promise<IGiteaRelease | null> {
  const token = findTokenForSource(source, accounts)
  const path = `repos/${source.owner}/${source.name}/releases/latest`

  try {
    const response = await request(source.endpoint, token, 'GET', path)

    if (!response.ok) {
      log.warn(
        `[gitea-updates] ${source.htmlURL} returned ${response.status} when asked for its latest release`
      )
      return null
    }

    const release = await parsedResponse<IAPIGiteaRelease>(response)

    if (release.draft || release.prerelease) {
      return null
    }

    const version = parseReleaseVersion(release.tag_name ?? '')

    if (version === null) {
      log.warn(
        `[gitea-updates] release tag '${release.tag_name}' is not a version number`
      )
      return null
    }

    return {
      version,
      name: release.name || release.tag_name,
      htmlURL: release.html_url,
    }
  } catch (e) {
    log.warn(`[gitea-updates] failed checking ${source.htmlURL}`, e)
    return null
  }
}

/** Whether the given release is newer than the version we're running. */
export function isNewerRelease(
  release: IGiteaRelease,
  currentVersion: string
): boolean {
  const current = parseSemVer(currentVersion)

  // If we can't tell what we're running we have no business claiming an update
  // is available.
  return current === null ? false : gt(release.version, current)
}
