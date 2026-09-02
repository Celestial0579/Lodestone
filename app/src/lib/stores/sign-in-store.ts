import { Disposable } from 'event-kit'
import { Account, isDotComAccount } from '../../models/account'
import { fatalError } from '../fatal-error'
import {
  validateURL,
  InvalidURLErrorName,
  InvalidProtocolErrorName,
} from '../../ui/lib/enterprise-validate-url'

import {
  fetchUser,
  getHTMLURL,
  getDotComAPIEndpoint,
  requestOAuthToken,
  getOAuthAuthorizationURL,
} from '../../lib/api'
import { IResolvedInstance, resolveInstance } from '../forges/detect-forge'
import { ForgeKind } from '../forges/forge-type'
import { recordApiEndpointForOrigin } from '../forges/forge-registry'

import { TypedBaseStore } from './base-store'
import { IOAuthAction } from '../parse-app-url'
import { shell } from '../app-shell'
import noop from 'lodash/noop'
import { AccountsStore } from './accounts-store'

/**
 * An enumeration of the possible steps that the sign in
 * store can be in save for the uninitialized state (null).
 */
export enum SignInStep {
  EndpointEntry = 'EndpointEntry',
  ExistingAccountWarning = 'ExistingAccountWarning',
  Authentication = 'Authentication',
  TwoFactorAuthentication = 'TwoFactorAuthentication',
  Success = 'Success',
}

/**
 * The union type of all possible states that the sign in
 * store can be in save the uninitialized state (null).
 */
export type SignInState =
  | IEndpointEntryState
  | IExistingAccountWarning
  | IAuthenticationState
  | ISuccessState

/**
 * Base interface for shared properties between states
 */
export interface ISignInState {
  /**
   * The sign in step represented by this state
   */
  readonly kind: SignInStep

  /**
   * An error which, if present, should be presented to the
   * user in close proximity to the actions or input fields
   * related to the current step.
   */
  readonly error: Error | null

  /**
   * A value indicating whether or not the sign in store is
   * busy processing a request. While this value is true all
   * form inputs and actions save for a cancel action should
   * be disabled and the user should be made aware that the
   * sign in process is ongoing.
   */
  readonly loading: boolean

  readonly resultCallback: (result: SignInResult) => void
}

/**
 * State interface representing the endpoint entry step.
 * This is the initial step in the Enterprise sign in
 * flow and is not present when signing in to GitHub.com
 */
export interface IExistingAccountWarning extends ISignInState {
  readonly kind: SignInStep.ExistingAccountWarning

  readonly existingAccount: Account

  /** The API endpoint we are authenticating against. */
  readonly endpoint: string

  /** Which product runs there, so the UI can name it accurately. */
  readonly forgeKind: ForgeKind

  /** The web address of the instance, for links and browser sign-in. */
  readonly htmlURL: string

  readonly resultCallback: (result: SignInResult) => void
}

/**
 * State interface representing the endpoint entry step.
 * This is the initial step in the Enterprise sign in
 * flow and is not present when signing in to GitHub.com
 */
export interface IEndpointEntryState extends ISignInState {
  readonly kind: SignInStep.EndpointEntry
  readonly resultCallback: (result: SignInResult) => void
}

/**
 * The step where the user proves who they are, once the instance behind the
 * address is known. Which methods are on offer depends on that instance: a
 * personal access token works everywhere, browser sign-in wherever an OAuth
 * application has been registered.
 */
export interface IAuthenticationState extends ISignInState {
  readonly kind: SignInStep.Authentication

  /** The API endpoint we are authenticating against. */
  readonly endpoint: string

  /** Which product runs there, so the UI can name it accurately. */
  readonly forgeKind: ForgeKind

  /** The web address of the instance, for links and browser sign-in. */
  readonly htmlURL: string

  readonly resultCallback: (result: SignInResult) => void

  readonly oauthState?: {
    state: string
    endpoint: string
    onAuthCompleted: (account: Account) => void
    onAuthError: (error: Error) => void
  }
}

