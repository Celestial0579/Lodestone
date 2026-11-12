import * as Path from 'path'
import * as Os from 'os'

import { app } from 'electron'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { spawn, getPathSegments, setPathSegments } from '../lib/process/win32'
import { pathExists } from '../lib/path-exists'
import { getKeyForEndpoint } from '../lib/auth'
import { parseCredentialTargets } from '../lib/credential-targets'
import {
  getBatchScriptCLITrampoline,
  getInstallationRepair,
  getSquirrelShortcutPaths,
  hasNewerVersionInstalled,
  InstallationRepair,
} from './squirrel-install-state'

const appFolder = Path.resolve(process.execPath, '..')
const rootAppDir = Path.resolve(appFolder, '..')
const updateDotExe = Path.resolve(Path.join(rootAppDir, 'Update.exe'))
const exeName = Path.basename(process.execPath)

// A lot of this code was cargo-culted from our Atom collaborators:
// https://github.com/atom/atom/blob/7c9f39e3f1d05ee423e0093e6b83f042ce11c90a/src/main-process/squirrel-update.coffee.

/** A protocol the app registers itself for, and the arguments it does so with. */
export interface IProtocolRegistration {
  readonly protocol: string
  readonly args: ReadonlyArray<string>
}

/**
 * Handle Squirrel.Windows app lifecycle events.
 *
 * Returns a promise which will resolve when the work is done.
 */
export function handleSquirrelEvent(
  eventName: string,
  protocols: ReadonlyArray<IProtocolRegistration> = []
): Promise<void> | null {
  switch (eventName) {
    case '--squirrel-install':
      return handleInstalled()

    case '--squirrel-updated':
      return handleUpdated()

    case '--squirrel-uninstall':
      return handleUninstall(protocols)

    case '--squirrel-obsolete':
      return Promise.resolve()
  }

  return null
}

async function handleInstalled(): Promise<void> {
  await createShortcut(['StartMenu', 'Desktop'])
  await installWindowsCLI()
}

async function handleUpdated(): Promise<void> {
  await updateShortcut()
  await installWindowsCLI()
}

/**
 * Do what the Squirrel hook of this version did not get to, if anything. To
 * be called on a normal start.
 *
 * Squirrel gives a hook about fifteen seconds and carries on without a word
 * when that is not enough. On a machine that has never run this executable
 * the first start alone can take longer, and the installation then ends with
 * neither shortcuts nor the command line tool.
 */
export async function finishInstallation(): Promise<InstallationRepair> {
  const binPath = getBinPath()
  const trampolinePath = Path.join(binPath, 'lodestone.bat')
  const shortcuts = await Promise.all(
    getSquirrelShortcutPaths().map(path => pathExists(path))
  )

  const repair = getInstallationRepair({
    isSquirrelInstallation: await pathExists(updateDotExe),
    trampoline: await readFile(trampolinePath, 'utf8').catch(() => null),
    expectedTrampoline: getBatchScriptCLITrampoline(binPath, appFolder),
    hasShortcut: shortcuts.includes(true),
    hasNewerVersion: hasNewerVersionInstalled(
      Path.basename(appFolder),
      await readdir(rootAppDir).catch(() => [])
    ),
  })

  if (repair.kind === 'install') {
    log.info(
      `The installation was not finished, finishing it now${
        repair.createShortcuts ? '' : ' (the shortcuts are there)'
      }`
    )

    if (repair.createShortcuts) {
      await createShortcut(['StartMenu', 'Desktop'])
    }

    await installWindowsCLI()
  } else if (repair.kind === 'update') {
    log.info('The update was not finished, finishing it now')
    await handleUpdated()
  }

  return repair
}

export async function installWindowsCLI(): Promise<void> {
  const binPath = getBinPath()
  await mkdir(binPath, { recursive: true })
  await writeBatchScriptCLITrampoline(binPath)
  await writeShellScriptCLITrampoline(binPath)
  try {
    const paths = getPathSegments()
    if (paths.indexOf(binPath) < 0) {
      await setPathSegments([...paths, binPath])
    }
  } catch (e) {
    log.error('Failed inserting bin path into PATH environment variable', e)
  }
}

export async function uninstallWindowsCLI() {
  try {
    const paths = getPathSegments()
    const binPath = getBinPath()
    const pathsWithoutBinPath = paths.filter(p => p !== binPath)
    return setPathSegments(pathsWithoutBinPath)
  } catch (e) {
    log.error('Failed removing bin path from PATH environment variable', e)
  }
}

/**
 * Get the path for the `bin` directory which exists in our `AppData` but
 * outside path which includes the installed app version.
 */
function getBinPath(): string {
  return Path.resolve(process.execPath, '../../bin')
}

function resolveVersionedPath(binPath: string, relativePath: string): string {
  const appFolder = Path.resolve(process.execPath, '..')
  return Path.relative(binPath, Path.join(appFolder, relativePath))
}

