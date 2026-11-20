import * as React from 'react'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { LinkButton } from '../lib/link-button'
import { isWindowsOpenSSHAvailable } from '../../lib/ssh/ssh'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import {
  IStoredTrustAnswer,
  localStorageTrust,
} from '../../lib/stores/repository-trust-store'
import { makeVisible } from '../../lib/git/repository-trust'
import {
  getUpdateSourceURL,
  parseUpdateSource,
  setUpdateSourceURL,
} from '../../lib/forges/update-source'

interface ITrustedRepositoryRowProps {
  readonly path: string
  readonly onRevoke: (path: string) => void
}

/** A trusted folder with the button that takes the trust back. */
class TrustedRepositoryRow extends React.Component<ITrustedRepositoryRowProps> {
  public render() {
    const shown = makeVisible(this.props.path)

    return (
      <li>
        <span>{shown}</span>{' '}
        <Button onClick={this.onClick} ariaLabel={`Revoke trust for ${shown}`}>
          Revoke
        </Button>
      </li>
    )
  }

  private onClick = () => this.props.onRevoke(this.props.path)
}

interface IAdvancedPreferencesProps {
  readonly useWindowsOpenSSH: boolean
  readonly optOutOfUsageTracking: boolean
  readonly useExternalCredentialHelper: boolean
  readonly repositoryIndicatorsEnabled: boolean
  readonly onUseWindowsOpenSSHChanged: (checked: boolean) => void
  readonly onOptOutofReportingChanged: (checked: boolean) => void
  readonly onUseExternalCredentialHelperChanged: (checked: boolean) => void
  readonly onRepositoryIndicatorsEnabledChanged: (enabled: boolean) => void
  /** Forget that the user trusts the repository in this folder. */
  readonly onRevokeRepositoryTrust: (path: string) => void
}

interface IAdvancedPreferencesState {
  readonly optOutOfUsageTracking: boolean
  readonly canUseWindowsSSH: boolean
  readonly useExternalCredentialHelper: boolean
  readonly updateSourceURL: string
  readonly trustedRepositories: ReadonlyArray<IStoredTrustAnswer>
}

export class Advanced extends React.Component<
  IAdvancedPreferencesProps,
  IAdvancedPreferencesState
