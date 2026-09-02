import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Form } from './form'
import { Button } from './button'
import { TextBox } from './text-box'
import { LinkButton } from './link-button'
import { Ref } from './ref'
import { getHTMLURL } from '../../lib/api'
import { isGiteaEndpoint } from '../../lib/gitea/gitea-endpoint'
import { formatTokenScopes } from '../../lib/gitea/gitea-token-scopes'

/** Text to let the user know their browser will send them back to Desktop */
export const BrowserRedirectMessage =
  "Your browser will redirect you back to Lodestone once you've signed in. If your browser asks for your permission to launch Lodestone please allow it to."

interface IAuthenticationFormProps {
  /** The API endpoint the user is authenticating against. */
  readonly endpoint: string

  /**
   * A callback which is invoked if the user requests OAuth sign in using
   * their system configured browser.
   */
  readonly onBrowserSignInRequested: () => void

  /**
   * A callback which is invoked when the user submits a personal access token.
   */
  readonly onTokenSignInRequested: (token: string) => void

  /** Whether a sign in attempt is currently in flight. */
  readonly loading?: boolean

  /**
   * An array of additional buttons to render after the "Sign In" button.
   * (Usually, a 'cancel' button)
   */
  readonly additionalButtons?: ReadonlyArray<JSX.Element>
}

interface IAuthenticationFormState {
  readonly token: string
}

/** The authentication component. */
export class AuthenticationForm extends React.Component<
  IAuthenticationFormProps,
  IAuthenticationFormState
> {
  public constructor(props: IAuthenticationFormProps) {
    super(props)
    this.state = { token: '' }
  }

  public render() {
    const usesToken = isGiteaEndpoint(this.props.endpoint)

    return (
      <Form
        className="sign-in-form"
        onSubmit={usesToken ? this.signInWithToken : this.signInWithBrowser}
      >
        {usesToken
          ? this.renderTokenForm()
          : this.renderEndpointRequiresWebFlow()}
      </Form>
    )
  }

  /**
   * Ask for a personal access token. Gitea instances don't share a registered
   * OAuth application the way GitHub.com does, and registering one is a
   * per-instance administrative task, so a token is the way in that works
   * against every instance without any setup.
   */
  private renderTokenForm() {
    const htmlURL = getHTMLURL(this.props.endpoint)
    const tokenSettingsURL = `${htmlURL}/user/settings/applications`

    return (
      <>
        <p>
          Sign in to <Ref>{new URL(htmlURL).host}</Ref> with a personal access
          token.{' '}
          <LinkButton uri={tokenSettingsURL}>
            Generate a token in Gitea
          </LinkButton>{' '}
          and paste it below.
        </p>
        <p className="token-scopes">
          Select these scopes when creating the token:{' '}
          <Ref>{formatTokenScopes()}</Ref>
        </p>
        <TextBox
          label="Personal access token"
          type="password"
          value={this.state.token}
          onValueChanged={this.onTokenChanged}
          autoFocus={true}
        />
        <Button
          type="submit"
          disabled={this.state.token.trim().length === 0 || this.props.loading}
        >
          Sign in
        </Button>
        {this.props.additionalButtons}
      </>
    )
  }

  /**
   * Show a message informing the user they must sign in via the web flow
   * and a button to do so
   */
  private renderEndpointRequiresWebFlow() {
    return (
      <>
        {BrowserRedirectMessage}
        <Button
          type="submit"
          className="button-with-icon"
          onClick={this.signInWithBrowser}
          autoFocus={true}
          role="link"
        >
          Sign in using your browser
          <Octicon symbol={octicons.linkExternal} />
        </Button>
        {this.props.additionalButtons}
      </>
    )
  }

  private onTokenChanged = (token: string) => {
    this.setState({ token })
  }

  private signInWithToken = () => {
    const token = this.state.token.trim()

    if (token.length > 0) {
      this.props.onTokenSignInRequested(token)
    }
  }

  private signInWithBrowser = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    this.props.onBrowserSignInRequested()
  }
}
