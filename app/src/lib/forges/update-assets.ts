/**
 * The checks the self-update makes on a release before anything of it reaches
 * Squirrel.Windows. Kept free of Electron and of the network, so that every
 * rule here is covered by unit tests.
 *
 * Security model (#50): a package is taken only from the release the update
 * check found, only over HTTPS from the host of the configured repository or
 * the asset storage that host is known to hand downloads to, and only if its
 * SHA-256 is the one `SHA256SUMS.txt` of the same release lists for it. The
 * builds are unsigned (#23), so this protects against corrupted and swapped
 * downloads, not against whoever can publish releases in that repository.
 * Which repository that is, the user chooses in Options.
 */

/** The name of the file of SHA-256 sums every release carries. */
export const Sha256SumsFileName = 'SHA256SUMS.txt'

/** Larger than any package we build, by a wide margin. */
export const MaxPackageSize = 1024 * 1024 * 1024

/** The sum file is a few lines. Anything larger is not one. */
export const MaxSumsFileSize = 64 * 1024

/** A file attached to a release. */
export interface IReleaseAsset {
  readonly name: string
  /** Where the forge says the file can be downloaded. */
  readonly url: string
  /** The size the forge reports, in bytes. */
  readonly size: number
}

/** The two files of a release the self-update needs. */
export interface IUpdateAssets {
  readonly package: IReleaseAsset
  readonly sums: IReleaseAsset
}

/**
 * The name Squirrel.Windows gives the full package of a version. Squirrel reads
 * the version from it, so it must be exactly this (#47).
 */
export function getFullPackageName(packageId: string, version: string) {
  return `${packageId}-${version}-full.nupkg`
}

/**
 * Find the full package of the given version and the sum file among the
 * assets of a release, or say why the release cannot be used.
 */
export function findUpdateAssets(
  assets: ReadonlyArray<IReleaseAsset>,
  packageId: string,
  version: string
): IUpdateAssets | string {
  const packageName = getFullPackageName(packageId, version)
  const pkg = assets.find(a => a.name === packageName)
  const sums = assets.find(a => a.name === Sha256SumsFileName)

  if (pkg === undefined) {
    return `The release has no ${packageName}.`
  }

  if (sums === undefined) {
    return `The release has no ${Sha256SumsFileName}, so ${packageName} cannot be checked.`
  }

  if (!(pkg.size > 0 && pkg.size <= MaxPackageSize)) {
    return `The release lists ${packageName} with an implausible size.`
  }

  return { package: pkg, sums }
}

/**
 * Read a sum file in the format `sha256sum` writes: the sum in hex, white
 * space, the file name. Lines that are not of that form are left out. A name
 * listed twice with different sums makes the whole file unusable, since there
 * is then no telling which one is meant.
 */
export function parseSha256Sums(text: string): Map<string, string> | null {
  const sums = new Map<string, string>()

  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$/.exec(line)

    if (match === null) {
      continue
    }

    const sum = match[1].toLowerCase()
    const name = match[2]
    const known = sums.get(name)

    if (known !== undefined && known !== sum) {
      return null
    }

    sums.set(name, sum)
  }

  return sums
}

/**
 * The hosts a download from a repository on the given host may come from:
 * that host itself and, for github.com, the storage it redirects release
 * downloads to.
 */
function isAllowedHost(host: string, sourceHost: string) {
  if (host === sourceHost) {
    return true
  }

  return (
    sourceHost === 'github.com' &&
    (host === 'objects.githubusercontent.com' ||
      host === 'release-assets.githubusercontent.com')
  )
}

/**
 * Whether a file of the self-update may be downloaded from, or redirected to,
 * the given address, for a repository at `sourceURL`. Only HTTPS, no
 * credentials in the address, and only the hosts above.
 */
export function isAllowedUpdateURL(url: string, sourceURL: string): boolean {
  let parsed: URL
  let source: URL

  try {
    parsed = new URL(url)
    source = new URL(sourceURL)
  } catch {
    return false
  }

  return (
    parsed.protocol === 'https:' &&
    source.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    isAllowedHost(parsed.host.toLowerCase(), source.host.toLowerCase())
  )
}

/**
 * The line of a Squirrel.Windows RELEASES file for a full package: its SHA-1
 * in upper case hex, its name and its size.
 */
export function formatReleasesEntry(
  sha1: string,
  packageName: string,
  size: number
) {
  return `${sha1.toUpperCase()} ${packageName} ${size}`
}
