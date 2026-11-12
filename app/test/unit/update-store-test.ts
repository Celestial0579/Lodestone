import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IUpdateState,
  updateStore,
  UpdateStatus,
} from '../../src/ui/lib/update-store'
import { setUpdateSourceURL } from '../../src/lib/forges/update-source'

const realFetch = globalThis.fetch

const latest = 'https://api.github.com/repos/team/lodestone/releases/latest'
const repository = 'https://api.github.com/repos/team/lodestone'

/** Stand in for the forge: URLs not listed are answered with 404. */
function stubForge(
  routes: Record<string, { status: number; body?: unknown } | Error>
) {
  globalThis.fetch = (async (url: unknown) => {
    const reply = routes[String(url)] ?? { status: 404, body: {} }

    if (reply instanceof Error) {
      throw reply
    }

    return new Response(
      reply.body === undefined ? null : JSON.stringify(reply.body),
      { status: reply.status }
    )
  }) as typeof fetch
}

const releaseTagged = (tag: string) => ({
  status: 200,
  body: {
    tag_name: tag,
    name: `Lodestone ${tag}`,
    html_url: `https://github.com/team/lodestone/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
  },
})

/** Check in the background, the way the app does on its own every few hours. */
const check = () => updateStore.checkForUpdates(true, false, [])

describe('UpdateStore checking a forge', () => {
  beforeEach(() => {
    setUpdateSourceURL('https://github.com/team/lodestone')
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    localStorage.clear()
  })

  it('offers a release newer than the running version', async () => {
    stubForge({ [latest]: releaseTagged('v99.0.0') })

    await check()

    const state = updateStore.state
    assert.equal(state.status, UpdateStatus.UpdateAvailable)
    assert.equal(state.forgeRelease?.name, 'Lodestone v99.0.0')
    assert.deepEqual(state.forgeCheck, { kind: 'compared' })
    assert.notEqual(state.lastSuccessfulCheck, null)
  })

  it('says the version is current when the latest release is not newer', async () => {
    stubForge({ [latest]: releaseTagged('v0.0.1') })

    await check()

    const state = updateStore.state
    assert.equal(state.status, UpdateStatus.UpdateNotAvailable)
    assert.equal(state.forgeRelease, null)
    assert.deepEqual(state.forgeCheck, { kind: 'compared' })
    assert.notEqual(state.lastSuccessfulCheck, null)
  })

  it('tells a repository with nothing published apart from being current', async () => {
    stubForge({ [repository]: { status: 200, body: {} } })

    await check()

    const state = updateStore.state
    assert.equal(state.status, UpdateStatus.UpdateNotAvailable)
    assert.equal(state.forgeRelease, null)
    assert.deepEqual(state.forgeCheck, { kind: 'no-published-release' })

    // The repository answered, so this was a check that worked.
    assert.notEqual(state.lastSuccessfulCheck, null)
  })

  it('reports a check that failed, with the reason', async () => {
    stubForge({ [latest]: new TypeError('fetch failed') })

    await check()

    const state = updateStore.state
    assert.equal(state.status, UpdateStatus.UpdateNotAvailable)
    assert.equal(state.forgeRelease, null)
    assert.deepEqual(state.forgeCheck, {
      kind: 'failed',
      reason: 'github.com could not be reached.',
    })
  })

  it('does not count a failed check as the last successful one', async () => {
    stubForge({ [latest]: releaseTagged('v0.0.1') })
    await check()
    const before = updateStore.state.lastSuccessfulCheck

    stubForge({ [latest]: { status: 500 } })
    await check()

    const state = updateStore.state
    assert.equal(state.forgeCheck?.kind, 'failed')
    assert.notEqual(before, null)
    assert.equal(state.lastSuccessfulCheck?.getTime(), before?.getTime())
  })

  it('stops offering a release once a later check fails', async () => {
    stubForge({ [latest]: releaseTagged('v99.0.0') })
    await check()
    assert.equal(updateStore.state.status, UpdateStatus.UpdateAvailable)

    stubForge({})
    await check()

    const state = updateStore.state
    assert.equal(state.status, UpdateStatus.UpdateNotAvailable)
    assert.equal(state.forgeRelease, null)
    assert.equal(state.forgeCheck?.kind, 'failed')
  })

  it('drops the previous outcome while the next check is running', async () => {
    stubForge({})
    await check()
    assert.equal(updateStore.state.forgeCheck?.kind, 'failed')

    const seen: IUpdateState[] = []
    const subscription = updateStore.onDidChange(state => seen.push(state))

    stubForge({ [latest]: releaseTagged('v0.0.1') })
    await check()
    subscription.dispose()

    // An old failure next to "Checking for updates" would read as a new one.
    assert.equal(seen[0].status, UpdateStatus.CheckingForUpdates)
    assert.equal(seen[0].forgeCheck, null)
    assert.deepEqual(seen.at(-1)?.forgeCheck, { kind: 'compared' })
  })

  it('forgets a failure once update checks are switched off', async () => {
    stubForge({})
    await check()
    assert.equal(updateStore.state.forgeCheck?.kind, 'failed')

    setUpdateSourceURL('')
    await check()

    assert.equal(updateStore.state.forgeCheck, null)
  })
})
