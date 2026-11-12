import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { detectForge } from '../../../src/lib/forges/detect-forge'
import { getKnownForge } from '../../../src/lib/forges/forge-registry'
import { ForgeKind } from '../../../src/lib/forges/forge-type'

const realFetch = globalThis.fetch

/**
 * Stand in for an instance. `routes` maps a URL to the JSON it answers with;
 * anything else is a 404. Returns the URLs that were asked for.
 */
function stubInstance(routes: Record<string, unknown>): string[] {
  const seen: string[] = []

  globalThis.fetch = (async (url: unknown) => {
    seen.push(String(url))

    return String(url) in routes
      ? new Response(JSON.stringify(routes[String(url)]), { status: 200 })
      : new Response('{"message":"Not Found"}', { status: 404 })
  }) as typeof fetch

  return seen
}

describe('detectForge', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    localStorage.clear()
  })

  it('takes a Gitea with a high version number for Gitea', async () => {
    // Gitea 28.3.0 for Windows, on 2026-11-12: this version, and no answer
    // on the path only Forgejo has.
    const endpoint = 'http://gitea28.test:3000/api/v1'
    const seen = stubInstance({
      'http://gitea28.test:3000/api/v1/version': { version: '28.3.0' },
    })

    assert.equal(await detectForge(endpoint), ForgeKind.Gitea)
    assert.deepEqual(seen, [
      'http://gitea28.test:3000/api/v1/version',
      'http://gitea28.test:3000/api/forgejo/v1/version',
    ])

    const known = getKnownForge(endpoint)
    assert.equal(known.kind, ForgeKind.Gitea)
    assert.equal(known.verified, true)
    assert.equal(known.version, '28.3.0')
  })

  it('takes a Forgejo that reports a bare number for Forgejo', async () => {
    const endpoint = 'https://forgejo-bare.test/api/v1'
    stubInstance({
      'https://forgejo-bare.test/api/v1/version': { version: '12.0.1' },
      'https://forgejo-bare.test/api/forgejo/v1/version': { version: '12.0.1' },
    })

    assert.equal(await detectForge(endpoint), ForgeKind.Forgejo)
    assert.equal(getKnownForge(endpoint).verified, true)
  })

  it('needs no second request where the version carries the suffix', async () => {
    const endpoint = 'https://forgejo-suffix.test/api/v1'
    const seen = stubInstance({
      'https://forgejo-suffix.test/api/v1/version': {
        version: '16.0.0-dev-714-11075108+gitea-1.22.0',
      },
    })

    assert.equal(await detectForge(endpoint), ForgeKind.Forgejo)
    assert.deepEqual(seen, ['https://forgejo-suffix.test/api/v1/version'])
  })

  it('takes a Gitea of the old numbering for Gitea', async () => {
    const endpoint = 'https://gitea1.test/api/v1'
    stubInstance({
      'https://gitea1.test/api/v1/version': { version: '1.27.3' },
    })

    assert.equal(await detectForge(endpoint), ForgeKind.Gitea)
  })

  it('leaves an instance that does not answer open', async () => {
    const endpoint = 'https://silent.test/api/v1'
    stubInstance({})

    assert.equal(await detectForge(endpoint), ForgeKind.Unknown)
    assert.equal(getKnownForge(endpoint).verified, false)
  })

  it('asks again where an older build stored its answer', async () => {
    // Builds up to v1.0.0-beta.2 stored this for a Gitea 28 and called it
    // verified, so the instance stayed a Forgejo however often it was asked.
    const endpoint = 'http://stored.test:3000/api/v1'
    localStorage.setItem(
      `forge-kind:${endpoint}`,
      JSON.stringify({
        kind: ForgeKind.Forgejo,
        family: 'gitea',
        version: '28.3.0',
        verified: true,
        observedAt: 1,
      })
    )
    stubInstance({
      'http://stored.test:3000/api/v1/version': { version: '28.3.0' },
    })

    assert.equal(getKnownForge(endpoint).verified, false)
    assert.equal(await detectForge(endpoint), ForgeKind.Gitea)
    assert.equal(localStorage.getItem(`forge-kind:${endpoint}`), null)
  })
})