/**
 * Sentinel step representing a successful sign in process. Sign in
 * components may use this as a signal to dismiss the ongoing flow
 * or to show a message to the user indicating that they've been
 * successfully signed in.
 */
export interface ISuccessState {
  readonly kind: SignInStep.Success
  readonly resultCallback: (result: SignInResult) => void
}

interface IAuthenticationEvent {
  readonly account: Account
}

export type SignInResult =
  | { kind: 'success'; account: Account }
  | { kind: 'cancelled' }

/**
 * A store encapsulating all logic related to signing in a user
 * to GitHub.com, or a GitHub Enterprise instance.
 */
export class SignInStore extends TypedBaseStore<SignInState | null> {
  private state: SignInState | null = null

  private accounts: ReadonlyArray<Account> = []

  /**
   * @param resolve How an address is turned into a known instance. Injectable
   *                so that tests can describe an instance without a network.
   */
  public constructor(
    private readonly accountStore: AccountsStore,
    private readonly resolve: (
      address: string
    ) => Promise<IResolvedInstance | null> = resolveInstance
  ) {
    super()

    this.accountStore.getAll().then(accounts => {
      this.accounts = accounts
    })
    this.accountStore.onDidUpdate(accounts => {
      this.accounts = accounts
    })
  }

  private emitAuthenticate(account: Account) {
    const event: IAuthenticationEvent = { account }
    this.emitter.emit('did-authenticate', event)
    this.state?.resultCallback({ kind: 'success', account })
  }

  /**
   * Registers an event handler which will be invoked whenever
   * a user has successfully completed a sign-in process.
   */
  public onDidAuthenticate(fn: (account: Account) => void): Disposable {
    return this.emitter.on(
      'did-authenticate',
      ({ account }: IAuthenticationEvent) => {
        fn(account)
      }
    )
  }

  /**
   * Returns the current state of the sign in store or null if
   * no sign in process is in flight.
   */
  public getState(): SignInState | null {
    return this.state
  }

  /**
   * Update the internal state of the store and emit an update
   * event.
   */
  private setState(state: SignInState | null) {
    this.state = state
    this.emitUpdate(this.getState())
  }

  /**
   * Clear any in-flight sign in state and return to the
   * initial (no sign-in) state.
   */
  public reset() {
    const currentState = this.state
    this.state?.resultCallback({ kind: 'cancelled' })
    this.setState(null)

    if (currentState?.kind === SignInStep.Authentication) {
      currentState.oauthState?.onAuthError(new Error('cancelled'))
    }
  }

  /**
   * Initiate a sign in flow for github.com. This will put the store
   * in the Authentication step ready to receive user credentials.
   */
  public beginDotComSignIn(resultCallback?: (result: SignInResult) => void) {
    const endpoint = getDotComAPIEndpoint()

    if (this.state !== null) {
      this.reset()
    }

    const existingAccount = this.accounts.find(isDotComAccount)

    if (existingAccount) {
      this.setState({
        kind: SignInStep.ExistingAccountWarning,
        endpoint,
        forgeKind: ForgeKind.DotCom,
        htmlURL: getHTMLURL(endpoint),
        existingAccount,
        error: null,
        loading: false,
        resultCallback: resultCallback ?? noop,
      })
    } else {
      this.setState({
        kind: SignInStep.Authentication,
        endpoint,
        forgeKind: ForgeKind.DotCom,
        htmlURL: getHTMLURL(endpoint),
        error: null,
        loading: false,
        resultCallback: resultCallback ?? noop,
      })
    }
  }

