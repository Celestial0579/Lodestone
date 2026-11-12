/**
 * Checking a repository for new releases of Lodestone.
 *
 * The upstream app updates itself from GitHub's Squirrel infrastructure, which
 * only serves GitHub Desktop. Lodestone instead asks a repository's release API
 * whether there is a newer version and, if there is, hands the user a link to
 * it. Any forge will do: the releases endpoint has the same shape on Gitea,
 * Forgejo and GitHub, and anything that needs translating is translated a layer
 * below this one.
 *
 * We deliberately don't download or install anything. A release is a set of
 * file attachments rather than a Squirrel feed, so there is nothing to hand the
 * auto updater. Telling the user that a new version exists and taking them to
 * it is the honest version of this feature.
 */

import { SemVer, parse as parseSemVer, gt } from 'semver'
import { Account } from '../../models/account'
import { GiteaAPIPath } from './forge-type'
import {
  getKnownApiEndpointForOrigin,
  recordApiEndpointForOrigin,
} from './forge-registry'
import {
  ProjectRepositoryURL,
  RetiredProjectRepositoryURLs,
} from '../project-links'
import { request, parsedResponse, IAPIError } from '../http'

/** localStorage key holding the repository releases are published to. */
const UpdateSourceKey = 'gitea-update-source-url'

/** A repository that publishes Lodestone releases. */
export interface IUpdateSource {
  /** The API endpoint of the instance, e.g. https://git.example.com/api/v1 */
  readonly endpoint: string
  /** The repository owner, user or organisation. */
  readonly owner: string
  /** The repository name. */
  readonly name: string
  /** The web URL of the repository. */
  readonly htmlURL: string
}

/** A release, as published on a forge. */
export interface IForgeRelease {
  readonly version: SemVer
  /** The human readable release name, falling back to the tag. */
  readonly name: string
  /** Where the user can download this release. */
  readonly htmlURL: string
}

/** The raw shape of a release, as far as we care about it. */
interface IAPIForgeRelease {
  readonly tag_name: string
  readonly name: string | null
  readonly html_url: string
  readonly draft: boolean
  readonly prerelease: boolean
}

/**
 * What asking a repository for its latest release came to.
 *
 * Three outcomes, because the user has to be told three different things: here
 * is the newest release, there is none to offer, or we could not find out. The
 * last two used to look the same - both came back as null and were shown as
 * "you have the latest version" - which is how an update check that had never
 * once worked went unnoticed.
 */
export type LatestReleaseResult =
  | {
      /** The repository has a published release. */
      readonly kind: 'release'
      readonly release: IForgeRelease
    }
  | {
      /**
       * The repository answered and has nothing to offer: no release at all, or
       * only drafts and prereleases, which are never offered as updates.
       */
      readonly kind: 'no-published-release'
    }
  | {
      /**
       * We could not find out. `reason` is a complete sentence that can be
       * shown to the user as it is.
       */
      readonly kind: 'failed'
      readonly reason: string
    }

/**
 * The repository to check for updates.
 *
 * Defaults to the repository this build is published from. A user who clears
 * the field turns update checks off, and that choice sticks: the stored empty
 * string is kept rather than removed, so it is not mistaken for "never
 * configured" on the next launch.
 *
 * A stored address that names one of the project's former homes is read as
 * the current one. The preferences fill the field with the default, so any
 * edit to it - even one that ends where it started - stores that default as if
 * someone had chosen it. Kept as it is, it would pin the installation to an
 * address that no longer answers, and the user would never hear of an update
 * again.
 */
export function getUpdateSourceURL(): string {
  const stored = localStorage.getItem(UpdateSourceKey)

  if (stored === null || isRetiredProjectRepositoryURL(stored)) {
    return ProjectRepositoryURL
  }

  return stored
}

/**
 * Whether the given address is one this project was published from before.
 *
 * Compared loosely - scheme, case, a trailing slash and a `.git` suffix are
 * ignored - because the value may have been typed or pasted by hand.
 */
export function isRetiredProjectRepositoryURL(url: string): boolean {
  const normalize = (u: string) =>
    u
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')

  const candidate = normalize(url)

  return (
    candidate !== '' &&
    RetiredProjectRepositoryURLs.some(r => normalize(r) === candidate)
  )
}

/** Store the repository to check for updates. Pass an empty string to unset. */
export function setUpdateSourceURL(url: string): void {
  localStorage.setItem(UpdateSourceKey, url.trim())
}

