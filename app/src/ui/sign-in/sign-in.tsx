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
import { Button } from '../lib/button'
import { Dialog, DialogError, DialogContent, DialogFooter } from '../dialog'

import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Ref } from '../lib/ref'
import { LinkButton } from '../lib/link-button'
import { getHTMLURL } from '../../lib/api'
import {
  OAuthRedirectURI,
  setForgeOAuthClientId,
  supportsForgeOAuth,
} from '../../lib/forges/forge-oauth'
import {
  getForgeDisplayName,
  getForgeFamily,
  getOAuthApplicationSettingsPath,
  getTokenSettingsURL,
} from '../../lib/forges/forge-type'
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

  /** Whether the OAuth application field is showing. */
  readonly configuringOAuth: boolean

  /** What the user has typed into that field so far. */
  readonly clientId: string
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
    Your browser will redirect you back to Lodestone once you've signed in. If
    your browser asks for your permission to launch Lodestone, please allow it.
  </p>
)

export class SignIn extends React.Component<ISignInProps, ISignInState> {
  private readonly dialogRef = React.createRef<Dialog>()

  public constructor(props: ISignInProps) {
    super(props)

    this.state = {
      endpoint: '',
      token: '',
      configuringOAuth: false,
      clientId: '',
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
        if (supportsForgeOAuth(state.endpoint)) {
          this.props.dispatcher.requestBrowserAuthentication()
        } else {
          this.props.dispatcher.signInWithToken(this.state.token)
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
        primaryButtonText = supportsForgeOAuth(state.endpoint)
          ? continueWithBrowserLabel
          : 'Continue'
        break
      case SignInStep.Authentication:
        if (supportsForgeOAuth(state.endpoint)) {
          primaryButtonText = continueWithBrowserLabel
        } else {
          disableSubmit = this.state.token.trim().length === 0
          primaryButtonText = 'Sign in'
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
        {supportsForgeOAuth(state.endpoint) ? browserSignInInfoContent : null}
      </DialogContent>
    )
  }

  private renderEndpointEntryStep(state: IEndpointEntryState) {
    return (
      <DialogContent>
        <Row>
          <TextBox
            label="Instance address"
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

    if (!supportsForgeOAuth(state.endpoint)) {
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
   * Sign in with a personal access token.
   *
   * This is what is offered when no OAuth application is registered for the
   * instance, which is the normal case for a self-hosted forge. It needs no
   * setup on the server and works the same on every provider.
   */
  private renderTokenStep(
    state: IAuthenticationState,
    credentialHelperInfo: JSX.Element | undefined
  ) {
    const htmlURL = state.htmlURL
    const family = getForgeFamily(state.endpoint)
    const tokenSettingsURL = getTokenSettingsURL(htmlURL, family)
    const forgeName = getForgeDisplayName(state.forgeKind)

    return (
      <DialogContent>
        {credentialHelperInfo}
        <p>
          Sign in to <Ref>{new URL(htmlURL).host}</Ref> with a personal access
          token.{' '}
          <LinkButton uri={tokenSettingsURL}>
            Generate a token in {forgeName}
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
        {this.renderOAuthSetup(state)}
      </DialogContent>
    )
  }

  /**
   * The way in to browser sign-in on an instance that has none yet.
   *
   * This matters most where the instance authenticates through an identity
   * provider. A token still works, but creating one means finding the token
   * page behind the very sign-on the user is trying to use. Once an
   * administrator registers an OAuth application and its id is entered here,
   * the dialog offers the browser instead and the user signs in the way their
   * organisation expects, without this app ever seeing a password.
   *
   * The id is not a secret, which is why it can live in the app's own storage
   * and be typed in by whoever is signing in. Proof of identity comes from
   * PKCE, not from anything stored here.
   */
  private renderOAuthSetup(state: IAuthenticationState) {
    if (!this.state.configuringOAuth) {
      return (
        <p className="sign-in-sso-hint">
          <LinkButton onClick={this.onConfigureOAuth}>
            Signing in through single sign-on?
          </LinkButton>
        </p>
      )
    }

    return (
      <div className="sign-in-sso-setup">
        <p>
          Browser sign-in needs an OAuth application registered on{' '}
          <Ref>{new URL(state.htmlURL).host}</Ref>. An administrator creates one
          under <Ref>{getOAuthApplicationSettingsPath(state.endpoint)}</Ref>{' '}
          with the redirect URI <Ref>{OAuthRedirectURI}</Ref>, leaving
          confidential client unticked. Paste the client ID it gives you.
        </p>
        <Row>
          <TextBox
            label="OAuth application client ID"
            value={this.state.clientId}
            onValueChanged={this.onClientIdChanged}
            autoFocus={true}
          />
        </Row>
        <Row>
          <Button onClick={this.onSaveClientId} type="button">
            Use browser sign-in
          </Button>
        </Row>
      </div>
    )
  }

  private onConfigureOAuth = () => {
    this.setState({ configuringOAuth: true })
  }

  private onClientIdChanged = (clientId: string) => {
    this.setState({ clientId })
  }

  private onSaveClientId = () => {
    const state = this.props.signInState

    if (state?.kind !== SignInStep.Authentication) {
      return
    }

    setForgeOAuthClientId(state.endpoint, this.state.clientId)

    // supportsForgeOAuth now answers differently, so re-rendering is enough to
    // turn the dialog into the browser flow.
    this.setState({ configuringOAuth: false })
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
        ? supportsForgeOAuth(state.endpoint)
          ? SignInWithBrowserTitle
          : SignInWithTokenTitle
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
