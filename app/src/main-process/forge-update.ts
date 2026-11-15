import * as Path from 'path'
import { createHash, randomBytes } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { autoUpdater, net } from 'electron'
import { valid } from 'semver'
import { pathExists } from '../lib/path-exists'
import {
  findUpdateAssets,
  formatReleasesEntry,
  IReleaseAsset,
  isAllowedUpdateURL,
  MaxPackageSize,
  MaxSumsFileSize,
  parseSha256Sums,
} from '../lib/forges/update-assets'
import { rootAppDir, updateDotExe } from './squirrel-updater'

/** What the renderer asks for: the release the update check found. */
export interface IForgeUpdateRequest {
  /** The version of the release, without a leading v. */
  readonly version: string
  /** The web address of the repository the release is from. */
  readonly sourceURL: string
  readonly assets: ReadonlyArray<IReleaseAsset>
}

export type ForgeUpdateResult =
  /** The package checked out, and Squirrel was handed a feed of it. */
  | { readonly kind: 'started' }
  /** This installation cannot update itself, such as a development build. */
  | { readonly kind: 'unsupported' }
  /** Nothing was handed to Squirrel. `reason` is fit to show the user. */
  | { readonly kind: 'failed'; readonly reason: string }

/** Where the downloads go: a folder only the user can write to. */
const updatesDirectory = Path.join(rootAppDir, 'updates')

let inFlight: Promise<ForgeUpdateResult> | null = null
let feedDirectory: string | null = null

class UpdateRefusedError extends Error {}

/**
 * Download a file of the update, following redirects only to addresses the
 * update may come from, and never more than `maxSize` bytes. Feeds every chunk
 * to the given hashes and, with a path, to the file.
 */
function download(
  url: string,
  sourceURL: string,
  maxSize: number,
  hashes: ReadonlyArray<ReturnType<typeof createHash>>,
  path?: string
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    if (!isAllowedUpdateURL(url, sourceURL)) {
      reject(
        new UpdateRefusedError(
          `${url} is not an address on the host of the update source.`
        )
      )
      return
    }

    const request = net.request({
      url,
      redirect: 'manual',
      // Downloads never carry the credentials of the user's accounts.
      credentials: 'omit',
      useSessionCookies: false,
    })

    const file =
      path === undefined ? null : createWriteStream(path, { flags: 'wx' })
    const chunks = new Array<Buffer>()
    let received = 0

    const fail = (e: Error) => {
      request.abort()
      file?.destroy()
      reject(e)
    }

    request.on('redirect', (_status, _method, redirectURL) => {
      if (isAllowedUpdateURL(redirectURL, sourceURL)) {
        request.followRedirect()
      } else {
        fail(
          new UpdateRefusedError(
            `The download was redirected to ${
              new URL(redirectURL).host
            }, which is not where the update may come from.`
          )
        )
      }
    })

    request.on('response', response => {
      if (response.statusCode !== 200) {
        fail(new Error(`${url} answered ${response.statusCode}.`))
        return
      }

      response.on('data', (chunk: Buffer) => {
        received += chunk.length

        if (received > maxSize) {
          fail(new UpdateRefusedError(`${url} is larger than expected.`))
          return
        }

        hashes.forEach(h => h.update(chunk))

        if (file === null) {
          chunks.push(chunk)
        } else {
          file.write(chunk)
        }
      })

      response.on('error', fail)
      response.on('end', () => {
        if (file === null) {
          resolve(Buffer.concat(chunks))
        } else {
          file.end(() => resolve(null))
        }
      })
    })

    request.on('error', fail)
    file?.on('error', fail)
    request.end()
  })
}

/** Remove what earlier attempts left in the updates folder. */
async function clearUpdatesDirectory() {
  const entries = await readdir(updatesDirectory).catch(() => [])
  for (const entry of entries) {
    await rm(Path.join(updatesDirectory, entry), {
      recursive: true,
      force: true,
    }).catch(e =>
      log.warn(
        `[updates] could not remove ${entry} from ${updatesDirectory}`,
        e
      )
    )
  }
}