/**
 * Turn a repository URL into the pieces needed to query its releases.
 *
 * https://git.example.com/team/lodestone
 *   -> endpoint https://git.example.com/api/v1, owner team, name lodestone
 *
 * Returns null if the URL isn't a usable repository address, which is what the
 * settings UI uses to tell the user their input won't work.
 */
export function parseUpdateSource(url: string): IUpdateSource | null {
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
  // lets this work for installations hosted under a sub path.
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
    endpoint: getUpdateAPIEndpoint(base),
    owner,
    name,
    htmlURL: `${base}/${owner}/${name}`,
  }
}

/**
 * Where the API lives for an instance we only know the web address of.
 *
 * This has to answer without a network round trip, because the settings UI
 * validates as the user types. Three sources, in order of confidence: the
 * pairing recorded when the user signed in to this instance, github.com being
 * the one host whose API sits on a different name, and otherwise the path that
 * Gitea and Forgejo both use. Getting it wrong costs the first check two more
 * requests: `fetchLatestRelease` tries the other dialect and records the one
 * that answered, which is then found here as the first source.
 */
function getUpdateAPIEndpoint(base: string): string {
  const known = getKnownApiEndpointForOrigin(base)

  if (known !== undefined) {
    return known
  }

  const { hostname } = new URL(base)

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    return 'https://api.github.com'
  }

  return `${base}${GiteaAPIPath}`
}

/**
 * The same instance addressed as the other dialect.
 *
 * Used only after the repository was not found at the first guess, to cover a
 * host whose product we could not know without signing in to it.
 */
function getAlternateAPIEndpoint(endpoint: string): string | null {
  if (endpoint.endsWith(GiteaAPIPath)) {
    return `${endpoint.slice(0, -GiteaAPIPath.length)}/api/v3`
  }

  if (endpoint.endsWith('/api/v3')) {
    return `${endpoint.slice(0, -'/api/v3'.length)}${GiteaAPIPath}`
  }

  return null
}

/**
 * The web address of the instance a source lives on, sub path included.
 *
 * This is the key `getUpdateAPIEndpoint` looks a learned endpoint up under, so
 * it is also the key one has to be recorded under.
 */
const getInstanceBase = (source: IUpdateSource) =>
  source.htmlURL.slice(0, -`/${source.owner}/${source.name}`.length)

/**
 * The token to use when asking this endpoint about releases.
 *
 * Update repositories on an internal instance are frequently private, and the
 * user is normally already signed in to that same instance, so reuse that
 * account's token when the endpoints line up.
 *
 * Chosen per endpoint rather than once per check: when the first guess at the
 * dialect was wrong, the account belongs to the endpoint tried second, and a
 * token picked for the first would leave both requests anonymous.
 */
function findTokenForEndpoint(
  endpoint: string,
  accounts: ReadonlyArray<Account>
): string | null {
  return accounts.find(a => a.endpoint === endpoint)?.token ?? null
}

/** Strip a leading `v` so that both `1.2.3` and `v1.2.3` tags work. */
const parseReleaseVersion = (tag: string) => parseSemVer(tag.replace(/^v/, ''))

const failed = (reason: string): LatestReleaseResult => ({
  kind: 'failed',
  reason,
})

/**
 * Say what a response that is not OK amounted to, in the forge's own words
 * where it has any - "API rate limit exceeded" explains itself far better than
 * the bare 403 it arrives with.
 */
