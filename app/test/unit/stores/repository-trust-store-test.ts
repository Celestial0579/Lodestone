import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import { exec } from 'dugite'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../../helpers/temp'
import {
  IStoredTrustAnswer,
  ITrustStorage,
  RepositoryTrustStore,
} from '../../../src/lib/stores/repository-trust-store'
import {
  getGitArgumentsFor,
  getRepositoryGitPolicy,
  setEmptyHooksDirectory,
  setRepositoryGitPolicy,
} from '../../../src/lib/git/repository-trust-state'

class MemoryStorage implements ITrustStorage {
  public answers: Record<string, IStoredTrustAnswer> = {}
  public read() {
    return this.answers
  }
  public write(answers: Readonly<Record<string, IStoredTrustAnswer>>) {
    this.answers = { ...answers }
  }
}

async function repository(t: TestContext) {
  const base = await createTempDirectory(t)
  const path = join(base, 'repo')
  await mkdir(path)
  await mkdir(join(base, 'empty'))
  setEmptyHooksDirectory(join(base, 'empty'))
  const r = await exec(['init', '-q', '-b', 'main'], path)
  assert.equal(r.exitCode, 0)
  t.after(() => setRepositoryGitPolicy(path, null))
  return path
}

const config = (path: string, key: string, value: string) =>
  exec(['config', key, value], path)

describe('RepositoryTrustStore', () => {
  it('asks nothing of a repository that brings nothing', async t => {
    const path = await repository(t)
    const store = new RepositoryTrustStore(new MemoryStorage())

    const e = await store.evaluate(path)

    assert.equal(e.needsQuestion, false)
    assert.equal(e.trust, 'trusted')
    assert.deepEqual(e.lines, [])
  })

  it('does not count the sample hooks Git writes', async t => {
    const path = await repository(t)
    await mkdir(join(path, '.git', 'hooks'), { recursive: true })
    await writeFile(
      join(path, '.git', 'hooks', 'pre-commit.sample'),
      '#!/bin/sh\n'
    )
    const store = new RepositoryTrustStore(new MemoryStorage())

    assert.equal((await store.evaluate(path)).needsQuestion, false)
  })

  it('asks once for a repository that sets a command, untrusted until answered', async t => {
    const path = await repository(t)
    await config(path, 'core.sshCommand', 'touch /nowhere')
    const store = new RepositoryTrustStore(new MemoryStorage())

    const e = await store.evaluate(path)

    assert.equal(e.needsQuestion, true)
    assert.equal(e.trust, 'untrusted')
    assert.deepEqual(e.lines, ['core.sshcommand = touch /nowhere'])
    assert.equal(getRepositoryGitPolicy(path)?.trust, 'untrusted')
    assert.ok(getGitArgumentsFor(path).includes('core.sshcommand=ssh'))
  })

  it('asks for a hook that is a file without the executable bit', async t => {
    const path = await repository(t)
    await mkdir(join(path, '.git', 'hooks'), { recursive: true })
    await writeFile(join(path, '.git', 'hooks', 'post-merge'), '#!/bin/sh\n')
    await chmod(join(path, '.git', 'hooks', 'post-merge'), 0o644)
    const store = new RepositoryTrustStore(new MemoryStorage())

    const e = await store.evaluate(path)

    assert.equal(e.needsQuestion, true)
    assert.deepEqual(e.lines, ['hook: post-merge'])
  })

  it('reads a key that comes in through an included file', async t => {
    const path = await repository(t)
    await writeFile(
      join(path, '..', 'extra.cfg'),
      '[core]\n\tfsmonitor = touch /x\n'
    )
    await config(path, 'include.path', '../../extra.cfg')
    const store = new RepositoryTrustStore(new MemoryStorage())

    const e = await store.evaluate(path)

    assert.equal(e.needsQuestion, true)
    assert.ok(e.lines.some(l => l.startsWith('core.fsmonitor')))
  })

  it('trusts after a yes, and keeps a no, for that fingerprint', async t => {
    const path = await repository(t)
    await config(path, 'core.sshCommand', 'ssh -i k')
    const storage = new MemoryStorage()
    const store = new RepositoryTrustStore(storage)

    await store.evaluate(path)
    store.answer(path, true)
    assert.equal(getRepositoryGitPolicy(path)?.trust, 'trusted')
    assert.equal(
      getGitArgumentsFor(path).includes('core.sshcommand=ssh'),
      false
    )

    const again = await new RepositoryTrustStore(storage).evaluate(path)
    assert.equal(again.trust, 'trusted')
    assert.equal(again.needsQuestion, false)

    // A no stays a no, and is not asked again either.
    const other = await repository(t)
    await config(other, 'core.sshCommand', 'ssh -i k')
    const storage2 = new MemoryStorage()
    const store2 = new RepositoryTrustStore(storage2)
    await store2.evaluate(other)
    store2.answer(other, false)
    const second = await new RepositoryTrustStore(storage2).evaluate(other)
    assert.equal(second.trust, 'untrusted')
    assert.equal(second.needsQuestion, false)
  })

  it('asks again when a value, a key or a hook changes, and is untrusted meanwhile', async t => {
    const path = await repository(t)
    await config(path, 'core.sshCommand', 'ssh -i k')
    const storage = new MemoryStorage()
    const store = new RepositoryTrustStore(storage)
    await store.evaluate(path)
    store.answer(path, true)

    await config(path, 'core.sshCommand', 'ssh -i other')
    let e = await store.evaluate(path)
    assert.equal(e.needsQuestion, true)
    assert.equal(e.trust, 'untrusted')

    store.answer(path, true)
    await config(path, 'core.pager', 'touch /x')
    e = await store.evaluate(path)
    assert.equal(e.needsQuestion, true)

    store.answer(path, true)
    await mkdir(join(path, '.git', 'hooks'), { recursive: true })
    await writeFile(join(path, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n')
    e = await store.evaluate(path)
    assert.equal(e.needsQuestion, true)

    store.answer(path, true)
    await writeFile(
      join(path, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\necho changed\n'
    )
    e = await store.evaluate(path)
    assert.equal(e.needsQuestion, true)
    assert.equal(e.trust, 'untrusted')
  })

  it('asks again after the answer is revoked', async t => {
    const path = await repository(t)
    await config(path, 'core.sshCommand', 'ssh -i k')
    const store = new RepositoryTrustStore(new MemoryStorage())
    await store.evaluate(path)
    store.answer(path, true)
    assert.equal(store.listTrusted().length, 1)

    store.revoke(path)

    assert.equal(store.listTrusted().length, 0)
    const e = await store.evaluate(path)
    assert.equal(e.needsQuestion, true)
    assert.equal(e.trust, 'untrusted')
  })

  it('keeps a repository Git cannot read pending, with nothing to run', async t => {
    const base = await createTempDirectory(t)
    t.after(() => setRepositoryGitPolicy(base, null))
    const store = new RepositoryTrustStore(new MemoryStorage())

    const e = await store.evaluate(base)

    assert.equal(e.trust, 'pending')
    assert.equal(getRepositoryGitPolicy(base)?.trust, 'pending')
    assert.ok(getGitArgumentsFor(base).includes('core.fsmonitor=false'))
  })

  it('markPending switches off hooks and the monitor before the first look', async t => {
    const path = await repository(t)
    const store = new RepositoryTrustStore(new MemoryStorage())

    store.markPending(path)

    const args = getGitArgumentsFor(path)
    assert.ok(args.includes('core.fsmonitor=false'))
    assert.ok(args.some(a => a.startsWith('core.hooksPath=')))
  })
})
