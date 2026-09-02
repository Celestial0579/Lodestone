import * as React from 'react'
import { Account } from '../../models/account'
import { isAttributableEmailFor } from '../../lib/email'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AriaLiveContainer } from '../accessibility/aria-live-container'

interface IGitEmailNotFoundWarningProps {
  /** The account the commit should be attributed to. */
  readonly accounts: ReadonlyArray<Account>

  /** The email address used in the commit author info. */
  readonly email: string
}

/**
 * A component which just displays a warning to the user if their git config
 * email doesn't match any of the emails in their Gitea (Enterprise) account.
 */
export class GitEmailNotFoundWarning extends React.Component<IGitEmailNotFoundWarningProps> {
  private buildMessage(isAttributableEmail: boolean) {
    const indicatorIcon = !isAttributableEmail ? (
      <span className="warning-icon">⚠️</span>
    ) : (
      <span className="green-circle">
        <Octicon className="check-icon" symbol={octicons.check} />
      </span>
    )

    // Upstream links to GitHub's article on commit attribution. Gitea has no
    // equivalent page, so say what to do instead of pointing somewhere useless.
    const learnMore = !isAttributableEmail
      ? 'Add it under Settings, Account on your instance.'
      : null

    return (
      <>
        {indicatorIcon}
        {this.buildScreenReaderMessage(isAttributableEmail)}
        {learnMore}
      </>
    )
  }

  private buildScreenReaderMessage(isAttributableEmail: boolean) {
    const verb = !isAttributableEmail ? 'does not match' : 'matches'
    const info = !isAttributableEmail
      ? 'Your commits will be wrongly attributed. '
      : ''
    return `This email address ${verb} ${this.getAccountTypeDescription()}. ${info}`
  }

  public render() {
    const { accounts, email } = this.props

    if (accounts.length === 0 || email.trim().length === 0) {
      return null
    }

    const isAttributableEmail = accounts.some(account =>
      isAttributableEmailFor(account, email)
    )

    /**
     * Here we put the message in the top div for visual users immediately  and
     * in the bottom div for screen readers. The screen reader content is
     * debounced to avoid frequent updates from typing in the email field.
     */
    return (
      <>
        <div className="git-email-not-found-warning">
          {this.buildMessage(isAttributableEmail)}
        </div>

        <AriaLiveContainer
          id="git-email-not-found-warning-for-screen-readers"
          trackedUserInput={this.props.email}
          message={this.buildScreenReaderMessage(isAttributableEmail)}
        />
      </>
    )
  }

  private getAccountTypeDescription() {
    // Upstream distinguishes GitHub.com from Enterprise accounts here. Every
    // account is a Gitea account, so the only thing that varies is whether the
    // user has one or several.
    return this.props.accounts.length === 1
      ? 'your Gitea account'
      : 'any of your Gitea accounts'
  }
}
