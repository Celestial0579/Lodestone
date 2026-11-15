/* eslint-disable no-sync */

import * as cp from 'child_process'
import * as path from 'path'
import * as electronInstaller from 'electron-winstaller'
import { getProductName, getCompanyName } from '../app/package-info'
import {
  getDistPath,
  getOSXZipPath,
  getWindowsIdentifierName,
  getWindowsStandaloneName,
  getWindowsInstallerName,
  shouldMakeDelta,
  getUpdatesURL,
  getBundleSizes,
  getDistRoot,
  getDistArchitecture,
  getIconDirectory,
} from './dist-info'
import { ProjectRepositoryURL } from '../app/src/lib/project-links'
import { copyFileSync, existsSync, rmSync, writeFileSync } from 'fs'
import { computeBundleHashSync } from '../app/src/lib/compute-bundle-hash'
import { join } from 'path'

const distPath = getDistPath()
const productName = getProductName()
const outputDir = getDistRoot()

const assertExistsSync = (path: string) => {
  if (!existsSync(path)) {
    throw new Error(`Expected ${path} to exist`)
  }
}

if (process.platform === 'darwin') {
  packageOSX()
} else if (process.platform === 'win32') {
  packageWindows()
} else {
  console.error(`I don't know how to package for ${process.platform} :(`)
  process.exit(1)
}

console.log('Writing bundle size info…')
writeFileSync(
  path.join(getDistRoot(), 'bundle-size.json'),
  JSON.stringify(getBundleSizes())
)

console.log('Writing bundle hash…')
writeFileSync(
  path.join(getDistRoot(), 'bundle-hash.json'),
  JSON.stringify({
    bundleHash: computeBundleHashSync(path.join(__dirname, '..', 'out')),
  })
)

function packageOSX() {
  const dest = getOSXZipPath()
  rmSync(dest, { recursive: true, force: true })

  console.log('Packaging for macOS…')
  cp.execSync(
    `ditto -ck --keepParent "${distPath}/${productName}.app" "${dest}"`
  )
}

/**
 * Squirrel shells out to `7z.exe` next to its own assembly, but
 * electron-winstaller ships the archiver under architecture-suffixed names
 * only. Without this the release packaging fails with a bare "the system cannot
 * find the file specified" from deep inside Squirrel.
 */
function ensureSquirrelHasSevenZip() {
  const vendor = join(
    __dirname,
    '..',
    'node_modules',
    'electron-winstaller',
    'vendor'
  )
  const arch = getDistArchitecture()

  for (const extension of ['exe', 'dll']) {
    const expected = join(vendor, `7z.${extension}`)
    const shipped = join(vendor, `7z-${arch}.${extension}`)

    if (!existsSync(expected)) {
      assertExistsSync(shipped)
      copyFileSync(shipped, expected)
      console.log(`Provisioned ${expected} from ${shipped}`)
    }
  }
}

function packageWindows() {
  const iconSource = join(getIconDirectory(), 'icon-logo.ico')

  if (!existsSync(iconSource)) {
    console.error(`expected setup icon not found at location: ${iconSource}`)
    process.exit(1)
  }

  const splashScreenPath = path.resolve(
    __dirname,
    '../app/static/logos/win32-installer-splash.gif'
  )

  if (!existsSync(splashScreenPath)) {
    console.error(
      `expected setup splash screen gif not found at location: ${splashScreenPath}`
    )
    process.exit(1)
  }

  // Squirrel records this in the NuGet metadata, refuses an empty value, and
  // Squirrel.Windows downloads whatever it finds there to app.ico, to use as
  // the Add/Remove Programs icon. So it has to be an actual .ico, reachable
  // without signing in, and it must be this package's own mark rather than
  // anyone else's.
  //
  // The default points at the icon on the main branch of the project
  // repository, in GitHub's raw file form (`/raw/<ref>/<path>`, which
  // redirects to raw.githubusercontent.com). The repository is public, so no
  // sign-in is needed. Should the download fail anyway, Windows falls back to
  // the icon embedded in the executable - the same artwork, so nothing looks
  // wrong. Set LODESTONE_ICON_URL to use a different .ico.
  const iconUrl =
    process.env.LODESTONE_ICON_URL ??
    `${ProjectRepositoryURL}/raw/main/app/static/logos/prod/icon-logo.ico`

  const nugetPkgName = getWindowsIdentifierName()
  const options: electronInstaller.Options = {
    name: nugetPkgName,
    appDirectory: distPath,
    outputDirectory: outputDir,
    authors: getCompanyName(),
    iconUrl: iconUrl,
    setupIcon: iconSource,
    loadingGif: splashScreenPath,
    exe: `${nugetPkgName}.exe`,
    title: productName,
    setupExe: getWindowsStandaloneName(),
    setupMsi: getWindowsInstallerName(),
  }

  if (shouldMakeDelta()) {
    const url = new URL(getUpdatesURL())
    // Make sure Squirrel.Windows isn't affected by partially or completely
    // disabled releases.
    url.searchParams.set('bypassStaggeredRelease', '1')
    options.remoteReleases = url.toString()
  }

  // Upstream signed here through GitHub's own Azure code signing account,
  // which this fork has no access to. Releases are unsigned (#23).

  ensureSquirrelHasSevenZip()

  // The packages keep the names Squirrel.Windows gives them. Squirrel reads the
  // version from the file name and finds the package by the name in RELEASES,
  // so an architecture added to the name broke the update: RELEASES named a
  // file that was not there, and corrected by hand it made the version
  // 1.0.2-x64, a prerelease of 1.0.2.
  console.log('Packaging for Windows…')
  electronInstaller
    .createWindowsInstaller(options)
    .then(() => console.log(`Installers created in ${outputDir}`))
    .catch(e => {
      console.error(`Error packaging: ${e}`)
      process.exit(1)
    })
}
