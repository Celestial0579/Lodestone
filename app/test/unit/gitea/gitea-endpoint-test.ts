import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getGiteaAPIURL,
  getGiteaHTMLURL,
  isGiteaEndpoint,
} from '../../../src/lib/gitea/gitea-endpoint'

describe('gitea endpoints', () => {
  describe('getGiteaAPIURL', () => {
    it('appends the api path to an instance address', () => {
      assert.equal(
        getGiteaAPIURL('https://git.example.com'),
        'https://git.example.com/api/v1'
      )
    })

    it('ignores a trailing slash', () => {
      assert.equal(
        getGiteaAPIURL('https://git.example.com/'),
        'https://git.example.com/api/v1'
      )
    })

    it('is idempotent', () => {
      const once = getGiteaAPIURL('https://git.example.com')
      assert.equal(getGiteaAPIURL(once), once)
    })

    it('keeps a non-default port', () => {
      assert.equal(
        getGiteaAPIURL('https://git.example.com:3000'),
        'https://git.example.com:3000/api/v1'
      )
    })

    it('supports instances hosted under a sub path', () => {
      assert.equal(
        getGiteaAPIURL('https://example.com/gitea'),
        'https://example.com/gitea/api/v1'
      )
    })
  })

  describe('getGiteaHTMLURL', () => {
    it('is the inverse of getGiteaAPIURL', () => {
      for (const address of [
        'https://git.example.com',
        'https://git.example.com:3000',
        'https://example.com/gitea',
      ]) {
        assert.equal(getGiteaHTMLURL(getGiteaAPIURL(address)), address)
      }
    })

    it('does not end in a slash', () => {
      // Several call sites append a path straight onto the result.
      assert.ok(
        !getGiteaHTMLURL('https://git.example.com/api/v1').endsWith('/')
      )
    })
  })

  describe('isGiteaEndpoint', () => {
    it('recognises an endpoint we built', () => {
      assert.equal(
        isGiteaEndpoint(getGiteaAPIURL('https://git.example.com')),
        true
      )
      assert.equal(
        isGiteaEndpoint(getGiteaAPIURL('https://example.com/gitea')),
        true
      )
    })

    it('rejects GitHub endpoints', () => {
      assert.equal(isGiteaEndpoint('https://api.github.com'), false)
      assert.equal(isGiteaEndpoint('https://github.example.com/api/v3'), false)
    })

    it('rejects nonsense without throwing', () => {
      assert.equal(isGiteaEndpoint('not a url'), false)
      assert.equal(isGiteaEndpoint(''), false)
    })
  })
})
