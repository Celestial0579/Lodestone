import { describe, it } from 'node:test'
import assert from 'node:assert'
import { exec } from 'dugite'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../../helpers/temp'
import {
  findNetworkPaths,
  findNetworkPathsUpward,
  isNetworkPath,
} from '../../../src/lib/git/repository-trust-paths'
import { readRepositoryFindings } from '../../../src/lib/git/repository-trust-facts'
import { RepositoryTrustStore } from '../../../src/lib/stores/repository-trust-store'
import { git } from '../../../src/lib/git/core'
import {
  RepositoryRefusedError,
  setRepositoryRefusal,
} from '../../../src/lib/git/repository-trust-state'
import {
  describeFindings,
  hasFindings,
} from '../../../src/lib/git/repository-trust'

const fwd = (p: string) => p.replace(/\\/g, '/')

const memory = () => {
  let data = {}
  return { read: () => data, write: (d: object) => void (data = d) }
}

describe('isNetworkPath', () => {
  for (const value of [
    '\\\\host\\share\\x',
    '\\\\\\\\host\\\\share',
    '//host/share/x',
    '\\\\?\\UNC\\host\\share',
    '\\\\.\\pipe\\x',
    '"\\\\host\\share"',
  ]) {
    it(`${value} is one`, () => assert.equal(isNetworkPath(value), true))
  }

  for (const value of [
    '/home/u/x',
    'C:\\Users\\u',
    'C:/x',
    'relative/path',
    '',
  ]) {
    it(`${value} is not one`, () => assert.equal(isNetworkPath(value), false))
  }
})

describe('findNetworkPaths', () => {
  async function repo(t: Parameters<typeof createTempDirectory>[0]) {
    const path = await createTempDirectory(t)
    await exec(['init', '-q'], path)
    return path
  }

  it('finds nothing in an ordinary repository', async t => {
    assert.deepEqual(await findNetworkPaths(await repo(t)), [])
  })

  it('finds a network path in include.path, in the alternates file and in a key', async t => {
    const path = await repo(t)
    const config = join(path, '.git', 'config')
    await exec(['config', 'include.path', '//host/share/x.inc'], path)
    assert.equal((await findNetworkPaths(path)).length, 1)

    await exec(['config', '--unset', 'include.path'], path)
    await exec(['config', 'core.excludesFile', '\\\\host\\share\\ignore'], path)
    assert.equal((await findNetworkPaths(path)).length, 1)
    void config

    await exec(['config', '--unset', 'core.excludesFile'], path)
    await mkdir(join(path, '.git', 'objects', 'info'), { recursive: true })
    await writeFile(
      join(path, '.git', 'objects', 'info', 'alternates'),
      '//host/share/objects\n'
    )
    assert.equal((await findNetworkPaths(path)).length, 1)
  })

  it('follows a local include file and finds a network path inside it', async t => {
    const path = await repo(t)
    await writeFile(join(path, 'inc'), '[core]\n\thooksPath = //host/h\n')
    await exec(['config', 'include.path', join(path, 'inc')], path)
    assert.equal((await findNetworkPaths(path)).length, 1)
  })

  it('reads the config the way Git does: quotes, continuation lines, section headers and subsection names', async t => {
    const forms = [
      '[core]\n\thooksPath = "//host/share"\n',
      '[core]\n\thooksPath = \\\n//host/share\n',
      '[url "//host/share/"]\n\tinsteadOf = https://example.com/\n',
      '[core] hooksPath = //host/share\n',
      '[core]\n\texcludesFile = \\\\\\\\host\\\\share\\\\x\n',
    ]
    for (const text of forms) {
      const path = await repo(t)
      await writeFile(
        join(path, '.git', 'config'),
        `[core]\n\tbare = false\n${text}`
      )
      assert.equal(
        (await findNetworkPaths(path)).length,
        1,
        `not found in: ${JSON.stringify(text)}`
      )
    }
  })

  it('follows includes up to ten deep and alternates up to five', async t => {
    const path = await repo(t)
    const dir = await createTempDirectory(t)
    for (let i = 0; i < 9; i++) {
      await writeFile(
        join(dir, `i${i}`),
        `[include]\n\tpath = ${fwd(join(dir, `i${i + 1}`))}\n`
      )
    }
    await writeFile(join(dir, 'i9'), '[core]\n\texcludesFile = //host/x\n')
    await exec(['config', 'include.path', join(dir, 'i0')], path)
    assert.equal((await findNetworkPaths(path)).length, 1)

    const base = await createTempDirectory(t)
    const path2 = await repo(t)
    for (let i = 0; i < 4; i++) {
      await mkdir(join(base, `o${i}`, 'info'), { recursive: true })
      await writeFile(
        join(base, `o${i}`, 'info', 'alternates'),
        `${fwd(join(base, `o${i + 1}`))}
`
      )
    }
    await mkdir(join(base, 'o4', 'info'), { recursive: true })
    await writeFile(join(base, 'o4', 'info', 'alternates'), '//host/objects\n')
    await mkdir(join(path2, '.git', 'objects', 'info'), { recursive: true })
    await writeFile(
      join(path2, '.git', 'objects', 'info', 'alternates'),
      `${fwd(join(base, 'o0'))}\n`
    )
    assert.equal((await findNetworkPaths(path2)).length, 1)
  })

  it('finds a .git file that points to a network path, in a folder or above it', async t => {
    const path = await createTempDirectory(t)
    await writeFile(join(path, '.git'), 'gitdir: //host/share/x\n')
    assert.equal((await findNetworkPaths(path)).length, 1)

    const sub = join(path, 'a', 'b')
    await mkdir(sub, { recursive: true })
    assert.equal((await findNetworkPathsUpward(sub)).length, 1)
  })
})

describe('network paths and the app', () => {
  it('refuses to run Git in a folder that names one, and does not ask Git about it', async t => {
    const path = await createTempDirectory(t)
    await exec(['init', '-q'], path)
    await exec(['config', 'core.attributesFile', '//host/share/attrs'], path)

    const store = new RepositoryTrustStore(memory(), async () => {
      throw new Error('Git must not be asked')
    })
    t.after(() => setRepositoryRefusal(path, []))

    store.markPending(path)
    await store.inspectPaths(path)
    await assert.rejects(git(['status'], path, 'test'), RepositoryRefusedError)

    const evaluation = await store.evaluate(path)
    assert.equal(evaluation.needsQuestion, false)
    assert.equal(evaluation.trust, 'pending')
  })

  it('does not follow a submodule .git file that points outside, and names it', async t => {
    const path = await createTempDirectory(t)
    await exec(['init', '-q', '-b', 'main'], path)
    await exec(['config', 'user.name', 't'], path)
    await exec(['config', 'user.email', 't@example.com'], path)
    await mkdir(join(path, 'sm'))
    await writeFile(join(path, 'sm', '.git'), 'gitdir: //host/share/evil\n')
    // A gitlink in the index without a submodule checkout of its own.
    await exec(
      [
        'update-index',
        '--add',
        '--cacheinfo',
        '160000,0123456789012345678901234567890123456789,sm',
      ],
      path
    )

    const findings = await readRepositoryFindings(path)
    assert.ok(findings)
    assert.equal(hasFindings(findings), true)
    assert.ok(
      describeFindings(findings).some(l =>
        l.includes('points outside this repository')
      )
    )
  })
})