/**
 * Here's the problem: our app's path contains its version number. So each time
 * we update, the path to our app changes. So it's Real Hard to add our path
 * directly to `Path`. We'd have to detect and remove stale entries, etc.
 *
 * So instead, we write a trampoline out to a fixed path, still inside our
 * `AppData` directory but outside the version-specific path. That trampoline
 * just launches the current version's CLI tool. Then, whenever we update, we
 * rewrite the trampoline to point to the new, version-specific path. Bingo
 * bango Bob's your uncle.
 */
function writeBatchScriptCLITrampoline(binPath: string): Promise<void> {
  const trampoline = getBatchScriptCLITrampoline(binPath, appFolder)
  const trampolinePath = Path.join(binPath, 'lodestone.bat')

  return writeFile(trampolinePath, trampoline)
}

function writeShellScriptCLITrampoline(binPath: string): Promise<void> {
  // The path we get from `resolveVersionedPath` is a Win32 relative
  // path (something like `..\app-2.5.0\resources\app\static\github.sh`).
  // We need to make sure it's a POSIX path in order for WSL to be able
  // to resolve it. See https://github.com/desktop/desktop/issues/4998
  const versionedPath = resolveVersionedPath(
    binPath,
    'resources/app/static/lodestone.sh'
  ).replace(/\\/g, '/')

  const trampoline = `#!/usr/bin/env bash
  DIR="$( cd "$( dirname "\$\{BASH_SOURCE[0]\}" )" && pwd )"
  sh "$DIR/${versionedPath}" "$@"`
  const trampolinePath = Path.join(binPath, 'lodestone')

  return writeFile(trampolinePath, trampoline, { encoding: 'utf8', mode: 755 })
}

/** Spawn the Squirrel.Windows `Update.exe` with a command. */
async function spawnSquirrelUpdate(
  commands: ReadonlyArray<string>
): Promise<void> {
  await spawn(updateDotExe, commands)
}

type ShortcutLocations = ReadonlyArray<'StartMenu' | 'Desktop'>

function createShortcut(locations: ShortcutLocations): Promise<void> {
  return spawnSquirrelUpdate([
    '--createShortcut',
    exeName,
    '-l',
    locations.join(','),
  ])
}

/**
 * Take back what the app put outside its own folders. Each step stands on its
 * own: Squirrel gives this hook a few seconds too, and one step failing is no
 * reason to leave the others undone.
 */
async function handleUninstall(
  protocols: ReadonlyArray<IProtocolRegistration>
): Promise<void> {
  await removeShortcut().catch(e =>
    log.error('Failed removing the shortcuts', e)
  )
  await uninstallWindowsCLI()
  removeProtocolHandlers(protocols)
  await removeStoredCredentials().catch(e =>
    log.error('Failed removing the stored credentials', e)
  )
}

/**
 * Unregister the app as the handler of its protocols. Electron leaves a
 * registration alone that names another executable than this one.
 */
function removeProtocolHandlers(
  protocols: ReadonlyArray<IProtocolRegistration>
) {
  for (const { protocol, args } of protocols) {
    try {
      app.removeAsDefaultProtocolClient(protocol, process.execPath, [...args])
    } catch (e) {
      log.error(`Failed removing the handler for ${protocol}`, e)
    }
  }
}

/**
 * Remove the access tokens and passwords the app keeps in the Windows
 * credential store. Whoever uninstalls an app may fairly assume it no longer
 * holds the keys to their accounts, and a later installation should not find
 * itself signed in.
 *
 * keytar can only look up an entry it is given the name of, and the names are
 * built from the accounts, which the renderer keeps. So this asks Windows for
 * the list and takes every entry carrying the app's prefix.
 */
async function removeStoredCredentials(): Promise<void> {
  const cmdkey = Path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'cmdkey.exe'
  )
  const prefix = getKeyForEndpoint('')
  const targets = parseCredentialTargets(await spawn(cmdkey, ['/list']), prefix)

  for (const target of targets) {
    await spawn(cmdkey, [`/delete:${target}`])
      .catch(() => spawn(cmdkey, [`/delete:LegacyGeneric:target=${target}`]))
      .catch(e => log.error('Failed removing a stored credential', e))
  }
}

function removeShortcut(): Promise<void> {
  return spawnSquirrelUpdate(['--removeShortcut', exeName])
}

async function updateShortcut(): Promise<void> {
  const homeDirectory = Os.homedir()
  if (homeDirectory) {
    const desktopShortcutPath = Path.join(
      homeDirectory,
      'Desktop',
      'Lodestone.lnk'
    )
    const exists = await pathExists(desktopShortcutPath)
    const locations: ShortcutLocations = exists
      ? ['StartMenu', 'Desktop']
      : ['StartMenu']
    return createShortcut(locations)
  } else {
    return createShortcut(['StartMenu', 'Desktop'])
  }
}
