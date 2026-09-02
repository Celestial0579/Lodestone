import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import {
  canRefresh,
  clearRefreshMaterial,
  forgetRefreshMaterial,
  getRefreshMaterial,
  refreshAccessToken,
  rememberRefreshMaterial,
  setTokenRefreshedCallback,
} from '../../../src/lib/forges/forge-token-refresh'
import { setForgeOAuthClientId } from '../../../src/lib/forges/forge-oauth'

const endpoint = 'https://git.example.com/api/v1'
const htmlURL = 'https://git.example.com'

const material = {
  endpoint,
  htmlURL,
  refreshToken: 'the-refresh-token',
}

const realFetch = globalThis.fetch

/** Stand in for the forge's token endpoint, recording what it was sent. */
function stubTokenEndpoint(
  reply: { ok: boolean; status?: number; body?: any },
  seen: Array<{ url: string; body: any }> = []
) {
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) })
    return {
      ok: reply.ok,
      status: reply.status ?? (reply.ok ? 200 : 400),
      json: async () => reply.body,
    }
  }) as any
  return seen
}

describe('forge token refresh', () => {
  beforeEach(() => {
    clearRefreshMaterial()
    setTokenRefreshedCallback(async () => {})
    setForgeOAuthClientId(endpoint, 'a-client-id')
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    setForgeOAuthClientId(endpoint, '')
    clearRefreshMaterial()
  })

  it('knows nothing about a token nobody registered', () => {
    assert.equal(canRefresh('some-token'), false)
    assert.equal(canRefresh(null), false)
  })

  it('remembers material against the access token it belongs to', () => {
    rememberRefreshMaterial('access-1', material)

    assert.equal(canRefresh('access-1'), true)
    assert.deepEqual(getRefreshMaterial('access-1'), material)
    assert.equal(canRefresh('access-2'), false)
  })

  it('ignores an empty refresh token, which is what a token sign-in has', () => {
    rememberRefreshMaterial('access-1', { ...material, refreshToken: '' })

    assert.equal(canRefresh('access-1'), false)
  })

  it('spends the refresh token and moves the material to the new one', async () => {
    const seen = stubTokenEndpoint({
      ok: true,
      body: { access_token: 'access-2', refresh_token: 'refresh-2' },
    })
    rememberRefreshMaterial('access-1', material)

    const next = await refreshAccessToken('access-1')

    assert.equal(next, 'access-2')
    assert.equal(seen.length, 1)
    assert.equal(
      seen[0].url,
      'https://git.example.com/login/oauth/access_token'
    )
    assert.equal(seen[0].body.grant_type, 'refresh_token')
    assert.equal(seen[0].body.refresh_token, 'the-refresh-token')
    assert.equal(seen[0].body.client_id, 'a-client-id')
    // No secret is ever sent: this is a public client.
    assert.equal(seen[0].body.client_secret, undefined)

    // The old token is no longer refreshable; the new one is, with the
    // rotated refresh token.
    assert.equal(canRefresh('access-1'), false)
    assert.equal(getRefreshMaterial('access-2')?.refreshToken, 'refresh-2')
  })

  it('keeps the old refresh token when the server does not rotate it', async () => {
    stubTokenEndpoint({ ok: true, body: { access_token: 'access-2' } })
    rememberRefreshMaterial('access-1', material)

    await refreshAccessToken('access-1')

    assert.equal(
      getRefreshMaterial('access-2')?.refreshToken,
      'the-refresh-token'
    )
  })

  it('hands the renewed token to whoever persists it', async () => {
    stubTokenEndpoint({
      ok: true,
      body: { access_token: 'access-2', refresh_token: 'refresh-2' },
    })

    const persisted: Array<[string, string, string]> = []
    setTokenRefreshedCallback(async (previous, next, m) => {
      persisted.push([previous, next, m.refreshToken])
    })

    rememberRefreshMaterial('access-1', material)
    await refreshAccessToken('access-1')

    assert.deepEqual(persisted, [['access-1', 'access-2', 'refresh-2']])
  })

  it('still returns the token when persisting it throws', async () => {
    stubTokenEndpoint({ ok: true, body: { access_token: 'access-2' } })
    setTokenRefreshedCallback(async () => {
      throw new Error('keychain locked')
    })
    rememberRefreshMaterial('access-1', material)

    assert.equal(await refreshAccessToken('access-1'), 'access-2')
  })

  it('gives up for good when the grant is refused', async () => {
    stubTokenEndpoint({ ok: false, status: 400 })
    rememberRefreshMaterial('access-1', material)

    assert.equal(await refreshAccessToken('access-1'), null)
    // A refused refresh token does not become valid again.
    assert.equal(canRefresh('access-1'), false)
  })

  it('survives an unreachable instance without throwing', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline')
    }) as any
    rememberRefreshMaterial('access-1', material)

    assert.equal(await refreshAccessToken('access-1'), null)
    // Unlike a refusal, being offline is not evidence the grant is gone.
    assert.equal(canRefresh('access-1'), true)
  })

  it('gives up when the application has been deregistered', async () => {
    setForgeOAuthClientId(endpoint, '')
    rememberRefreshMaterial('access-1', material)

    assert.equal(await refreshAccessToken('access-1'), null)
  })

  it('makes one request when several callers ask at once', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-2' }),
      }
    }) as any
    rememberRefreshMaterial('access-1', material)

    const results = await Promise.all([
      refreshAccessToken('access-1'),
      refreshAccessToken('access-1'),
      refreshAccessToken('access-1'),
    ])

    assert.deepEqual(results, ['access-2', 'access-2', 'access-2'])
    assert.equal(calls, 1)
  })

  it('forgets everything on sign-out', () => {
    rememberRefreshMaterial('access-1', material)
    forgetRefreshMaterial('access-1')

    assert.equal(canRefresh('access-1'), false)
  })
})
