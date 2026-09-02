#!/usr/bin/env ts-node

import * as Path from 'path'
import { spawnSync, SpawnSyncOptions } from 'child_process'

import glob from 'glob'
import { forceUnwrap } from '../app/src/lib/fatal-error'

const root = Path.dirname(__dirname)

const options: SpawnSyncOptions = {
  cwd: root,
  stdio: 'inherit',
}

const captureOutputOptions: SpawnSyncOptions = {
  cwd: root,
  encoding: 'utf8',
}

// Some Windows CI runners do not expose an `npx` executable on PATH, so
// invoke the locally installed Playwright CLI through the current Node binary.
// Resolve from the exported package root since `playwright/cli` is not exported.
const playwrightPackagePath = require.resolve('playwright/package.json')
const playwrightCliPath = Path.join(
  Path.dirname(playwrightPackagePath),
  'cli.js'
)

function findYarnVersion(callback: (path: string) => void) {
  glob('vendor/yarn-*.js', (error, files) => {
    if (error != null) {
      throw error
    }

    // this ensures the paths returned by glob are sorted alphabetically
    files.sort()

    // use the latest version here if multiple are found
    callback(forceUnwrap('Missing vendored yarn', files.at(-1)))
  })
}

findYarnVersion(path => {
  let result = spawnSync(
    'node',
    [path, '--cwd', 'app', 'install', '--force'],
    options
  )

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  // Electron >= 42 no longer downloads its prebuilt binary in its own
  // postinstall; do it eagerly so scripts that read node_modules/electron/dist
  // (e.g. validate-macos-version) keep working without first requiring electron.
  const electronInstallScript = require.resolve('electron/install.js')
  result = spawnSync(process.execPath, [electronInstallScript], options)

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  // The three submodules hold data used when packaging the app: the emoji
  // database, the gitignore templates and the licence texts. Nothing else
  // reads them - not the typechecker, not the tests - so a machine that cannot
  // reach them can still develop and check the code.
  //
  // They live on github.com, which is not a given on a build machine set up
  // for a self-hosted forge. Warn and carry on rather than failing the whole
  // install; script/build.ts refuses to package without them, with a message
  // saying what to do.
  // Deliberately not --recursive. choosealicense.com carries its own
  // submodule, spdx/license-list-XML on github.com, which nothing here reads:
  // the licence list is built from its _licenses directory and LICENSE.md.
  // Fetching it cost a hundred megabytes and the last dependency this build
  // had on a host we otherwise do not need.
  result = spawnSync('git', ['submodule', 'update', '--init'], options)

  if (result.status !== 0) {
    console.warn(
      [
        '',
        'WARNING: could not fetch the data submodules.',
        '',
        '  Typechecking, linting and the tests do not need them, so this is not',
        '  fatal. Packaging the app does: run',
        '',
        '    git submodule update --recursive --init',
        '',
        '  once this machine can reach the hosts in .gitmodules.',
        '',
      ].join('\n')
    )
  }

  result = spawnSync('node', [path, 'compile:script'], options)

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  // Capture output here so CI failures include the Playwright-specific error.
  result = spawnSync(
    process.execPath,
    [playwrightCliPath, 'install', 'ffmpeg'],
    captureOutputOptions
  )

  if (result.status !== 0) {
    console.error(
      'Error: failed to install Playwright ffmpeg (video recording may not work)',
      '\nplatform:',
      process.platform,
      '\nstatus:',
      result.status,
      '\nsignal:',
      result.signal,
      '\nerror:',
      result.error,
      '\nstdout:',
      result.stdout,
      '\nstderr:',
      result.stderr
    )
  }
})