  /**
   * Initiate an OAuth sign in using the system configured browser.
   * This method must only be called when the store is in the authentication
   * step or an error will be thrown.
   */
  public async authenticateWithBrowser() {
    const currentState = this.state

    if (
      currentState?.kind !== SignInStep.Authentication &&
      currentState?.kind !== SignInStep.ExistingAccountWarning
    ) {
      const stepText = currentState ? currentState.kind : 'null'
      return fatalError(
        `Sign in step '${stepText}' not compatible with browser authentication`
      )
    }

    this.setState({ ...currentState, loading: true })

    if (currentState.kind === SignInStep.ExistingAccountWarning) {
      const { existingAccount } = currentState
      // Try to avoid emitting an error out of AccountsStore if the account
      // is already gone.
      if (this.accounts.find(x => x.endpoint === existingAccount.endpoint)) {
        await this.accountStore.removeAccount(existingAccount)
      }
    }

    const csrfToken = crypto.randomUUID()

    new Promise<Account>((resolve, reject) => {
      const { endpoint, forgeKind, htmlURL, resultCallback } = currentState
      log.info('[SignInStore] initializing OAuth flow')
      this.setState({
        kind: SignInStep.Authentication,
        endpoint,
        forgeKind,
        htmlURL,
        resultCallback,
        error: null,
        loading: true,
        oauthState: {
          state: csrfToken,
          endpoint,
          onAuthCompleted: resolve,
          onAuthError: reject,
        },
      })
      shell.openExternal(getOAuthAuthorizationURL(endpoint, csrfToken))
    })
      .then(account => {
        if (!this.state || this.state.kind !== SignInStep.Authentication) {
          // Looks like the sign in flow has been aborted
          log.warn('[SignInStore] account resolved but session has changed')
          return
        }

        log.info('[SignInStore] account resolved')
        this.emitAuthenticate(account)
        this.setState({
          kind: SignInStep.Success,
          resultCallback: this.state.resultCallback,
        })
      })
      .catch(e => {
        // Make sure we're still in the same sign in session
        if (
          this.state?.kind === SignInStep.Authentication &&
          this.state.oauthState?.state === csrfToken
        ) {
          log.info('[SignInStore] error with OAuth flow', e)
          this.setState({ ...this.state, error: e, loading: false })
        } else {
          log.info(`[SignInStore] OAuth error but session has changed: ${e}`)
        }
      })
  }

  /**
   * Complete the sign in process using a personal access token.
   *
   * This is the one method every forge supports without any setup, so it is
   * always offered. Browser sign-in is offered alongside it where an OAuth
   * application has been registered for the instance.
   *
   * This method must only be called while the store is in the authentication
   * step or an error will be thrown.
   */
  public async authenticateWithToken(token: string): Promise<void> {
    const currentState = this.state

    if (currentState?.kind !== SignInStep.Authentication) {
      const stepText = currentState ? currentState.kind : 'null'
      return fatalError(
        `Sign in step '${stepText}' not compatible with token authentication`
      )
    }

    const { endpoint, resultCallback } = currentState
    this.setState({ ...currentState, error: null, loading: true })

    let account: Account

    try {
      account = await fetchUser(endpoint, token)
    } catch (e) {
      // Make sure the user hasn't cancelled or restarted the flow in the
      // meantime, otherwise we'd be reporting an error for a session that is
      // no longer on screen.
      if (this.state?.kind === SignInStep.Authentication) {
        this.setState({
          ...this.state,
          loading: false,
          error: toTokenSignInError(e),
        })
      }
      return
    }

    if (this.state?.kind !== SignInStep.Authentication) {
      log.warn('[SignInStore] account resolved but session has changed')
      return
    }

    log.info('[SignInStore] signed in with a personal access token')
    this.emitAuthenticate(account)
    this.setState({ kind: SignInStep.Success, resultCallback })
  }

  public async resolveOAuthRequest(action: IOAuthAction) {
    if (!this.state || this.state.kind !== SignInStep.Authentication) {
      return
    }

    if (!this.state.oauthState) {
      return
    }

    if (this.state.oauthState.state !== action.state) {
      log.warn(
        'requestAuthenticatedUser was not called with valid OAuth state. This is likely due to a browser reloading the callback URL. Contact GitHub Support if you believe this is an error'
      )
      return
    }

    const { endpoint } = this.state
    const token = await requestOAuthToken(endpoint, action.code)

    if (token) {
      const account = await fetchUser(endpoint, token)
      this.state.oauthState.onAuthCompleted(account)
    } else {
      this.state.oauthState.onAuthError(
        new Error('Failed retrieving authenticated user')
      )
    }
  }

