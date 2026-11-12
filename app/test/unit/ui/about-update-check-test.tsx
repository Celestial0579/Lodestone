import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'
import * as React from 'react'

import { About } from '../../../src/ui/about/about'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import {
  ForgeCheckOutcome,
  IUpdateState,
  UpdateStatus,
} from '../../../src/ui/lib/update-store'
import { render, screen } from '../../helpers/ui/render'

const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal'
)
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close'
)

const restore = (
  name: 'showModal' | 'close',
  descriptor?: PropertyDescriptor
) =>
  descriptor === undefined
    ? Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    : Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)

const anHourAgo = new Date(Date.now() - 60 * 60 * 1000)

/** What the About dialog is handed after a check that found no update. */
const stateAfter = (
  forgeCheck: ForgeCheckOutcome | null,
  lastSuccessfulCheck: Date | null = anHourAgo
): IUpdateState => ({
  status: UpdateStatus.UpdateNotAvailable,
  lastSuccessfulCheck,
  isX64ToARM64ImmediateAutoUpdate: false,
  newReleases: null,
  prioritizeUpdate: false,
  prioritizeUpdateInfoUrl: undefined,
  forgeRelease: null,
  forgeCheck,
})

const noop = () => {}

const renderAbout = (updateState: IUpdateState) =>
  render(
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <About
        onDismissed={noop}
        applicationName="Lodestone"
        applicationVersion="1.0.0"
        applicationArchitecture="x64"
        onCheckForNonStaggeredUpdates={noop}
        onShowAcknowledgements={noop}
        onShowTermsAndConditions={noop}
        onQuitAndInstall={noop}
        updateState={updateState}
        allowDevelopment={true}
      />
    </DialogStackContext.Provider>
  )

const text = (view: ReturnType<typeof render>) =>
  view.container.textContent ?? ''

describe('About dialog after an update check', () => {
  let restoreIpcSend: (() => void) | null = null
  const wasLinux = __LINUX__

  // Set up once for the file rather than around each test: the dialogs are
  // unmounted by a hook that runs after any afterEach here, and unmounting
  // calls close().
  before(async () => {
    // The dialog shows nothing about updates on Linux, which is where these
    // tests usually run, so stand in for a platform that has them.
    Object.assign(globalThis, { __LINUX__: false })

    const electron = await import('electron')
    const previousSend = electron.ipcRenderer.send
    electron.ipcRenderer.send = () => {}
    restoreIpcSend = () => {
      electron.ipcRenderer.send = previousSend
    }

    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
  })

  after(() => {
    Object.assign(globalThis, { __LINUX__: wasLinux })
    restoreIpcSend?.()
    restoreIpcSend = null
    restore('showModal', showModalDescriptor)
    restore('close', closeDescriptor)
  })

  it('says the version is current when a release was compared', () => {
    const view = renderAbout(stateAfter({ kind: 'compared' }))

    assert.match(text(view), /You have the latest version \(last checked/)
    assert.equal(screen.queryByRole('alert'), null)
  })

  it('says so when the repository has no published release', () => {
    const view = renderAbout(stateAfter({ kind: 'no-published-release' }))

    assert.match(
      text(view),
      /The repository checked for updates has no published release \(last checked/
    )
    assert.doesNotMatch(text(view), /You have the latest version/)
    assert.equal(screen.queryByRole('alert'), null)
  })

  it('shows why a check failed', () => {
    const view = renderAbout(
      stateAfter(
        { kind: 'failed', reason: 'github.com could not be reached.' },
        null
      )
    )

    assert.match(
      screen.getByRole('alert').textContent ?? '',
      /The last update check failed\. github\.com could not be reached\. The repository to check is set under Preferences, Advanced, Updates\./
    )
    assert.doesNotMatch(text(view), /You have the latest version/)
  })

  it('does not call the version current after a failure, even if an earlier check worked', () => {
    // This is the case that used to hide a broken update check: one success,
    // ever, and every failure after it read "You have the latest version".
    const view = renderAbout(
      stateAfter({ kind: 'failed', reason: 'github.com could not be reached.' })
    )

    assert.doesNotMatch(text(view), /You have the latest version/)
    assert.match(
      screen.getByRole('alert').textContent ?? '',
      /The last update check failed/
    )
  })

  it('keeps saying the version is current where no forge was checked', () => {
    // The Squirrel updater, for builds configured with a feed of their own,
    // never sets a forge outcome.
    const view = renderAbout(stateAfter(null))

    assert.match(text(view), /You have the latest version \(last checked/)
    assert.equal(screen.queryByRole('alert'), null)
  })
})
