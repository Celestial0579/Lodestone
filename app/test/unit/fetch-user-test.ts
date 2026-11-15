import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { fetchUser } from '../../src/lib/api'

const realFetch = globalThis.fetch
const realWarn = log.warn

/** A request the stand-in forge was sent. */
interface ISeenRequest {
  readonly method: string
  readonly url: string
}

/**
 * Stand in for a forge. `routes` maps a URL to the JSON it answers with;
 * anything else is a 404, as on a forge that does not have the path.
 */
function stubForge(routes: Record<string, unknown>): ISeenRequest[] {
  const seen: ISeenRequest[] = []

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seen.push({ method: init?.method ?? 'GET', url: String(url) })

    return String(url) in routes
      ? new Response(JSON.stringify(routes[String(url)]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response('{"message":"Not Found"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
  }) as typeof fetch

  return seen
}

const urlsOf = (seen: ReadonlyArray<ISeenRequest>) =>
  seen.map(r => r.url).sort()

describe('fetchUser', () => {
  let warnings: string[] = []

  beforeEach(() => {
    warnings = []
    log.warn = (message: string) => {
      warnings.push(message)
    }
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    log.warn = realWarn
    localStorage.clear()
  })

  it('asks an account on Gitea only for what Gitea has', async () => {
    const endpoint = 'https://git.example.com/api/v1'
    const seen = stubForge({
      [`${endpoint}/user`]: {
        id: 7,
        login: 'wt',
        full_name: 'W. T.',
        email: 'wt@example.invalid',
        avatar_url: 'https://git.example.com/avatars/7',
      },
      [`${endpoint}/user/emails`]: [
        { email: 'wt@example.invalid', verified: true, primary: true },
      ],
    })

    const account = await fetchUser(endpoint, 'token')

    assert.equal(account.login, 'wt')
    assert.equal(account.endpoint, endpoint)
    assert.deepEqual(urlsOf(seen), [
      `${endpoint}/user`,
      `${endpoint}/user/emails`,
    ])

    // Copilot and GitHub Desktop's feature flags are GitHub's. Asking for
    // them here went nowhere, and left two warnings in the log at every
    // sign-in and every start, one of them a TypeError.
    assert.deepEqual(warnings, [])
    assert.equal(account.features, undefined)
    assert.equal(account.copilotEndpoint, undefined)
    assert.equal(account.isCopilotDesktopEnabled, undefined)
  })

  it('goes on asking GitHub for both', async () => {
    const endpoint = 'https://api.github.com'
    const seen = stubForge({
      [`${endpoint}/user`]: {
        id: 7,
        login: 'alovelace',
        name: 'Ada Lovelace',
        avatar_url: 'https://avatars.githubusercontent.com/u/7',
      },
      [`${endpoint}/user/emails`]: [
        { email: 'ada@example.invalid', verified: true, primary: true },
      ],
      [`${endpoint}/graphql`]: {
        data: {
          viewer: {
            copilotEndpoints: { api: 'https://api.githubcopilot.com' },
            copilotLicenseType: 'free',
            isCopilotDesktopEnabled: true,
          },
        },
      },
      [`${endpoint}/desktop_internal/features`]: { features: ['a-feature'] },
    })

    const account = await fetchUser(endpoint, 'token')

    assert.deepEqual(urlsOf(seen), [
      `${endpoint}/desktop_internal/features`,
      `${endpoint}/graphql`,
      `${endpoint}/user`,
      `${endpoint}/user/emails`,
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(account.features, ['a-feature'])
    assert.equal(account.copilotEndpoint, 'https://api.githubcopilot.com')
    assert.equal(account.isCopilotDesktopEnabled, true)
  })
})
