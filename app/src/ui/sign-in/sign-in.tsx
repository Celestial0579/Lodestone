import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import {
  SignInState,
  SignInStep,
  IEndpointEntryState,
  IAuthenticationState,
  IExistingAccountWarning,
} from '../../lib/stores'
import { assertNever } from '../../lib/fatal-error'
import { Row } from '../lib/row'
import { TextBox } from '../lib/text-box'
import { Dialog, DialogError, DialogContent, DialogFooter } from '../dialog'

import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Ref } from '../lib/ref'
import { LinkButton } from '../lib/link-button'
import { getHTMLURL } from '../../lib/api'
import { isGiteaEndpoint } from '../../lib/gitea/gitea-endpoint'
import { formatTokenScopes } from '../../lib/gitea/gitea-token-scopes'

interface ISignInProps {
  readonly dispatcher: Dispatcher
  readonly signInState: SignInState | null
  readonly onDismissed: () => void
  readonly isCredentialHelperSignIn?: boolean
  readonly credentialHelperUrl?: string
}

interface ISignInState {
  readonly endpoint: string
  readonly token: string
}

const SignInWithBrowserTitle = __DARWIN__
  ? 'Sign in Using Your Browser'
  : 'Sign in using your browser'

const SignInWithTokenTitle = __DARWIN__
  ? 'Sign in With a Token'
  : 'Sign in with a token'

const DefaultTitle = 'Sign in'

const browserSignInInfoContent = (
  <p>
    Your browser will redirect you back to Gitea Desktop once you've signed in.
    If your browser asks for your permission to launch Gitea Desktop, please
    allow it.
  </p>
)

export class SignIn extends React.Component<ISignInProps, ISignInState> {
  private readonly dialogRef = React.createRef<Dialog>()

  public constructor(props: ISignInProps) {
    super(props)

    this.state = {
      endpoint: '',
      token: '',
    }
  }

  public componentDidUpdate(prevProps: ISignInProps) {
    // Whenever the sign in step changes we replace the dialog contents which
    // means we need to re-focus the first suitable child element as it's
    // essentially a "new" dialog we're showing only the dialog component itself
    // doesn't know that.
    if (prevProps.signInState !== null && this.props.signInState !== null) {
      if (prevProps.signInState.kind !== this.props.signInState.kind) {
        this.dialogRef.current?.focusFirstSuitableChild()
      }
    }
  }

  public componentWillReceiveProps(nextProps: ISignInProps) {
    if (nextProps.signInState !== this.props.signInState) {
      if (
        nextProps.signInState &&
        nextProps.signInState.kind === SignInStep.Success
      ) {
        this.onDismissed()
      }
    }
  }

  private onSubmit = () => {
    const state = this.props.signInState

    if (!state) {
      return
    }

    const stepKind = state.kind

    switch (state.kind) {
      case SignInStep.EndpointEntry:
        this.props.dispatcher.setSignInEndpoint(this.state.endpoint)
        break
      case SignInStep.ExistingAccountWarning:
        this.props.dispatcher
          .removeAccount(state.existingAccount)
          .then(() => this.props.dispatcher.setSignInEndpoint(state.endpoint))
        break
      case SignInStep.Authentication:
        if (isGiteaEndpoint(state.endpoint)) {
          this.props.dispatcher.signInWithToken(this.state.token)
        } else {
          this.props.dispatcher.requestBrowserAuthentication()
        }
        break
      case SignInStep.Success:
        this.onDismissed()
        break
      default:
        assertNever(state, `Unknown sign in step ${stepKind}`)
    }
  }

  private onEndpointChanged = (endpoint: string) => {
    this.setState({ endpoint })
  }

  private onTokenChanged = (token: string) => {
    this.setState({ token })
  }

