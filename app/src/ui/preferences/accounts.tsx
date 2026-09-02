import * as React from 'react'
import { Account } from '../../models/account'
import { IAvatarUser } from '../../models/avatar'
import { lookupPreferredEmail } from '../../lib/email'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { DialogContent, DialogPreferredFocusClassName } from '../dialog'
import { Avatar } from '../lib/avatar'
import { CallToAction } from '../lib/call-to-action'
import { getHTMLURL } from '../../lib/api'

interface IAccountsProps {
  readonly accounts: ReadonlyArray<Account>

  readonly onSignIn: () => void
  readonly onLogout: (account: Account) => void
}

export class Accounts extends React.Component<IAccountsProps, {}> {
  public render() {
    const { accounts } = this.props

    return (
      <DialogContent className="accounts-tab">
        <h2>Accounts</h2>
        {accounts.length === 0
          ? this.renderSignIn()
          : this.renderAccounts(accounts)}
      </DialogContent>
    )
  }

  private renderAccounts(accounts: ReadonlyArray<Account>) {
    return (
      <>
        {accounts.map((account, index) =>
          this.renderAccount(account, index === 0)
        )}
        <Button onClick={this.props.onSignIn}>Add account</Button>
      </>
    )
  }

  private renderAccount(account: Account, isFirst: boolean) {
    const avatarUser: IAvatarUser = {
      name: account.name,
      email: lookupPreferredEmail(account),
      avatarURL: account.avatarURL,
      endpoint: account.endpoint,
    }

    // The first account's sign out button should be focused initially when the
    // dialog is opened.
    const className = isFirst ? DialogPreferredFocusClassName : undefined

    return (
      <Row className="account-info" key={`${account.endpoint}/${account.id}`}>
        <div className="user-info-container">
          <Avatar accounts={this.props.accounts} user={avatarUser} />
          <div className="user-info">
            <div className="account-title">
              {account.name === account.login
                ? `@${account.login}`
                : `@${account.login} (${account.name})`}
            </div>
            <div className="endpoint">{getHTMLURL(account.endpoint)}</div>
          </div>
        </div>
        <Button onClick={this.logout(account)} className={className}>
          {__DARWIN__ ? 'Sign Out' : 'Sign out'}
        </Button>
      </Row>
    )
  }

  private renderSignIn() {
    return (
      <CallToAction
        actionTitle={__DARWIN__ ? 'Sign In' : 'Sign in'}
        onAction={this.props.onSignIn}
        buttonClassName={DialogPreferredFocusClassName}
      >
        <div>
          Sign in to a Gitea, Forgejo, GitHub or other Git host to get access to
          your repositories.
        </div>
      </CallToAction>
    )
  }

  private logout = (account: Account) => {
    return () => {
      this.props.onLogout(account)
    }
  }
}
