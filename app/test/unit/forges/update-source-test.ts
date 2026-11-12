import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'
import {
  fetchLatestRelease,
  getUpdateSourceURL,
  isRetiredProjectRepositoryURL,
  IUpdateSource,
  parseUpdateSource,
  setUpdateSourceURL,
} from '../../../src/lib/forges/update-source'
import { getKnownApiEndpointForOrigin } from '../../../src/lib/forges/forge-registry'
import {
  ProjectRepositoryURL,
  RetiredProjectRepositoryURLs,
} from '../../../src/lib/project-links'
import { Account } from '../../../src/models/account'

/** The localStorage key update-source.ts keeps the chosen repository under. */
const UpdateSourceKey = 'gitea-update-source-url'

const realFetch = globalThis.fetch

/** What the stand-in forge answers a request with. */
type Reply =
  | { readonly status: number; readonly body?: unknown; readonly raw?: string }
  | Error

/** A request the stand-in forge was sent. */
interface ISeenRequest {
  readonly url: string
  readonly authorization: string | null
}

/**
 * Stand in for a forge.
 *
 * `routes` maps a URL to the reply for it. Anything not listed is answered
 * with 404, which is what a forge says about a path it does not have - and
 * what makes a wrong dialect and a missing repository look alike.
 */
function stubForge(routes: Record<string, Reply>): ISeenRequest[] {
  const seen: ISeenRequest[] = []

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seen.push({
      url: String(url),
      authorization: new Headers(init?.headers).get('Authorization'),
    })

    const reply = routes[String(url)] ?? {
      status: 404,
      body: { message: 'Not Found' },
    }

    if (reply instanceof Error) {
      throw reply
    }

    return new Response(
      reply.raw ??
        (reply.body === undefined ? null : JSON.stringify(reply.body)),
      { status: reply.status, headers: { 'Content-Type': 'application/json' } }
    )
  }) as typeof fetch

  return seen
}

/** A release as a forge reports it. */
const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v1.2.3',
  name: 'Lodestone 1.2.3',
  html_url: 'https://example.com/releases/v1.2.3',
  draft: false,
  prerelease: false,
  ...overrides,
})

const sourceAt = (url: string): IUpdateSource => {
  const source = parseUpdateSource(url)
  assert.notEqual(source, null)
  return source as IUpdateSource
}

const accountAt = (endpoint: string, token: string) =>
  new Account('someone', endpoint, token, [], '', 1, 'Someone')

describe('parseUpdateSource', () => {
  it('splits a repository URL into instance, owner and name', () => {
    const source = parseUpdateSource('https://git.example.com/team/lodestone')

    assert.deepEqual(source, {
      endpoint: 'https://git.example.com/api/v1',
      owner: 'team',
      name: 'lodestone',
      htmlURL: 'https://git.example.com/team/lodestone',
    })
  })

  it('assumes https when no scheme is given', () => {
    assert.equal(
      parseUpdateSource('git.example.com/team/desktop')?.endpoint,
      'https://git.example.com/api/v1'
    )
  })

  it('accepts a clone URL', () => {
    assert.equal(
      parseUpdateSource('https://git.example.com/team/desktop.git')?.name,
      'desktop'
    )
  })

  it('supports an instance hosted under a sub path', () => {
    const source = parseUpdateSource('https://example.com/gitea/team/desktop')

    assert.equal(source?.endpoint, 'https://example.com/gitea/api/v1')
    assert.equal(source?.owner, 'team')
    assert.equal(source?.name, 'desktop')
  })

  it('keeps a non-default port', () => {
    assert.equal(
      parseUpdateSource('https://git.example.com:3000/team/desktop')?.endpoint,
      'https://git.example.com:3000/api/v1'
    )
  })

  it('returns null when nothing is configured', () => {
    assert.equal(parseUpdateSource(''), null)
    assert.equal(parseUpdateSource('   '), null)
  })

  it('returns null for an address that names no repository', () => {
    assert.equal(parseUpdateSource('https://git.example.com'), null)
    assert.equal(parseUpdateSource('https://git.example.com/team'), null)
  })

  it('asks api.github.com about a repository on github.com', () => {
    const source = parseUpdateSource('https://github.com/team/lodestone')

    assert.deepEqual(source, {
      endpoint: 'https://api.github.com',
      owner: 'team',
      name: 'lodestone',
      htmlURL: 'https://github.com/team/lodestone',
    })
  })

  it('checks the project repository on GitHub by default', () => {
    const source = parseUpdateSource(ProjectRepositoryURL)

    assert.deepEqual(source, {
      endpoint: 'https://api.github.com',
      owner: 'Celestial0579',
      name: 'Lodestone',
      htmlURL: 'https://github.com/Celestial0579/Lodestone',
    })
  })
})

