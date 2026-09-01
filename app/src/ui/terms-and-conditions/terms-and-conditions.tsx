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
            Gitea Desktop is free software, published under the{' '}
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

          <h2>Not an official Gitea product</h2>

          <p>
            This application is not published, endorsed or supported by the{' '}
            <LinkButton uri={gitea}>Gitea</LinkButton> project. Gitea, GitHub
            and their logos are trademarks of their respective owners, used here
            to say what this software works with.
          </p>

          <h2>Your data</h2>

          <p>
            Gitea Desktop talks to the Gitea instances you sign in to and to
            nothing else. It collects no usage data and sends no telemetry
            anywhere. Your access tokens are held in the credential store your
            operating system provides.
          </p>
        </DialogContent>

        <DefaultDialogFooter />
      </Dialog>
    )
  }
}
