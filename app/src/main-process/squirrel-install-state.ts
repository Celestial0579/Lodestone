import * as Path from 'path'
import * as Os from 'os'
import { gt, parse } from 'semver'

/** What a normal start still has to do for an installation. */
export type InstallationRepair =
  | { readonly kind: 'none' }
  | { readonly kind: 'install'; readonly createShortcuts: boolean }
  | { readonly kind: 'update' }

export interface IInstallationState {
  /**
   * Whether the app runs from a Squirrel.Windows installation, which is to
   * say whether `Update.exe` sits beside the folder of this version.
   */
  readonly isSquirrelInstallation: boolean

  /**
   * The command line trampoline as it is on disk, or null when there is none.
   */
  readonly trampoline: string | null

  /** The trampoline this version writes. */
  readonly expectedTrampoline: string

  /** Whether the Start menu or the desktop has a shortcut to the app. */
  readonly hasShortcut: boolean

  /** Whether a newer version is installed beside this one. */
  readonly hasNewerVersion: boolean
}

/**
 * Work out what the Squirrel hook of this version left undone.
 *
 * Squirrel runs the app with `--squirrel-install` or `--squirrel-updated` and
 * gives that run about fifteen seconds. The first start of a freshly written
 * executable can take longer than that, and then Squirrel gives up on it and
 * reports success all the same: no shortcuts, no command line tool, and after
 * an update a trampoline that still points at the version before.
 *
 * A hook sees to the shortcuts first and writes the trampoline after, and the
 * trampoline names its version. So it tells whether the hook of this version
 * got that far.
 */
export function getInstallationRepair(
  state: IInstallationState
): InstallationRepair {
  if (!state.isSquirrelInstallation) {
    return { kind: 'none' }
  }

  if (state.trampoline === state.expectedTrampoline) {
    return { kind: 'none' }
  }

  if (state.trampoline === null) {
    // Shortcuts someone removed on purpose stay removed: a hook that created
    // them also wrote the trampoline, and then we do not get here. Where the
    // hook was cut short between the two, the shortcuts are already there.
    return { kind: 'install', createShortcuts: !state.hasShortcut }
  }

  // The trampoline belongs to another version. If that is a newer one, this
  // is an old executable started by hand, and the trampoline is right.
  return state.hasNewerVersion ? { kind: 'none' } : { kind: 'update' }
}

function getVersionOfAppFolder(name: string) {
  const match = /^app-(.+)$/.exec(name)
  return match === null ? null : parse(match[1])
}

/**
 * Whether one of the folders beside the folder of this version holds a newer
 * version. Squirrel names them `app-<version>`.
 */
export function hasNewerVersionInstalled(
  ownFolder: string,
  folders: ReadonlyArray<string>
): boolean {
  const own = getVersionOfAppFolder(ownFolder)

  if (own === null) {
    return false
  }

  return folders.some(folder => {
    const version = getVersionOfAppFolder(folder)
    return version !== null && gt(version, own)
  })
}

/**
 * The batch file in the fixed `bin` folder which starts the command line tool
 * of the version in `appFolder`.
 */
export function getBatchScriptCLITrampoline(
  binPath: string,
  appFolder: string,
  path: Pick<typeof Path, 'join' | 'relative'> = Path
): string {
  const versionedPath = path.relative(
    binPath,
    path.join(appFolder, 'resources/app/static/lodestone.bat')
  )

  return `@echo off\n"%~dp0\\${versionedPath}" %*`
}

/**
 * The Start menu shortcut Squirrel.Windows makes for an app published under
 * the given name: it files shortcuts by publisher.
 */
function getStartMenuShortcutPath(
  homeDirectory: string,
  companyName: string,
  pathApi: typeof Path = Path
) {
  return pathApi.join(
    homeDirectory,
    'AppData',
    'Roaming',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    companyName,
    `${__APP_NAME__}.lnk`
  )
}

/** Where Squirrel.Windows puts the shortcuts of the app. */
export function getSquirrelShortcutPaths(
  homeDirectory: string = Os.homedir()
): ReadonlyArray<string> {
  return [
    getStartMenuShortcutPath(homeDirectory, __APP_COMPANY__),
    Path.join(homeDirectory, 'Desktop', `${__APP_NAME__}.lnk`),
  ]
}

/** The names the app was published under on Windows before the current one. */
export const formerCompanyNames: ReadonlyArray<string> = ['Firestrike']

/**
 * Where the Start menu shortcuts of earlier releases are, which an update to
 * a release under another publisher name would otherwise leave beside the new
 * one.
 */
export function getFormerStartMenuShortcutPaths(
  homeDirectory: string = Os.homedir(),
  companyName: string = __APP_COMPANY__,
  pathApi: typeof Path = Path
): ReadonlyArray<string> {
  return formerCompanyNames
    .filter(name => name.toLowerCase() !== companyName.toLowerCase())
    .map(name => getStartMenuShortcutPath(homeDirectory, name, pathApi))
}

/**
 * Whether a shortcut leads into the given Squirrel.Windows installation, so
 * that removing it takes nothing from another app filed under the same name.
 */
export function isShortcutIntoInstallation(
  target: string,
  rootAppDir: string,
  pathApi: typeof Path = Path
): boolean {
  if (target === '' || rootAppDir === '') {
    return false
  }

  const root = pathApi.resolve(rootAppDir).toLowerCase()
  const resolved = pathApi.resolve(target).toLowerCase()
  return resolved.startsWith(
    root.endsWith(pathApi.sep) ? root : root + pathApi.sep
  )
}
