import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'
import * as React from 'react'

import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import { RepositoryTrustDialog } from '../../../src/ui/repository-trust/repository-trust-dialog'
import { Repository } from '../../../src/models/repository'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import { makeVisible } from '../../../src/lib/git/repository-trust'

const repository = new Repository('/some/path/repo', 1, null, false)

function dialog(
  overrides: Partial<React.ComponentProps<typeof RepositoryTrustDialog>> = {}
) {
  const answers = new Array<boolean>()
  let dismissed = 0
  render(
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <RepositoryTrustDialog
        repository={repository}
        lines={['core.sshcommand = touch /x', 'hook: pre-commit']}
        networkKeys={[]}
        inWorkTree={false}
        onAnswer={(_, trusted) => answers.push(trusted)}
        onDismissed={() => dismissed++}
        {...overrides}
      />
    </DialogStackContext.Provider>
  )
  return { answers, dismissed: () => dismissed }
}

const showModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal'
)
const close = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close'
)
let restoreIpcSend: (() => void) | null = null

const put = (name: 'showModal' | 'close', d?: PropertyDescriptor) =>
  d === undefined
    ? Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    : Object.defineProperty(HTMLDialogElement.prototype, name, d)

describe('RepositoryTrustDialog', () => {
  before(async () => {
    const electron = await import('electron')
    const previousSend = electron.ipcRenderer.send
    electron.ipcRenderer.send = () => {}
    restoreIpcSend = () => {
      electron.ipcRenderer.send = previousSend
    }
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
      this.focus()
    }
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
  })

  after(() => {
    restoreIpcSend?.()
    put('showModal', showModal)
    put('close', close)
  })

  it('is an alert dialog with a description, and lists what was found as text', async () => {
    dialog()

    const box = await screen.findByRole('alertdialog')
    assert.ok(box.getAttribute('aria-describedby'))
    assert.ok(screen.getByText('core.sshcommand = touch /x'))
    assert.ok(screen.getByText('hook: pre-commit'))
    assert.ok(screen.getByRole('list', { name: /Found in this repository/ }))
  })

  it('has "Don’t trust" in focus when it opens', async () => {
    dialog()

    await waitFor(() => {
      assert.equal(
        (document.activeElement as HTMLElement | null)?.textContent,
        'Don’t trust'
      )
    })
  })

  it('answers no on Enter, which submits the form', async () => {
    const { answers, dismissed } = dialog()
    const box = await screen.findByRole('alertdialog')

    fireEvent.submit(box.querySelector('form') ?? box)

    await waitFor(() => assert.deepEqual(answers, [false]))
    assert.equal(dismissed(), 1)
  })

  it('answers no with its button and yes only with the other', async () => {
    const no = dialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Don’t trust' }))
    await waitFor(() => assert.deepEqual(no.answers, [false]))
  })

  it('answers yes only when the user presses the trust button', async () => {
    const yes = dialog()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Trust this repository' })
    )
    await waitFor(() => assert.deepEqual(yes.answers, [true]))
  })

  it('treats closing the dialog as no answer at all', async () => {
    const closed = dialog()
    const box = await screen.findByRole('alertdialog')

    fireEvent.keyDown(box, { key: 'Escape' })

    await waitFor(() => assert.equal(closed.dismissed() >= 0, true))
    assert.deepEqual(closed.answers, [])
  })

  it('names the keys that block the network, only when there are some', async () => {
    dialog({ networkKeys: ['http.proxy', 'http.sslverify'] })
    assert.ok(await screen.findByText(/http\.proxy, http\.sslverify/))
  })

  it('does not mention the network or the work tree when neither applies', async () => {
    dialog()
    await screen.findByRole('alertdialog')
    assert.equal(screen.queryByText(/does not fetch, pull or push/), null)
    assert.equal(screen.queryByText(/lie in the working folder/), null)
  })

  it('says when files lie in the working folder', async () => {
    dialog({ inWorkTree: true })
    assert.ok(await screen.findByText(/lie in the working folder/))
  })

  it('shows control characters of the repository name as code points', async () => {
    const odd = new Repository(
      `/x/${String.fromCharCode(0x202e)}evil`,
      2,
      null,
      false
    )
    dialog({ repository: odd })
    const box = await screen.findByRole('alertdialog')
    assert.ok(box.textContent?.includes(`${makeVisible(odd.name)}`))
    assert.equal(box.textContent?.includes(String.fromCharCode(0x202e)), false)
  })
})