  /**
   * Start signing in. The store moves to the EndpointEntry step, ready for the
   * address of whichever instance the user wants to connect to.
   */
  public beginSignIn(resultCallback?: (result: SignInResult) => void) {
    if (this.state !== null) {
      this.reset()
    }

    this.setState({
      kind: SignInStep.EndpointEntry,
      error: null,
      loading: false,
      resultCallback: resultCallback ?? noop,
    })
  }

  /**
   * Attempt to advance from the EndpointEntry step with the given endpoint
   * url. This method must only be called when the store is in the authentication
   * step or an error will be thrown.
   *
   * The provided endpoint url will be validated for syntactic correctness as
   * well as connectivity before the promise resolves. If the endpoint url is
   * invalid or the host can't be reached the promise will be rejected and the
   * sign in state updated with an error to be presented to the user.
   *
   * If validation is successful the store will advance to the authentication
   * step.
   */
  public async setEndpoint(url: string): Promise<void> {
    const currentState = this.state

    if (
      currentState?.kind !== SignInStep.EndpointEntry &&
      currentState?.kind !== SignInStep.ExistingAccountWarning
    ) {
      const stepText = currentState ? currentState.kind : 'null'
      return fatalError(
        `Sign in step '${stepText}' not compatible with endpoint entry`
      )
    }

    this.setState({ ...currentState, loading: true })

    let validUrl: string
    try {
      validUrl = validateURL(url)
    } catch (e) {
      let error = e
      if (e.name === InvalidURLErrorName) {
        error = new Error(
          `That address doesn't look like a URL. We're expecting something like https://git.example.com.`
        )
      } else if (e.name === InvalidProtocolErrorName) {
        error = new Error(
          'Unsupported protocol. Only https is supported, except on localhost.'
        )
      }

      this.setState({ ...currentState, loading: false, error })
      return
    }

    // No forge is assumed. The address is probed to find out what runs there
    // and where its API lives, so Gitea, Forgejo, GitHub Enterprise and
    // github.com all arrive here the same way.
    const instance = await this.resolve(validUrl)

    if (instance === null) {
      this.setState({
        ...currentState,
        loading: false,
        error: new Error(
          `Couldn't find a Gitea, Forgejo or GitHub API at that address. Check the URL, and that the instance is reachable from this machine.`
        ),
      })
      return
    }

    const endpoint = instance.endpoint

    // Git asks the credential helper about the web origin, not the API path,
    // so remember which belongs to which.
    recordApiEndpointForOrigin(instance.htmlURL, endpoint)

    const existingAccount = this.accounts.find(x => x.endpoint === endpoint)

    if (existingAccount) {
      this.setState({
        kind: SignInStep.ExistingAccountWarning,
        endpoint,
        forgeKind: instance.kind,
        htmlURL: instance.htmlURL,
        existingAccount,
        error: null,
        loading: false,
        resultCallback: currentState.resultCallback,
      })
    } else {
      this.setState({
        kind: SignInStep.Authentication,
        endpoint,
        forgeKind: instance.kind,
        htmlURL: instance.htmlURL,
        error: null,
        loading: false,
        resultCallback: currentState.resultCallback,
      })
    }
  }
}

/**
 * Turn whatever went wrong while exchanging a token for an account into
 * something we can put in front of the user.
 */
function toTokenSignInError(error: any): Error {
  const status: number | undefined = error?.responseStatus

  if (status === 401 || status === 403) {
    return new Error(
      'That token was rejected. Check that it was copied in full and that it has not expired or been revoked.'
    )
  }

  if (status === 404) {
    return new Error(
      "Couldn't find an API at that address. Check the instance URL and try again."
    )
  }

  return error instanceof Error
    ? error
    : new Error('Failed to sign in with the provided token.')
}
