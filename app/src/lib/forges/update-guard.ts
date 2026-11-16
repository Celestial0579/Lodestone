/**
 * What the main process checks of a self-update request before it downloads
 * anything, and the small pieces of state and flow control around the
 * download (#62). Kept free of Electron and of the network, so that each rule
 * is covered by a unit test.
 */

import { gt, valid } from 'semver'
import { IReleaseAsset } from './update-assets'

/** What the renderer asks for: the release the update check found. */
export interface IForgeUpdateRequest {
  /** The version of the release, without a leading v. */
  readonly version: string
  /** The web address of the repository the release is from. */
  readonly sourceURL: string
  readonly assets: ReadonlyArray<IReleaseAsset>
}

/**
 * Whether `version` is a newer version than the one that is running. The main
 * process decides this itself rather than leaving it to Squirrel.Windows, so an
 * update to the running or an older version is never downloaded.
 */
export function isNewerThanRunning(version: string, running: string) {
  const parsed = valid(version)
  const current = valid(running)
  return parsed !== null && current !== null && gt(parsed, current)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Read what came over IPC. The renderer is not trusted to send the shape the
 * types promise, so anything else is refused with a reason.
 */
export function parseUpdateRequest(
  value: unknown
): IForgeUpdateRequest | string {
  if (!isRecord(value)) {
    return 'The update request is not an object.'
  }

  const { version, sourceURL, assets } = value

  if (typeof version !== 'string' || typeof sourceURL !== 'string') {
    return 'The update request has no version or no source.'
  }

  if (!Array.isArray(assets) || assets.length > 200) {
    return 'The update request has no usable list of files.'
  }

  const parsed = new Array<IReleaseAsset>()

  for (const a of assets) {
    if (
      !isRecord(a) ||
      typeof a.name !== 'string' ||
      typeof a.url !== 'string' ||
      typeof a.size !== 'number'
    ) {
      return 'The update request lists a file that is not described by a name, an address and a size.'
    }

    parsed.push({ name: a.name, url: a.url, size: a.size })
  }

  return { version, sourceURL, assets: parsed }
}

/**
 * The address of the release of the given version in the API of github.com, for
 * a repository there, or null for any other host. The main process reads the
 * list of files from there itself instead of taking the renderer's word for it.
 * Other forges answer in other shapes at addresses the renderer finds out, so
 * for them the list the renderer sent stays, checked as before.
 */
export function getGitHubReleaseURL(sourceURL: string, version: string) {
  let source: URL

  try {
    source = new URL(sourceURL)
  } catch {
    return null
  }

  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
    source.pathname
  )

  if (
    source.protocol !== 'https:' ||
    source.host.toLowerCase() !== 'github.com' ||
    match === null ||
    valid(version) !== version
  ) {
    return null
  }

  return `https://api.github.com/repos/${match[1]}/${match[2]}/releases/tags/v${version}`
}

/**
 * The files of a published release from the API of github.com, if it is the
 * release of exactly this version, and neither a draft nor a pre-release.
 */
export function readGitHubRelease(
  body: unknown,
  version: string
): ReadonlyArray<IReleaseAsset> | string {
  if (!isRecord(body) || !Array.isArray(body.assets)) {
    return 'The release the update source gave is not one.'
  }

  if (body.draft === true || body.prerelease === true) {
    return 'The release is a draft or a pre-release.'
  }

  if (body.tag_name !== `v${version}`) {
    return 'The release of the update source is not the one asked for.'
  }

  const assets = new Array<IReleaseAsset>()

  for (const a of body.assets) {
    if (
      isRecord(a) &&
      typeof a.name === 'string' &&
      typeof a.browser_download_url === 'string' &&
      typeof a.size === 'number'
    ) {
      assets.push({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
      })
    }
  }

  return assets
}

/**
 * Who may prepare an update right now. One at a time, and none while Squirrel
 * is still reading the feed an earlier one made: starting another would empty
 * the folder it reads from. The feed is held from the moment it is handed to
 * Squirrel until Squirrel reports it is done with it.
 */
export class UpdateGate<T> {
  private inFlight: Promise<T> | null = null
  private feed: string | null = null

  /**
   * Run `start`, unless another is running (then its result is shared) or a
   * feed is held (then `busy` answers instead).
   */
  public request(start: () => Promise<T>, busy: () => T): Promise<T> {
    if (this.inFlight !== null) {
      return this.inFlight
    }

    if (this.feed !== null) {
      return Promise.resolve(busy())
    }

    const running = start().finally(() => {
      if (this.inFlight === running) {
        this.inFlight = null
      }
    })
    this.inFlight = running
    return running
  }

  /** Remember the feed Squirrel was handed. */
  public holdFeed(directory: string) {
    this.feed = directory
  }

  /** Let go of the feed, and say which one it was. */
  public releaseFeed(): string | null {
    const directory = this.feed
    this.feed = null
    return directory
  }
}

/** What of a response the download needs to slow it down. */
export interface IPausable {
  pause(): void
  resume(): void
}

/** What of a file stream the download needs to know when it is ready again. */
export interface IDrainable {
  write(chunk: Buffer): boolean
  once(event: 'drain', listener: () => void): unknown
}

/**
 * Write a chunk to the file and, if the file is not keeping up, stop the
 * response until it is, so that a slow disk does not make the package pile up
 * in memory.
 */
export function writeWithBackpressure(
  response: IPausable,
  file: IDrainable,
  chunk: Buffer
) {
  if (!file.write(chunk)) {
    response.pause()
    file.once('drain', () => response.resume())
  }
}