async function describeRefusal(
  host: string,
  response: Response
): Promise<string> {
  let message = ''

  try {
    const body = (await response.clone().json()) as IAPIError | null

    if (typeof body?.message === 'string') {
      message = body.message.trim().slice(0, 200)
    }
  } catch {
    // No body, or not JSON. The status code has to do.
  }

  if (message === '') {
    return `${host} answered with an error (${response.status}).`
  }

  // The reason is shown as one sentence among others, so close it as one -
  // unless it already is, which includes GitHub's habit of ending on a
  // sentence in brackets.
  const sentence = /[.!?]["')\]]*$/.test(message) ? message : `${message}.`

  return `${host} answered with an error (${response.status}): ${sentence}`
}

/**
 * Ask for the latest release, at the endpoint the dialect was guessed to be and
 * - only if the repository is not there - at the other one.
 *
 * Returns the response to read the release from, or the result if the answer
 * was already clear without one. Throws when the host cannot be reached.
 */
async function requestLatestRelease(
  source: IUpdateSource,
  accounts: ReadonlyArray<Account>
): Promise<Response | LatestReleaseResult> {
  const host = new URL(source.htmlURL).host
  const repositoryPath = `repos/${source.owner}/${source.name}`
  const releasePath = `${repositoryPath}/releases/latest`

  const get = (endpoint: string, path: string) =>
    request(endpoint, findTokenForEndpoint(endpoint, accounts), 'GET', path)

  const notFound = failed(
    `${source.htmlURL} was not found. The address may be wrong, or the repository is private and none of the signed-in accounts can see it.`
  )

  const response = await get(source.endpoint, releasePath)

  if (response.status !== 404) {
    return response.ok
      ? response
      : failed(await describeRefusal(host, response))
  }

  // A 404 is what three different things look like: a repository with nothing
  // published, since drafts and prereleases are left out of `latest`; an
  // address that names no repository we are allowed to see; and an endpoint
  // guessed in the wrong dialect. Asking for the repository itself tells the
  // first apart from the other two.
  const repository = await get(source.endpoint, repositoryPath)

  if (repository.ok) {
    return { kind: 'no-published-release' }
  }

  if (repository.status !== 404) {
    return failed(await describeRefusal(host, repository))
  }

  // The endpoint was guessed without a network round trip, so it can be the
  // wrong dialect for a host nobody has signed in to - a GitHub Enterprise
  // server guessed as Gitea, or the reverse. Try the other one before
  // concluding that the repository does not exist.
  const alternate = getAlternateAPIEndpoint(source.endpoint)

  if (alternate === null) {
    return notFound
  }

  const retry = await get(alternate, releasePath)

  if (retry.ok) {
    recordApiEndpointForOrigin(getInstanceBase(source), alternate)
    return retry
  }

  if (retry.status !== 404) {
    return failed(await describeRefusal(host, retry))
  }

  if (!(await get(alternate, repositoryPath)).ok) {
    return notFound
  }

  recordApiEndpointForOrigin(getInstanceBase(source), alternate)
  return { kind: 'no-published-release' }
}

/**
 * Ask the configured repository for its most recent release.
 *
 * Never throws and never answers with silence: an instance that cannot be
 * reached, an error from the forge and a release whose tag is no version number
 * all come back as `failed`, with a reason. Only a repository that was reached
 * and has nothing published counts as `no-published-release`.
 */
export async function fetchLatestRelease(
  source: IUpdateSource,
  accounts: ReadonlyArray<Account>
): Promise<LatestReleaseResult> {
  const host = new URL(source.htmlURL).host
  let answer: Response | LatestReleaseResult

  try {
    answer = await requestLatestRelease(source, accounts)
  } catch (e) {
    log.warn(`[updates] failed checking ${source.htmlURL}`, e)
    return failed(`${host} could not be reached.`)
  }

  if ('kind' in answer) {
    if (answer.kind === 'failed') {
      log.warn(`[updates] checking ${source.htmlURL} failed: ${answer.reason}`)
    }

    return answer
  }

  const unreadable = failed(`${host} sent a reply that could not be read.`)
  let release: IAPIForgeRelease | null

  try {
    release = await parsedResponse<IAPIForgeRelease | null>(answer)
  } catch (e) {
    log.warn(`[updates] unreadable reply from ${source.htmlURL}`, e)
    return unreadable
  }

  // Valid JSON is not yet a release. A captive portal or a proxy can answer
  // 200 with anything at all, and none of it is a reason to throw.
  if (typeof release?.tag_name !== 'string') {
    log.warn(`[updates] reply from ${source.htmlURL} is not a release`)
    return unreadable
  }

  // `latest` leaves these out on every forge we know, so this is a guard
  // against one that does not rather than a path anything takes today.
  if (release.draft || release.prerelease) {
    return { kind: 'no-published-release' }
  }

  const version = parseReleaseVersion(release.tag_name)

  if (version === null) {
    log.warn(
      `[updates] release tag '${release.tag_name}' is not a version number`
    )
    return failed(
      `The latest release at ${source.htmlURL} is tagged "${release.tag_name}", which is not a version number.`
    )
  }

  return {
    kind: 'release',
    release: {
      version,
      name: release.name || release.tag_name,
      htmlURL: release.html_url,
    },
  }
}

/** Whether the given release is newer than the version we're running. */
export function isNewerRelease(
  release: IForgeRelease,
  currentVersion: string
): boolean {
  const current = parseSemVer(currentVersion)

  // If we can't tell what we're running we have no business claiming an update
  // is available.
  return current === null ? false : gt(release.version, current)
}
