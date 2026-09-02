import * as React from 'react'
import { Dialog, DialogContent, DefaultDialogFooter } from '../dialog'
import { LinkButton } from '../lib/link-button'

interface ITermsAndConditionsProps {
  /** A function called when the dialog is dismissed. */
  readonly onDismissed: () => void
}

const mitLicense = 'https://opensource.org/license/mit'
const upstream = 'https://github.com/desktop/desktop'
const gitea = 'https://about.gitea.com/'

/**
 * Upstream shows GitHub's Open Source Applications Terms here, which are an
 * agreement with GitHub about using their service. None of that applies to this
 * fork, so this states what actually governs it.
 */
export class TermsAndConditions extends React.Component<
  ITermsAndConditionsProps,
  {}
> {
  public render() {
    return (
      <Dialog
        id="terms-and-conditions"
        title="License and terms"
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <p>
            Lodestone is free software, published under the{' '}
            <LinkButton uri={mitLicense}>MIT license</LinkButton>. You may use,
            copy, modify and redistribute it under the terms of that license.
            There is no separate agreement to accept and no warranty of any
            kind.
          </p>

          <p>
            It is a fork of{' '}
            <LinkButton uri={upstream}>GitHub Desktop</LinkButton>, which is
            also MIT licensed and remains copyright GitHub, Inc. The licences of
            the libraries it builds on are listed under Open Source Licenses.
          </p>

          <h2>An independent project</h2>

          <p>
            Lodestone is not affiliated with, endorsed by or supported by{' '}
            <LinkButton uri={gitea}>Gitea Ltd</LinkButton> or GitHub, Inc.
            Gitea, GitHub and Git are trademarks of their respective owners and
            are named here only to say what this software works with.
          </p>

          <h2>Your data</h2>

          <p>
            Lodestone talks to the Gitea instances you sign in to and to nothing
            else. It collects no usage data and sends no telemetry anywhere.
            Your access tokens are held in the credential store your operating
            system provides.
          </p>
        </DialogContent>

        <DefaultDialogFooter />
      </Dialog>
    )
  }
}