async function prepare(
  request: IForgeUpdateRequest
): Promise<ForgeUpdateResult> {
  if (!__WIN32__ || __DEV__ || !(await pathExists(updateDotExe))) {
    return { kind: 'unsupported' }
  }

  // The version goes into a file and a folder name, so it has to be exactly a
  // version number and nothing that could name a path.
  if (valid(request.version) !== request.version) {
    return {
      kind: 'failed',
      reason: `"${request.version}" is not a version number.`,
    }
  }

  const assets = findUpdateAssets(request.assets, __APP_NAME__, request.version)
  if (typeof assets === 'string') {
    return { kind: 'failed', reason: assets }
  }

  await clearUpdatesDirectory()
  await mkdir(updatesDirectory, { recursive: true })
  // A fresh folder with a name nobody can guess beforehand, inside the
  // installation, which lives in the user's own %LOCALAPPDATA%.
  const directory = Path.join(
    updatesDirectory,
    `${request.version}-${randomBytes(8).toString('hex')}`
  )
  await mkdir(directory)

  try {
    const sumsText = await download(
      assets.sums.url,
      request.sourceURL,
      MaxSumsFileSize,
      []
    )
    const sums = parseSha256Sums(sumsText?.toString('utf8') ?? '')
    const expected = sums?.get(assets.package.name)

    if (expected === undefined) {
      throw new UpdateRefusedError(
        `${assets.sums.name} of the release lists no sum for ${assets.package.name}.`
      )
    }

    const sha256 = createHash('sha256')
    const sha1 = createHash('sha1')
    const packagePath = Path.join(directory, assets.package.name)
    await download(
      assets.package.url,
      request.sourceURL,
      MaxPackageSize,
      [sha256, sha1],
      packagePath
    )

    const actual = sha256.digest('hex')
    if (actual !== expected) {
      throw new UpdateRefusedError(
        `${assets.package.name} does not match its SHA-256 in ${assets.sums.name}. The download was discarded and nothing was installed.`
      )
    }

    // The RELEASES file is ours, not the release's: it names the one package
    // that was checked, by the SHA-1 Squirrel checks it against once more.
    const { size } = await stat(packagePath)
    await writeFile(
      Path.join(directory, 'RELEASES'),
      formatReleasesEntry(sha1.digest('hex'), assets.package.name, size),
      'ascii'
    )
  } catch (e) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})

    if (e instanceof UpdateRefusedError) {
      log.warn(
        `[updates] refused the update to ${request.version}: ${e.message}`
      )
      return { kind: 'failed', reason: e.message }
    }

    log.warn(`[updates] could not download the update to ${request.version}`, e)
    return {
      kind: 'failed',
      reason: `The update to ${request.version} could not be downloaded.`,
    }
  }

  log.info(
    `[updates] ${request.version} checked against its SHA-256, handing it to Squirrel`
  )
  feedDirectory = directory
  autoUpdater.setFeedURL({ url: directory })
  autoUpdater.checkForUpdates()
  return { kind: 'started' }
}

/**
 * Download the full package of a newer release, check it against the sum
 * file of the same release, and hand Squirrel.Windows a feed of it. Squirrel
 * then reports through the usual auto updater events. Only one at a time.
 */
export function prepareForgeUpdate(
  request: IForgeUpdateRequest
): Promise<ForgeUpdateResult> {
  if (inFlight === null) {
    inFlight = prepare(request).finally(() => {
      inFlight = null
    })
  }

  return inFlight
}

/**
 * Once Squirrel has applied the update or given up, the feed is no longer
 * needed: Squirrel keeps its own copy of the package.
 */
export function removeForgeUpdateFeed(applied: boolean) {
  const directory = feedDirectory
  feedDirectory = null

  if (directory === null) {
    return
  }

  log.info(
    applied
      ? '[updates] Squirrel applied the update, restart to finish it'
      : '[updates] Squirrel could not apply the update'
  )
  rm(directory, { recursive: true, force: true }).catch(e =>
    log.warn(`[updates] could not remove ${directory}`, e)
  )
}
