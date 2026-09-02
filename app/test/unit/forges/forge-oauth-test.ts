import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import * as crypto from 'crypto'
import {
  OAuthRedirectURI,
  OAuthScopes,
  createPkcePair,
  getForgeAuthorizationURL,
  getForgeOAuthClientId,
  getForgeTokenRequestBody,
  setForgeOAuthClientId,
  supportsForgeOAuth,
} from '../../../src/lib/forges/forge-oauth'

const endpoint = 'https://git.example.com/api/v1'
const htmlURL = 'https://git.example.com'

describe('forge oauth', () => {
  beforeEach(() => {
    setForgeOAuthClientId(endpoint, '')
  })

  describe('client id storage', () => {
    it('has nothing registered until someone registers something', () => {
      assert.equal(getForgeOAuthClientId(endpoint), null)
      assert.equal(supportsForgeOAuth(endpoint), false)
    })

    it('remembers an id per instance', () => {
      setForgeOAuthClientId(endpoint, 'abc-123')

      assert.equal(getForgeOAuthClientId(endpoint), 'abc-123')
      assert.equal(supportsForgeOAuth(endpoint), true)
      // A different instance is unaffected.
      assert.equal(
        getForgeOAuthClientId('https://other.example.com/api/v1'),
        null
      )
    })

    it('trims what was pasted', () => {
      setForgeOAuthClientId(endpoint, '  abc-123\n')
      assert.equal(getForgeOAuthClientId(endpoint), 'abc-123')
    })

    it('forgets on an empty value', () => {
      setForgeOAuthClientId(endpoint, 'abc-123')
      setForgeOAuthClientId(endpoint, '')

      assert.equal(getForgeOAuthClientId(endpoint), null)
    })
  })

  describe('createPkcePair', () => {
    it('produces a verifier the specification accepts', () => {
      const { verifier } = createPkcePair()

      // RFC 7636 section 4.1: 43 to 128 characters from the unreserved set.
      assert.ok(verifier.length >= 43 && verifier.length <= 128)
      assert.match(verifier, /^[A-Za-z0-9\-._~]+$/)
    })

    it('derives the challenge as the S256 hash of the verifier', () => {
      const { verifier, challenge } = createPkcePair()

      const expected = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

      assert.equal(challenge, expected)
    })

    it('is different every time', () => {
      assert.notEqual(createPkcePair().verifier, createPkcePair().verifier)
    })
  })

  describe('getForgeAuthorizationURL', () => {
    it('declines when no application is registered', () => {
      assert.equal(
        getForgeAuthorizationURL(htmlURL, endpoint, 'state', 'challenge'),
        null
      )
    })

    it('asks for a code, with the challenge and no secret', () => {
      setForgeOAuthClientId(endpoint, 'abc-123')

      const url = new URL(
        getForgeAuthorizationURL(
          htmlURL,
          endpoint,
          'csrf-state',
          'a-challenge'
        )!
      )

      assert.equal(
        url.origin + url.pathname,
        'https://git.example.com/login/oauth/authorize'
      )
      assert.equal(url.searchParams.get('client_id'), 'abc-123')
      assert.equal(url.searchParams.get('response_type'), 'code')
      assert.equal(url.searchParams.get('redirect_uri'), OAuthRedirectURI)
      assert.equal(url.searchParams.get('state'), 'csrf-state')
      assert.equal(url.searchParams.get('code_challenge'), 'a-challenge')
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      assert.equal(url.searchParams.get('scope'), OAuthScopes.join(' '))
      assert.equal(url.searchParams.get('client_secret'), null)
    })

    it('keeps the sub path of an instance that lives under one', () => {
      const subPathEndpoint = 'https://example.com/gitea/api/v1'
      setForgeOAuthClientId(subPathEndpoint, 'abc-123')

      const url = getForgeAuthorizationURL(
        'https://example.com/gitea',
        subPathEndpoint,
        'state',
        'challenge'
      )

      assert.ok(url !== null)
      assert.ok(
        url!.startsWith('https://example.com/gitea/login/oauth/authorize')
      )

      setForgeOAuthClientId(subPathEndpoint, '')
    })
  })

  describe('getForgeTokenRequestBody', () => {
    it('declines when no application is registered', () => {
      assert.equal(
        getForgeTokenRequestBody(endpoint, 'the-code', 'the-verifier'),
        null
      )
    })

    it('proves itself with the verifier rather than a secret', () => {
      setForgeOAuthClientId(endpoint, 'abc-123')

      const body = getForgeTokenRequestBody(
        endpoint,
        'the-code',
        'the-verifier'
      )

      assert.deepEqual(body, {
        client_id: 'abc-123',
        code: 'the-code',
        grant_type: 'authorization_code',
        redirect_uri: OAuthRedirectURI,
        code_verifier: 'the-verifier',
      })
      assert.equal((body as any).client_secret, undefined)
    })
  })
})