describe('getUpdateSourceURL', () => {
  afterEach(() => localStorage.removeItem(UpdateSourceKey))

  it('falls back to the project repository when nothing is stored', () => {
    localStorage.removeItem(UpdateSourceKey)
    assert.equal(getUpdateSourceURL(), ProjectRepositoryURL)
  })

  it('keeps a repository the user chose', () => {
    setUpdateSourceURL('https://git.example.com/team/lodestone')
    assert.equal(getUpdateSourceURL(), 'https://git.example.com/team/lodestone')
  })

  it('keeps update checks switched off', () => {
    setUpdateSourceURL('')
    assert.equal(getUpdateSourceURL(), '')
  })

  it('reads a stored former project address as the current one', () => {
    for (const retired of RetiredProjectRepositoryURLs) {
      setUpdateSourceURL(retired)
      assert.equal(getUpdateSourceURL(), ProjectRepositoryURL)
    }
  })

  it('recognises a former project address however it was written', () => {
    for (const variant of [
      'https://git.firestrike.de/tim.heyne/Lodestone',
      'https://git.firestrike.de/tim.heyne/Lodestone/',
      'https://git.firestrike.de/tim.heyne/Lodestone.git',
      'git.firestrike.de/tim.heyne/lodestone',
      '  HTTPS://GIT.FIRESTRIKE.DE/tim.heyne/Lodestone  ',
    ]) {
      assert.equal(isRetiredProjectRepositoryURL(variant), true, variant)
    }
  })

  it('does not mistake other repositories on the same host for it', () => {
    assert.equal(
      isRetiredProjectRepositoryURL(
        'https://git.firestrike.de/tim.heyne/Other'
      ),
      false
    )
    assert.equal(
      isRetiredProjectRepositoryURL('https://git.firestrike.de/team/Lodestone'),
      false
    )
    assert.equal(isRetiredProjectRepositoryURL(''), false)
  })
})

