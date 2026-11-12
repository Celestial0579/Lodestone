import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import {
  getBatchScriptCLITrampoline,
  getInstallationRepair,
  hasNewerVersionInstalled,
  IInstallationState,
} from '../../src/main-process/squirrel-install-state'

const root = 'C:\\Users\\alice\\AppData\\Local\\Lodestone'
const trampolineOf = (version: string) =>
  getBatchScriptCLITrampoline(
    `${root}\\bin`,
    `${root}\\app-${version}`,
    Path.win32
  )

/** An installation whose hook ran to the end. */
const finished: IInstallationState = {
  isSquirrelInstallation: true,
  trampoline: trampolineOf('1.0.0'),
  expectedTrampoline: trampolineOf('1.0.0'),
  hasShortcut: true,
  hasNewerVersion: false,
}

describe('getInstallationRepair', () => {
  it('leaves a finished installation alone', () => {
    assert.deepEqual(getInstallationRepair(finished), { kind: 'none' })
  })

  it('finishes an installation whose hook was cut short at the start', () => {
    // What a fresh Windows was left with: Squirrel gave up on the hook before
    // it had created anything, and reported success.
    assert.deepEqual(
      getInstallationRepair({
        ...finished,
        trampoline: null,
        hasShortcut: false,
      }),
      { kind: 'install', createShortcuts: true }
    )
  })

  it('installs only the command line tool where the shortcuts are there', () => {
    assert.deepEqual(getInstallationRepair({ ...finished, trampoline: null }), {
      kind: 'install',
      createShortcuts: false,
    })
  })

  it('does not bring back shortcuts that were removed on purpose', () => {
    // The trampoline says the hook got to the end, so the shortcuts existed.
    assert.deepEqual(
      getInstallationRepair({ ...finished, hasShortcut: false }),
      { kind: 'none' }
    )
  })

  it('finishes an update that left the trampoline of the version before', () => {
    assert.deepEqual(
      getInstallationRepair({ ...finished, trampoline: trampolineOf('0.9.0') }),
      { kind: 'update' }
    )
  })

  it('leaves the trampoline of a newer version alone', () => {
    // An old executable started by hand must not point the command line tool
    // back at itself.
    assert.deepEqual(
      getInstallationRepair({
        ...finished,
        trampoline: trampolineOf('1.1.0'),
        hasNewerVersion: true,
      }),
      { kind: 'none' }
    )
  })

  it('does nothing outside a Squirrel installation', () => {
    // A build run from its folder, without Update.exe beside it.
    assert.deepEqual(
      getInstallationRepair({
        ...finished,
        isSquirrelInstallation: false,
        trampoline: null,
        hasShortcut: false,
      }),
      { kind: 'none' }
    )
  })
})

describe('hasNewerVersionInstalled', () => {
  const others = ['bin', 'packages', 'Update.exe', 'app.ico', '.dead']

  it('is false for the only version', () => {
    assert.equal(
      hasNewerVersionInstalled('app-1.0.0', [...others, 'app-1.0.0']),
      false
    )
  })

  it('is false beside the version before', () => {
    assert.equal(
      hasNewerVersionInstalled('app-1.0.0', [
        ...others,
        'app-0.9.0',
        'app-1.0.0',
      ]),
      false
    )
  })

  it('is true beside a later version', () => {
    assert.equal(
      hasNewerVersionInstalled('app-1.0.0', [
        ...others,
        'app-1.0.0',
        'app-1.0.1',
      ]),
      true
    )
  })

  it('orders a prerelease before its release', () => {
    assert.equal(
      hasNewerVersionInstalled('app-1.1.0-beta1', ['app-1.1.0']),
      true
    )
    assert.equal(
      hasNewerVersionInstalled('app-1.1.0', ['app-1.1.0-beta1']),
      false
    )
  })

  it('is false where the folder carries no version', () => {
    assert.equal(hasNewerVersionInstalled('Lodestone-win32-x64', []), false)
    assert.equal(hasNewerVersionInstalled('app-1.0.0', ['app-next']), false)
  })
})

describe('getBatchScriptCLITrampoline', () => {
  it('starts the batch file of its version from the bin folder', () => {
    assert.equal(
      trampolineOf('1.0.0'),
      '@echo off\n"%~dp0\\..\\app-1.0.0\\resources\\app\\static\\lodestone.bat" %*'
    )
  })

  it('differs from one version to the next', () => {
    assert.notEqual(trampolineOf('1.0.0'), trampolineOf('1.0.1'))
  })
})
