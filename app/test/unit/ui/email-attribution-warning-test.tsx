import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { getDotComAPIEndpoint, type IAPIEmail } from '../../../src/lib/api'
import { Account } from '../../../src/models/account'
import { GitEmailNotFoundWarning } from '../../../src/ui/lib/git-email-not-found-warning'
import { render, screen } from '../../helpers/ui/render'

function createEmail(email: string): IAPIEmail {
  return {
    email,
    verified: true,
    primary: true,
    visibility: 'public',
  }
}

function createAccount(email: string) {
  return new Account(
    'mona',
    getDotComAPIEndpoint(),
    '',
    [createEmail(email)],
    '',
    1,
    'Mona'
  )
}

describe('GitEmailNotFoundWarning', () => {
  it('renders nothing when there are no accounts or the email is blank', () => {
    const view = render(
      <>
        <GitEmailNotFoundWarning accounts={[]} email="person@example.com" />
        <GitEmailNotFoundWarning
          accounts={[createAccount('mona@example.com')]}
          email=" "
        />
      </>
    )

    assert.equal(view.container.textContent, '')
    assert.equal(
      view.container.querySelector('.git-email-not-found-warning'),
      null
    )
  })

  it('renders a mismatch warning, learn-more link, and screen-reader message', () => {
    const view = render(
      <GitEmailNotFoundWarning
        accounts={[createAccount('mona@example.com')]}
        email="other@example.com"
      />
    )

    const warning = view.container.querySelector('.git-email-not-found-warning')
    const srOnly = view.container.querySelector(
      '#git-email-not-found-warning-for-screen-readers.sr-only'
    )
    assert.notEqual(warning, null)
    assert.ok(
      warning?.textContent?.includes('does not match your account')
    )
    // Other forges have no equivalent of GitHub's commit attribution article,
    // so the
    // warning tells the user what to do instead of linking somewhere useless.
    assert.ok(warning?.textContent?.includes('Add it under Settings, Account'))
    assert.equal(
      screen.queryByRole('link', {
        name: 'Learn more about commit attribution',
      }),
      null
    )
    assert.equal(srOnly?.getAttribute('aria-live'), 'polite')
    assert.ok(
      srOnly?.textContent?.startsWith(
        'This email address does not match your account.'
      )
    )
  })

  it('renders a success indicator without the learn-more link when the email matches', () => {
    const view = render(
      <GitEmailNotFoundWarning
        accounts={[createAccount('mona@example.com')]}
        email="mona@example.com"
      />
    )

    const warning = view.container.querySelector('.git-email-not-found-warning')

    assert.notEqual(warning?.querySelector('.green-circle .check-icon'), null)
    assert.ok(warning?.textContent?.includes('matches your account'))
    assert.equal(
      screen.queryByRole('link', {
        name: 'Learn more about commit attribution',
      }),
      null
    )
  })
})