describe('fetchLatestRelease', () => {
  const github = 'https://api.github.com/repos/team/lodestone'
  const gitea = 'https://git.example.com/api/v1/repos/team/lodestone'
  const enterprise = 'https://git.example.com/api/v3/repos/team/lodestone'

  afterEach(() => {
    globalThis.fetch = realFetch
    localStorage.clear()
  })

  it('returns the published release', async () => {
    const seen = stubForge({
      [`${github}/releases/latest`]: { status: 200, body: release() },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.equal(result.kind, 'release')
    assert.equal(
      result.kind === 'release' && result.release.version.version,
      '1.2.3'
    )
    assert.equal(
      result.kind === 'release' && result.release.name,
      'Lodestone 1.2.3'
    )
    assert.equal(
      result.kind === 'release' && result.release.htmlURL,
      'https://example.com/releases/v1.2.3'
    )
    assert.equal(seen.length, 1)
  })

  it('names a release after its tag when it has no name', async () => {
    stubForge({
      [`${github}/releases/latest`]: {
        status: 200,
        body: release({ name: null }),
      },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.equal(result.kind === 'release' && result.release.name, 'v1.2.3')
  })

  it('says so when the repository has nothing published', async () => {
    // What a repository looks like whose only releases are prereleases:
    // `latest` leaves them out and answers 404, the repository itself is there.
    const seen = stubForge({ [github]: { status: 200, body: {} } })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, { kind: 'no-published-release' })
    assert.deepEqual(
      seen.map(r => r.url),
      [`${github}/releases/latest`, github]
    )
  })

  it('does not offer a prerelease that `latest` hands out anyway', async () => {
    stubForge({
      [`${github}/releases/latest`]: {
        status: 200,
        body: release({ prerelease: true }),
      },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, { kind: 'no-published-release' })
  })

  it('reports a repository that is not there', async () => {
    stubForge({})

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.equal(result.kind, 'failed')
    assert.match(
      result.kind === 'failed' ? result.reason : '',
      /^https:\/\/github\.com\/team\/lodestone was not found\./
    )
  })

  it('reports an instance that cannot be reached', async () => {
    stubForge({
      [`${github}/releases/latest`]: new TypeError('fetch failed'),
    })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, {
      kind: 'failed',
      reason: 'github.com could not be reached.',
    })
  })

  it('reports an error from the forge in its own words', async () => {
    // What api.github.com says, word for word, once an address has used up
    // its anonymous requests for the hour. It ends on a sentence in brackets,
    // which is already closed and gets no second full stop.
    const message =
      "API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)"

    stubForge({
      [`${github}/releases/latest`]: { status: 403, body: { message } },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, {
      kind: 'failed',
      reason: `github.com answered with an error (403): ${message}`,
    })
  })

  it('closes an explanation from the forge as a sentence when it is not one', async () => {
    // The reason is shown between two other sentences.
    stubForge({
      [`${github}/releases/latest`]: {
        status: 401,
        body: { message: 'Bad credentials' },
      },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, {
      kind: 'failed',
      reason: 'github.com answered with an error (401): Bad credentials.',
    })
  })

  it('reports an error that comes without an explanation', async () => {
    stubForge({ [`${gitea}/releases/latest`]: { status: 500 } })

    const result = await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, {
      kind: 'failed',
      reason: 'git.example.com answered with an error (500).',
    })
  })

  it('reports a reply that is JSON but no release', async () => {
    // A proxy or a captive portal can answer 200 with anything. Neither of
    // these may make the check throw.
    for (const body of [null, {}, { tag_name: 123 }, ['v1.2.3']]) {
      stubForge({ [`${github}/releases/latest`]: { status: 200, body } })

      const result = await fetchLatestRelease(
        sourceAt('https://github.com/team/lodestone'),
        []
      )

      assert.deepEqual(
        result,
        {
          kind: 'failed',
          reason: 'github.com sent a reply that could not be read.',
        },
        JSON.stringify(body)
      )
    }
  })

  it('reports an error from the repository rather than calling it missing', async () => {
    // `latest` says 404 and the repository itself says 500: something is
    // wrong with the instance, and "not found" would send the user looking
    // for a typo in an address that is correct.
    stubForge({ [gitea]: { status: 500 } })

    const result = await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, {
      kind: 'failed',
      reason: 'git.example.com answered with an error (500).',
    })
  })

  it('reports a tag that is not a version number', async () => {
    stubForge({
      [`${github}/releases/latest`]: {
        status: 200,
        body: release({ tag_name: 'nightly' }),
      },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://github.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, {
      kind: 'failed',
      reason:
        'The latest release at https://github.com/team/lodestone is tagged "nightly", which is not a version number.',
    })
  })

  it('reports a reply that cannot be read', async () => {
    stubForge({
      [`${gitea}/releases/latest`]: { status: 200, raw: '<html>hello</html>' },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, {
      kind: 'failed',
      reason: 'git.example.com sent a reply that could not be read.',
    })
  })

  it('finds a release under the other dialect and remembers which it was', async () => {
    // Nobody has signed in to this host, so it is guessed to speak Gitea's
    // /api/v1. It is a GitHub Enterprise server and only knows /api/v3.
    const seen = stubForge({
      [`${enterprise}/releases/latest`]: { status: 200, body: release() },
    })

    const result = await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      []
    )

    assert.equal(result.kind, 'release')
    assert.deepEqual(
      seen.map(r => r.url),
      [`${gitea}/releases/latest`, gitea, `${enterprise}/releases/latest`]
    )

    // Recorded under the instance, which is where the next check looks, so
    // that one goes to the right endpoint first.
    assert.equal(
      getKnownApiEndpointForOrigin('https://git.example.com'),
      'https://git.example.com/api/v3'
    )
    assert.equal(
      sourceAt('https://git.example.com/team/lodestone').endpoint,
      'https://git.example.com/api/v3'
    )
  })

  it('remembers the dialect under the sub path an instance lives on', async () => {
    stubForge({
      'https://example.com/forge/api/v3/repos/team/lodestone/releases/latest': {
        status: 200,
        body: release(),
      },
    })

    await fetchLatestRelease(
      sourceAt('https://example.com/forge/team/lodestone'),
      []
    )

    assert.equal(
      getKnownApiEndpointForOrigin('https://example.com/forge'),
      'https://example.com/forge/api/v3'
    )
    assert.equal(getKnownApiEndpointForOrigin('https://example.com'), undefined)
  })

  it('remembers the dialect of a repository with nothing published', async () => {
    const seen = stubForge({ [enterprise]: { status: 200, body: {} } })

    const result = await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      []
    )

    assert.deepEqual(result, { kind: 'no-published-release' })
    assert.equal(seen.length, 4)
    assert.equal(
      getKnownApiEndpointForOrigin('https://git.example.com'),
      'https://git.example.com/api/v3'
    )
  })

  it('remembers no dialect when neither knows the repository', async () => {
    stubForge({})

    const result = await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      []
    )

    assert.equal(result.kind, 'failed')
    assert.equal(
      getKnownApiEndpointForOrigin('https://git.example.com'),
      undefined
    )
  })

  it('does not try the other dialect once the repository has answered', async () => {
    const seen = stubForge({ [gitea]: { status: 200, body: {} } })

    await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      []
    )

    assert.deepEqual(
      seen.map(r => r.url),
      [`${gitea}/releases/latest`, gitea]
    )
  })

  it('signs each request with the account of the endpoint it goes to', async () => {
    // The account belongs to the endpoint that is only tried second. A token
    // picked once, for the first guess, would leave every request anonymous.
    const seen = stubForge({
      [`${enterprise}/releases/latest`]: { status: 200, body: release() },
    })

    await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      [accountAt('https://git.example.com/api/v3', 'the-token')]
    )

    assert.deepEqual(
      seen.map(r => r.authorization),
      [null, null, 'Bearer the-token']
    )
  })

  it('uses the account signed in to the instance being asked', async () => {
    const seen = stubForge({
      [`${gitea}/releases/latest`]: { status: 200, body: release() },
    })

    await fetchLatestRelease(
      sourceAt('https://git.example.com/team/lodestone'),
      [
        accountAt('https://other.example.com/api/v1', 'not-this-one'),
        accountAt('https://git.example.com/api/v1', 'the-token'),
      ]
    )

    assert.deepEqual(
      seen.map(r => r.authorization),
      ['token the-token']
    )
  })

  it('sends no token to a host the user is not signed in to', async () => {
    const seen = stubForge({
      [`${github}/releases/latest`]: { status: 200, body: release() },
    })

    await fetchLatestRelease(sourceAt('https://github.com/team/lodestone'), [
      accountAt('https://git.example.com/api/v1', 'the-token'),
    ])

    assert.deepEqual(
      seen.map(r => r.authorization),
      [null]
    )
  })
})
