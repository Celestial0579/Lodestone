import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getGitHubReleaseURL,
  isNewerThanRunning,
  parseUpdateRequest,
  readGitHubRelease,
  UpdateGate,
  writeWithBackpressure,
} from '../../../src/lib/forges/update-guard'

describe('isNewerThanRunning', () => {
  it('accepts a newer version', () => {
    assert.equal(isNewerThanRunning('1.0.3', '1.0.2'), true)
  })

  it('refuses the running version and an older one', () => {
    assert.equal(isNewerThanRunning('1.0.2', '1.0.2'), false)
    assert.equal(isNewerThanRunning('1.0.1', '1.0.2'), false)
  })

  it('counts a final as newer than a beta of it', () => {
    assert.equal(isNewerThanRunning('1.0.3', '1.0.3-beta01'), true)
    assert.equal(isNewerThanRunning('1.0.3-beta01', '1.0.3'), false)
  })

  it('refuses what is not a version', () => {
    assert.equal(isNewerThanRunning('../1.0.3', '1.0.2'), false)
    assert.equal(isNewerThanRunning('1.0.3', 'dev'), false)
  })
})

describe('parseUpdateRequest', () => {
  const good = {
    version: '1.0.3',
    sourceURL: 'https://github.com/a/b',
    assets: [{ name: 'x', url: 'https://github.com/a/b/x', size: 3 }],
  }

  it('reads a request of the right shape', () => {
    assert.deepEqual(parseUpdateRequest(good), good)
  })

  it('drops fields it did not ask for', () => {
    const request = parseUpdateRequest({
      ...good,
      assets: [{ ...good.assets[0], extra: 'x' }],
      more: 1,
    })
    assert.deepEqual(request, good)
  })

  it('refuses anything else with a reason', () => {
    for (const bad of [
      null,
      'x',
      [],
      {},
      { ...good, version: 3 },
      { ...good, sourceURL: undefined },
      { ...good, assets: 'x' },
      { ...good, assets: [null] },
      { ...good, assets: [{ name: 'x', url: 1, size: 3 }] },
      { ...good, assets: new Array(201).fill(good.assets[0]) },
    ]) {
      assert.equal(
        typeof parseUpdateRequest(bad),
        'string',
        JSON.stringify(bad)
      )
    }
  })
})

describe('getGitHubReleaseURL', () => {
  it('names the release of the version in the API of github.com', () => {
    assert.equal(
      getGitHubReleaseURL('https://github.com/Team/lodestone', '1.0.3'),
      'https://api.github.com/repos/Team/lodestone/releases/tags/v1.0.3'
    )
  })

  it('takes a repository address with .git or a slash', () => {
    const url =
      'https://api.github.com/repos/Team/lodestone/releases/tags/v1.0.3'
    assert.equal(
      getGitHubReleaseURL('https://github.com/Team/lodestone.git', '1.0.3'),
      url
    )
    assert.equal(
      getGitHubReleaseURL('https://github.com/Team/lodestone/', '1.0.3'),
      url
    )
  })

  it('leaves other hosts, other schemes and odd paths to the request', () => {
    for (const source of [
      'https://git.example.com/team/lodestone',
      'http://github.com/team/lodestone',
      'https://github.com.evil.example/team/lodestone',
      'https://github.com/team',
      'https://github.com/team/lodestone/extra',
      'not a url',
    ]) {
      assert.equal(getGitHubReleaseURL(source, '1.0.3'), null, source)
    }
  })

  it('refuses a version that could name a path', () => {
    assert.equal(
      getGitHubReleaseURL('https://github.com/team/lodestone', '1.0.3/../x'),
      null
    )
  })
})

describe('readGitHubRelease', () => {
  const release = {
    tag_name: 'v1.0.3',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'a', browser_download_url: 'https://github.com/x', size: 5 },
      { name: 'b' },
    ],
  }

  it('lists the files of the release, leaving out what is malformed', () => {
    assert.deepEqual(readGitHubRelease(release, '1.0.3'), [
      { name: 'a', url: 'https://github.com/x', size: 5 },
    ])
  })

  it('refuses a release of another version', () => {
    assert.equal(typeof readGitHubRelease(release, '1.0.4'), 'string')
  })

  it('refuses a draft and a pre-release', () => {
    assert.equal(
      typeof readGitHubRelease({ ...release, draft: true }, '1.0.3'),
      'string'
    )
    assert.equal(
      typeof readGitHubRelease({ ...release, prerelease: true }, '1.0.3'),
      'string'
    )
  })

  it('refuses an answer that is no release', () => {
    assert.equal(typeof readGitHubRelease(null, '1.0.3'), 'string')
    assert.equal(
      typeof readGitHubRelease({ tag_name: 'v1.0.3' }, '1.0.3'),
      'string'
    )
  })
})

describe('UpdateGate', () => {
  const busy = () => 'busy'

  it('shares the result of a request that is running', async () => {
    const gate = new UpdateGate<string>()
    let starts = 0
    const start = async () => {
      starts++
      return 'started'
    }

    const [a, b] = await Promise.all([
      gate.request(start, busy),
      gate.request(start, busy),
    ])

    assert.equal(starts, 1)
    assert.deepEqual([a, b], ['started', 'started'])
  })

  it('does not start a second request while Squirrel holds the feed', async () => {
    const gate = new UpdateGate<string>()
    let starts = 0
    const start = async () => {
      starts++
      return 'started'
    }

    await gate.request(start, busy)
    gate.holdFeed('feed')

    assert.equal(await gate.request(start, busy), 'busy')
    assert.equal(starts, 1)
  })

  it('starts again once the feed is let go, and says which it was', async () => {
    const gate = new UpdateGate<string>()
    let starts = 0
    const start = async () => {
      starts++
      return 'started'
    }

    gate.holdFeed('feed')
    assert.equal(gate.releaseFeed(), 'feed')
    assert.equal(gate.releaseFeed(), null)
    assert.equal(await gate.request(start, busy), 'started')
    assert.equal(starts, 1)
  })

  it('starts again after a request that failed', async () => {
    const gate = new UpdateGate<string>()
    await assert.rejects(
      gate.request(() => Promise.reject(new Error('x')), busy)
    )
    assert.equal(await gate.request(async () => 'ok', busy), 'ok')
  })
})

describe('writeWithBackpressure', () => {
  const setup = (accepts: boolean) => {
    const events = new Array<string>()
    let drained: (() => void) | null = null
    const response = {
      pause: () => events.push('pause'),
      resume: () => events.push('resume'),
    }
    const file = {
      write: () => {
        events.push('write')
        return accepts
      },
      once: (_: 'drain', listener: () => void) => {
        drained = listener
      },
    }
    return { events, response, file, drain: () => drained?.() }
  }

  it('lets the response run while the file keeps up', () => {
    const { events, response, file } = setup(true)
    writeWithBackpressure(response, file, Buffer.from('x'))
    assert.deepEqual(events, ['write'])
  })

  it('pauses the response until the file has drained', () => {
    const { events, response, file, drain } = setup(false)
    writeWithBackpressure(response, file, Buffer.from('x'))
    assert.deepEqual(events, ['write', 'pause'])
    drain()
    assert.deepEqual(events, ['write', 'pause', 'resume'])
  })
})