  private renderFooter(): JSX.Element | null {
    const state = this.props.signInState

    if (!state || state.kind === SignInStep.Success) {
      return null
    }

    let disableSubmit = false

    let primaryButtonText: string
    const stepKind = state.kind
    const continueWithBrowserLabel = __DARWIN__
      ? 'Continue With Browser'
      : 'Continue with browser'

    switch (state.kind) {
      case SignInStep.EndpointEntry:
        disableSubmit = this.state.endpoint.length === 0
        primaryButtonText = 'Continue'
        break
      case SignInStep.ExistingAccountWarning:
        primaryButtonText = isGiteaEndpoint(state.endpoint)
          ? 'Continue'
          : continueWithBrowserLabel
        break
      case SignInStep.Authentication:
        if (isGiteaEndpoint(state.endpoint)) {
          disableSubmit = this.state.token.trim().length === 0
          primaryButtonText = 'Sign in'
        } else {
          primaryButtonText = continueWithBrowserLabel
        }
        break
      default:
        return assertNever(state, `Unknown sign in step ${stepKind}`)
    }

    return (
      <DialogFooter>
        <OkCancelButtonGroup
          okButtonText={primaryButtonText}
          okButtonDisabled={disableSubmit || state.loading}
          cancelButtonDisabled={false}
          onCancelButtonClick={this.onDismissed}
        />
      </DialogFooter>
    )
  }

  private renderExistingAccountWarningStep(state: IExistingAccountWarning) {
    return (
      <DialogContent>
        <p className="existing-account-warning">
          You're already signed in to{' '}
          <Ref>{new URL(getHTMLURL(state.endpoint)).host}</Ref> with the account{' '}
          <Ref>{state.existingAccount.login}</Ref>. If you continue, you will
          first be signed out.
        </p>
        {isGiteaEndpoint(state.endpoint) ? null : browserSignInInfoContent}
      </DialogContent>
    )
  }

  private renderEndpointEntryStep(state: IEndpointEntryState) {
    return (
      <DialogContent>
        <Row>
          <TextBox
            label="Gitea instance address"
            value={this.state.endpoint}
            onValueChanged={this.onEndpointChanged}
            placeholder="https://git.example.com"
          />
        </Row>
      </DialogContent>
    )
  }

  private renderAuthenticationStep(state: IAuthenticationState) {
    const credentialHelperInfo =
      this.props.isCredentialHelperSignIn && this.props.credentialHelperUrl ? (
        <p>
          Git requesting credentials to access{' '}
          <Ref>{this.props.credentialHelperUrl}</Ref>.
        </p>
      ) : undefined

    if (isGiteaEndpoint(state.endpoint)) {
      return this.renderTokenStep(state, credentialHelperInfo)
    }

    return (
      <DialogContent>
        {credentialHelperInfo}
        {browserSignInInfoContent}
      </DialogContent>
    )
  }

  /**
   * The Gitea flavour of the authentication step. Gitea instances don't share
   * a registered OAuth application the way Gitea does, so we ask for a
   * personal access token instead, which works against any instance.
   */
  private renderTokenStep(
    state: IAuthenticationState,
    credentialHelperInfo: JSX.Element | undefined
  ) {
    const htmlURL = getHTMLURL(state.endpoint)
    const tokenSettingsURL = `${htmlURL}/user/settings/applications`

    return (
      <DialogContent>
        {credentialHelperInfo}
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
        <Row>
          <TextBox
            label="Personal access token"
            type="password"
            value={this.state.token}
            onValueChanged={this.onTokenChanged}
            autoFocus={true}
          />
        </Row>
      </DialogContent>
    )
  }

  private renderStep(): JSX.Element | null {
    const state = this.props.signInState

    if (!state) {
      return null
    }

    const stepKind = state.kind

    switch (state.kind) {
      case SignInStep.EndpointEntry:
        return this.renderEndpointEntryStep(state)
      case SignInStep.ExistingAccountWarning:
        return this.renderExistingAccountWarningStep(state)
      case SignInStep.Authentication:
        return this.renderAuthenticationStep(state)
      case SignInStep.Success:
        return null
      default:
        return assertNever(state, `Unknown sign in step ${stepKind}`)
    }
  }

  public render() {
    const state = this.props.signInState

    if (!state || state.kind === SignInStep.Success) {
      return null
    }

    const errors = state.error ? (
      <DialogError>{state.error.message}</DialogError>
    ) : null

    const title =
      state.kind === SignInStep.Authentication
        ? isGiteaEndpoint(state.endpoint)
          ? SignInWithTokenTitle
          : SignInWithBrowserTitle
        : DefaultTitle

    return (
      <Dialog
        id="sign-in"
        title={title}
        disabled={false}
        onDismissed={this.onDismissed}
        onSubmit={this.onSubmit}
        loading={state.loading}
        ref={this.dialogRef}
      >
        {errors}
        {this.renderStep()}
        {this.renderFooter()}
      </Dialog>
    )
  }

  private onDismissed = () => {
    this.props.dispatcher.resetSignInState()
    this.props.onDismissed()
  }
}
