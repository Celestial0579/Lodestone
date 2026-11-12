import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { SemVer } from 'semver'

import { NewerReleaseBanner } from '../../../src/ui/banners/newer-release-banner'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const release = {
  version: new SemVer('99.0.0'),
  name: 'Lodestone v99.0.0',
  htmlURL: 'https://github.com/team/lodestone/releases/tag/v99.0.0',
}

describe('NewerReleaseBanner', () => {
  it('names the release and links to where it can be downloaded', () => {
    const view = render(
      <NewerReleaseBanner release={release} onDismissed={() => {}} />
    )

    assert.match(
      view.container.textContent ?? '',
      /Lodestone v99\.0\.0 is available for download\./
    )
    assert.equal(
      screen
        .getByRole('link', { name: 'Lodestone v99.0.0' })
        .getAttribute('href'),
      'https://github.com/team/lodestone/releases/tag/v99.0.0'
    )
  })

  it('can be dismissed', () => {
    let dismissed = 0
    render(
      <NewerReleaseBanner release={release} onDismissed={() => dismissed++} />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss this message' })
    )

    assert.equal(dismissed, 1)
  })

  it('does not go away by itself', () => {
    // Banners that report a finished action leave when they lose focus. This
    // one says something that stays true until the user has acted on it.
    let dismissed = 0
    const view = render(
      <NewerReleaseBanner release={release} onDismissed={() => dismissed++} />
    )

    const link = screen.getByRole('link', { name: 'Lodestone v99.0.0' })
    fireEvent.focusIn(link)
    fireEvent.focusOut(link)

    assert.equal(dismissed, 0)
    assert.notEqual(view.container.querySelector('#newer-release-banner'), null)
  })
})
