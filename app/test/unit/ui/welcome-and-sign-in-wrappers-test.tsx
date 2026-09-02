import { ForgeKind } from '../../../src/lib/forges/forge-type'
import { setForgeOAuthClientId } from '../../../src/lib/forges/forge-oauth'
import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Account } from '../../../src/models/account'
import type {
  IAuthenticationState,
  IEndpointEntryState,
  IExistingAccountWarning,
} from '../../../src/lib/stores/sign-in-store'
import { SignInStep } from '../../../src/lib/stores/sign-in-store'
import type { Dispatcher } from '../../../src/ui/dispatcher'
import { ConfigureGit } from '../../../src/ui/welcome/configure-git'
import { SignInInstance } from '../../../src/ui/welcome/sign-in-instance'
import { SignIn } from '../../../src/ui/lib/sign-in'
import { fireEvent, render, screen } from '../../helpers/ui/render'

function noopResultCallback() {}

class TestDispatcher {
  public readonly enteredEndpoints = new Array<string>()
  public browserSignInCount = 0

  public setSignInEndpoint(url: string) {
    this.enteredEndpoints.push(url)
  }

  public requestBrowserAuthentication() {
    this.browserSignInCount++
  }
}

function toDispatcher(dispatcher: TestDispatcher): Dispatcher {
  return dispatcher as unknown as Dispatcher
}

function createEndpointState(): IEndpointEntryState {
  return {
    kind: SignInStep.EndpointEntry,
    error: null,
    loading: false,
    resultCallback: noopResultCallback,
  }
}

function createAuthenticationState(endpoint: string): IAuthenticationState {
  return {
    kind: SignInStep.Authentication,
    endpoint,
    forgeKind: ForgeKind.Gitea,
    htmlURL: 'https://git.example.com',
    error: null,
    loading: false,
    resultCallback: noopResultCallback,
  }
}

function createExistingAccountWarningState(): IExistingAccountWarning {
  return {
    kind: SignInStep.ExistingAccountWarning,
    endpoint: 'https://api.github.com',
    forgeKind: ForgeKind.DotCom,
    htmlURL: 'https://github.com',
    existingAccount: new Account(
      'mona',
      'https://api.github.com',
      'token',
      [],
      '',
      1,
      'Mona Lisa'
    ),
    error: null,
    loading: false,
    resultCallback: noopResultCallback,
  }
}

describe('welcome and sign-in wrappers', () => {
  it('submits enterprise endpoints through the shared sign-in wrapper', () => {
    const dispatcher = new TestDispatcher()

    render(
      <SignIn
        signInState={createEndpointState()}
        dispatcher={toDispatcher(dispatcher)}
      >
        <button type="button">Cancel</button>
      </SignIn>
    )

    const input = screen.getByLabelText('Instance address')
    const continueButton = screen.getByRole('button', { name: 'Continue' })

    fireEvent.change(input, {
      target: { value: 'https://enterprise.example.com' },
    })
    fireEvent.click(continueButton)

    assert.deepEqual(dispatcher.enteredEndpoints, [
      'https://enterprise.example.com',
    ])
    assert.ok(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('renders warning and browser-authentication states in the shared sign-in wrapper', () => {
    const dispatcher = new TestDispatcher()
    const view = render(
      <SignIn
        signInState={createExistingAccountWarningState()}
        dispatcher={toDispatcher(dispatcher)}
      >
        <button type="button">Cancel</button>
      </SignIn>
    )

    assert.ok(screen.getByText("You're already signed in to", { exact: false }))
    // The host is named both in the warning and in the sign-in instructions
    // below it.
    assert.ok(screen.getAllByText('github.com', { exact: false }).length > 0)
    assert.ok(screen.getByText('mona'))

    // No OAuth application is registered for this endpoint, so browser sign-in
    // is not on offer. That is the same answer for every provider.
    assert.equal(
      screen.queryByRole('link', { name: 'Sign in using your browser' }),
      null
    )

    view.rerender(
      <SignIn
        signInState={{
          kind: SignInStep.Success,
          resultCallback: noopResultCallback,
        }}
        dispatcher={toDispatcher(dispatcher)}
      />
    )

    assert.equal(view.container.textContent, '')
  })

  it('offers browser sign-in once an OAuth application is registered', () => {
    const endpoint = 'https://git.example.com/api/v1'
    setForgeOAuthClientId(endpoint, 'a-registered-client-id')

    try {
      const dispatcher = new TestDispatcher()
      render(
        <SignIn
          signInState={createAuthenticationState(endpoint)}
          dispatcher={toDispatcher(dispatcher)}
        />
      )

      const browserLink = screen.getByRole('link', {
        name: 'Sign in using your browser',
      })

      fireEvent.click(browserLink)

      assert.equal(dispatcher.browserSignInCount, 1)
    } finally {
      setForgeOAuthClientId(endpoint, '')
    }
  })

  it('renders the enterprise welcome step only when sign-in state exists and its cancel button returns to start', () => {
    const dispatcher = new TestDispatcher()
    const advancedSteps = new Array<string>()

    function advance(step: string) {
      advancedSteps.push(step)
    }

    const view = render(
      <SignInInstance
        dispatcher={toDispatcher(dispatcher)}
        advance={advance}
        signInState={null}
      />
    )

    assert.equal(view.container.textContent, '')

    view.rerender(
      <SignInInstance
        dispatcher={toDispatcher(dispatcher)}
        advance={advance}
        signInState={createAuthenticationState('https://api.github.com')}
      />
    )

    assert.ok(screen.getByText('Sign in to your instance'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    assert.deepEqual(advancedSteps, ['Start'])
  })

  it('renders the configure-git welcome step and returns to start when cancelled', () => {
    const advancedSteps = new Array<string>()
    let doneCount = 0

    function advance(step: string) {
      advancedSteps.push(step)
    }

    function done() {
      doneCount++
    }

    render(
      <ConfigureGit
        accounts={[]}
        advance={advance}
        done={done}
        globalUserName={undefined}
        globalUserEmail={undefined}
      />
    )

    assert.ok(screen.getByText('Configure Git'))
    assert.ok(
      screen.getByText('This is used to identify the commits you create.', {
        exact: false,
      })
    )
    assert.ok(screen.getByRole('button', { name: 'Finish' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    assert.deepEqual(advancedSteps, ['Start'])
    assert.equal(doneCount, 0)
  })
})