> {
  private static readTrusted(): ReadonlyArray<IStoredTrustAnswer> {
    return Object.values(localStorageTrust.read())
      .filter(a => a.trusted)
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  public constructor(props: IAdvancedPreferencesProps) {
    super(props)

    this.state = {
      optOutOfUsageTracking: this.props.optOutOfUsageTracking,
      canUseWindowsSSH: false,
      useExternalCredentialHelper: this.props.useExternalCredentialHelper,
      updateSourceURL: getUpdateSourceURL(),
      trustedRepositories: Advanced.readTrusted(),
    }
  }

  private onRevoked = (path: string) => {
    this.props.onRevokeRepositoryTrust(path)
    this.setState({ trustedRepositories: Advanced.readTrusted() })
  }

  private renderTrustedRepositories() {
    const { trustedRepositories } = this.state

    return (
      <div className="advanced-section">
        <h2>Trusted repositories</h2>
        <div
          id="trusted-repositories-description"
          className="settings-description"
        >
          <p>
            A repository that carries its own Git settings or hooks that run
            programs is trusted only after you said so. Revoking makes Lodestone
            ask again.
          </p>
        </div>
        {trustedRepositories.length === 0 ? (
          <p>No repository is trusted.</p>
        ) : (
          <ul
            className="trusted-repositories"
            aria-describedby="trusted-repositories-description"
          >
            {trustedRepositories.map(a => (
              <TrustedRepositoryRow
                key={a.path}
                path={a.path}
                onRevoke={this.onRevoked}
              />
            ))}
          </ul>
        )}
      </div>
    )
  }

  public componentDidMount() {
    this.checkSSHAvailability()
  }

  private async checkSSHAvailability() {
    this.setState({ canUseWindowsSSH: await isWindowsOpenSSHAvailable() })
  }

  private onUpdateSourceChanged = (updateSourceURL: string) => {
    this.setState({ updateSourceURL })
    setUpdateSourceURL(updateSourceURL)
  }

  /**
   * Where to look for new versions of the app.
   *
   * Defaults to this project's own repository. Point it at any other
   * repository that publishes releases to check that instead, or clear the
   * field to stop checking at all - an empty value is stored rather than
   * removed, so "off" survives a restart.
   */
  private renderUpdateSource() {
    const { updateSourceURL } = this.state
    const parsed = parseUpdateSource(updateSourceURL)
    const unusable = updateSourceURL.trim().length > 0 && parsed === null

    return (
      <div className="advanced-section">
        <h2>Updates</h2>
        <TextBox
          label="Repository publishing releases"
          value={updateSourceURL}
          onValueChanged={this.onUpdateSourceChanged}
          placeholder="https://git.example.com/team/lodestone"
        />
        <div className="settings-description">
          {unusable ? (
            <p className="error">
              That doesn't look like a repository address. Expected something
              like https://git.example.com/team/lodestone
            </p>
          ) : (
            <p>
              Lodestone checks this repository for newer releases, and contacts
              nothing else. Clear the field to turn update checks off entirely.
              Releases are downloaded by hand; the app never installs anything
              on its own.
            </p>
          )}
        </div>
      </div>
    )
  }

  private onReportingOptOutChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = !event.currentTarget.checked

    this.setState({ optOutOfUsageTracking: value })
    this.props.onOptOutofReportingChanged(value)
  }

  private onUseExternalCredentialHelperChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = event.currentTarget.checked

    this.setState({ useExternalCredentialHelper: value })
    this.props.onUseExternalCredentialHelperChanged(value)
  }

  private onRepositoryIndicatorsEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onRepositoryIndicatorsEnabledChanged(event.currentTarget.checked)
  }

  private onUseWindowsOpenSSHChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onUseWindowsOpenSSHChanged(event.currentTarget.checked)
  }

  private reportDesktopUsageLabel() {
    return (
      <span>
        Collect usage measures locally. Lodestone never sends them anywhere.
      </span>
    )
  }

  public render() {
    return (
      <DialogContent>
        <div className="advanced-section">
          <h2>Background updates</h2>
          <Checkbox
            label="Show status icons in the repository list"
            value={
              this.props.repositoryIndicatorsEnabled
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onRepositoryIndicatorsEnabledChanged}
            ariaDescribedBy="periodic-fetch-description"
          />
          <div id="periodic-fetch-description" className="settings-description">
            <p>
              These icons indicate which repositories have local or remote
              changes, and require the periodic fetching of repositories that
              are not currently selected.
            </p>
            <p>
              Turning this off will not stop the periodic fetching of your
              currently selected repository, but may improve overall app
              performance for users with many repositories.
            </p>
          </div>
        </div>
        {this.renderUpdateSource()}
        {this.renderTrustedRepositories()}
        <div className="advanced-section">
          <h2>Usage</h2>
          <Checkbox
            label={this.reportDesktopUsageLabel()}
            value={
              this.state.optOutOfUsageTracking
                ? CheckboxValue.Off
                : CheckboxValue.On
            }
            onChange={this.onReportingOptOutChanged}
          />
        </div>
        <h2>Network and credentials</h2>
        {this.renderSSHSettings()}
        <div className="advanced-section">
          <Checkbox
            label={'Use Git Credential Manager'}
            value={
              this.state.useExternalCredentialHelper
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onUseExternalCredentialHelperChanged}
            ariaDescribedBy="use-external-credential-helper-description"
          />
          <div
            id="use-external-credential-helper-description"
            className="settings-description"
          >
            <p>
              Use{' '}
              <LinkButton uri="https://gh.io/gcm">
                Git Credential Manager{' '}
              </LinkButton>{' '}
              for private repositories on hosts you have not signed in to. This
              feature is experimental and subject to change.
            </p>
          </div>
        </div>
      </DialogContent>
    )
  }

  private renderSSHSettings() {
    if (!this.state.canUseWindowsSSH) {
      return null
    }

    return (
      <div className="advanced-section">
        <Checkbox
          label="Use system OpenSSH (recommended)"
          value={
            this.props.useWindowsOpenSSH ? CheckboxValue.On : CheckboxValue.Off
          }
          onChange={this.onUseWindowsOpenSSHChanged}
        />
      </div>
    )
  }
}
