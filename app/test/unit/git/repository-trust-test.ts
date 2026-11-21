/**
 * A repository's own configuration and hooks must not run programs unless the
 * user trusted it (#98). Every case builds a temporary repository in the test,
 * plants a command that writes a marker file, and runs the app's own function.
 * Untrusted: the marker is absent and the operation still did its work.
 * Trusted: the marker is there, as with the Git command line, which shows that
 * the case would otherwise have run the command. Nothing reaches a real remote.
 */

import { afterEach, describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import { exec } from 'dugite'
import { createServer, Server } from 'http'
import { chmod, mkdir, stat, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../../helpers/temp'
import { Repository } from '../../../src/models/repository'
import { DiffType } from '../../../src/models/diff'
import { getStatus } from '../../../src/lib/git/status'
import { getWorkingDirectoryDiff } from '../../../src/lib/git/diff'
import { fetch } from '../../../src/lib/git/fetch'
import { createCommit } from '../../../src/lib/git/commit'
import { checkoutBranch } from '../../../src/lib/git/checkout'
import { getBranches } from '../../../src/lib/git/for-each-ref'
import { readRepositoryFindings } from '../../../src/lib/git/repository-trust-facts'
import {
  describeFindings,
  hasFindings,
} from '../../../src/lib/git/repository-trust'
import {
  buildRepositoryGitPolicy,
  getGitArgumentsFor,
  getGitEnvironmentFor,
  RepositoryNetworkBlockedError,
  RepositorySubmoduleBlockedError,
  setFailClosed,
  setEmptyHooksDirectory,
  setRepositoryGitPolicy,
} from '../../../src/lib/git/repository-trust-state'
import { git } from '../../../src/lib/git/core'

async function run(args: ReadonlyArray<string>, cwd: string) {
  const r = await exec([...args], cwd)
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  return r.stdout.trim()
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  )

/** A path as the shell that runs Git's commands reads it. */
const shPath = (path: string) =>
  __WIN32__ ? path.replace(/^([A-Za-z]):/, '/$1').replace(/\\/g, '/') : path

/** An ext:: remote that runs a command writing the marker ('% ' is a space in it). */
const extRemote = (marker: string) => `ext::sh -c echo% x% >% ${shPath(marker)}`

const marks = (marker: string) => `echo x > "${shPath(marker)}"`

async function script(path: string, marker: string) {
  await writeFile(path, `#!/bin/sh\n${marks(marker)}\nexit 0\n`)
  await chmod(path, 0o755)
}

interface IFixture {
  readonly repo: Repository
  readonly remotePath: string
  readonly marker: string
  readonly base: string
  readonly emptyHooks: string
}

/** A repository with a commit, a change in its work tree, and a local bare remote one commit ahead. */
async function fixture(t: TestContext): Promise<IFixture> {
  const base = await createTempDirectory(t)
  const path = join(base, 'work')
  const remotePath = join(base, 'remote.git')
  const other = join(base, 'other')
  const emptyHooks = join(base, 'empty-hooks')
  await mkdir(path)
  await mkdir(emptyHooks)
  setEmptyHooksDirectory(emptyHooks)
  await run(['init', '-q', '-b', 'main'], path)
  await run(['config', 'user.name', 't'], path)
  await run(['config', 'user.email', 't@example.com'], path)
  await writeFile(join(path, 'a.txt'), 'one\n')
  await run(['add', '.'], path)
  await run(['commit', '-q', '-m', 'one'], path)
  await run(['clone', '-q', '--bare', path, remotePath], base)
  await run(['remote', 'add', 'origin', remotePath], path)
  await run(['fetch', '-q', 'origin'], path)
  await run(['clone', '-q', remotePath, other], base)
  await run(['config', 'user.name', 't'], other)
  await run(['config', 'user.email', 't@example.com'], other)
  await writeFile(join(other, 'b.txt'), 'two\n')
  await run(['add', '.'], other)
  await run(['commit', '-q', '-m', 'two'], other)
  await run(['push', '-q', 'origin', 'main'], other)
  await writeFile(join(path, 'a.txt'), 'one changed\n')

  return {
    repo: new Repository(path, -1, null, false),
    remotePath,
    marker: join(base, 'MARKER'),
    base,
    emptyHooks,
  }
}

type Operation = {
  readonly name: string
  /** Runs the app's function. */
  readonly run: (f: IFixture) => Promise<unknown>
  /** What shows that it did its work. */
  readonly worked: (f: IFixture) => Promise<void>
}

const status: Operation = {
  name: 'status',
  run: f => getStatus(f.repo),
  worked: async f => {
    const s = await getStatus(f.repo)
    assert.equal(s?.workingDirectory.files.length, 1)
  },
}

const diff: Operation = {
  name: 'diff of a changed file',
  run: async f => {
    const s = await getStatus(f.repo)
    const file = s?.workingDirectory.files.find(x => x.path === 'a.txt')
    assert.ok(file)
    const d = await getWorkingDirectoryDiff(f.repo, file)
    assert.equal(d.kind, DiffType.Text)
  },
  worked: async () => {},
}

const fetchOp: Operation = {
  name: 'fetch',
  run: f =>
    fetch(f.repo, { name: 'origin', url: f.remotePath }, undefined, true),
  worked: async f => {
    const remote = await run(['rev-parse', 'main'], f.remotePath)
    assert.equal(await run(['rev-parse', 'origin/main'], f.repo.path), remote)
  },
}

const commitOp: Operation = {
  name: 'commit',
  run: async f => {
    const s = await getStatus(f.repo)
    return createCommit(f.repo, 'msg', s?.workingDirectory.files ?? [])
  },
  worked: async f => {
    assert.equal(await run(['log', '-1', '--format=%s'], f.repo.path), 'msg')
  },
}

/**
 * A fetch run the way the policy runs any Git call, without the credential
 * helper the app puts in the environment for its own network operations (that
 * helper replaces every helper of the repository, so the app's fetch never
 * runs one, trusted or not). What is under test here is the override.
 */
const plainFetchOp: Operation = {
  name: "fetch without the app's credential helper",
  run: async f => {
    const args = ['fetch', '-q', 'origin']
    const r = await exec(
      [...getGitArgumentsFor(f.repo.path, args)],
      f.repo.path,
      {
        env: {
          GIT_TERMINAL_PROMPT: '0',
          ...getGitEnvironmentFor(f.repo.path, args),
        },
      }
    )
    if (r.exitCode !== 0) {
      throw new Error(r.stderr)
    }
  },
  worked: async () => {},
}

const checkoutOp: Operation = {
  name: 'checkout',
  run: async f => {
    await run(['stash', '-q'], f.repo.path)
    await run(['checkout', '-q', '-b', 'other'], f.repo.path)
    await writeFile(join(f.repo.path, 'a.txt'), 'other side\n')
    await run(['commit', '-q', '-am', 'other'], f.repo.path)
    await run(['checkout', '-q', 'main'], f.repo.path)
    await exec(['rm', '-f', f.marker].slice(0, 0), f.repo.path)
    await removeMarker(f)
    const branches = await getBranches(f.repo)
    const other = branches.find(b => b.name === 'other')
    assert.ok(other)
    await checkoutBranch(f.repo, other, null)
  },
  worked: async f => {
    assert.equal(await run(['branch', '--show-current'], f.repo.path), 'other')
  },
}

async function removeMarker(f: IFixture) {
  const { rm } = await import('fs/promises')
  await rm(f.marker, { force: true })
}

const servers = new Array<Server>()

/** An HTTP server that asks for credentials on every request, so Git asks a helper. */
async function remoteThatAsksForCredentials(): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' })
    res.end()
  })
  servers.push(server)
  await new Promise<void>(listening =>
    server.listen(0, '127.0.0.1', () => listening())
  )
  const address = server.address()
  const port =
    typeof address === 'object' && address !== null ? address.port : 0
  return `http://127.0.0.1:${port}/x.git`
}

interface IVector {
  readonly key: string
  readonly setup: (f: IFixture) => Promise<unknown>
  readonly operations: ReadonlyArray<Operation>
  /** The operation cannot do its work with the program switched off (a real ssh to nowhere). */
  readonly mayFail?: boolean
  readonly remoteUrl?: string
  /** The app never lets this one run, trusted or not. */
  readonly neverRuns?: boolean
  /** Operations the app never lets it run on, trusted or not. */
  readonly neverRunsOn?: ReadonlyArray<string>
  /** Git for Windows does not start a script given as a bare program for this key, so the trusted run cannot show it. */
  readonly noTrustedProofOnWindows?: boolean
}

const vectors: ReadonlyArray<IVector> = [
  {
    key: 'core.fsmonitor',
    setup: f => run(['config', 'core.fsmonitor', marks(f.marker)], f.repo.path),
    operations: [status, diff, fetchOp, commitOp, checkoutOp],
    // Reading the status never starts the monitor.
    neverRunsOn: ['status'],
  },
  {
    key: '.git/hooks',
    setup: async f => {
      for (const h of [
        'pre-commit',
        'post-checkout',
        'reference-transaction',
        'post-index-change',
      ]) {
        await script(join(f.repo.path, '.git', 'hooks', h), f.marker)
      }
    },
    operations: [fetchOp, commitOp, checkoutOp],
  },
  {
    key: 'core.hooksPath',
    setup: async f => {
      const dir = join(f.base, 'hooks')
      await mkdir(dir)
      for (const h of [
        'pre-commit',
        'post-checkout',
        'reference-transaction',
      ]) {
        await script(join(dir, h), f.marker)
      }
      await run(['config', 'core.hooksPath', dir], f.repo.path)
    },
    operations: [fetchOp, commitOp, checkoutOp],
  },
  {
    key: 'core.sshCommand',
    setup: f =>
      run(
        ['config', 'core.sshCommand', `${marks(f.marker)}; false`],
        f.repo.path
      ),
    operations: [fetchOp],
    mayFail: true,
    remoteUrl: 'ssh://127.0.0.1:1/x.git',
  },
  {
    key: 'credential.helper (a remote that asks for credentials)',
    setup: async f => {
      const url = await remoteThatAsksForCredentials()
      await run(['remote', 'set-url', 'origin', url], f.repo.path)
      await run(
        [
          'config',
          'credential.helper',
          `!${marks(f.marker)}; echo username=a; echo password=b`,
        ],
        f.repo.path
      )
    },
    operations: [plainFetchOp],
    mayFail: true,
    noTrustedProofOnWindows: true,
  },
  {
    // The app's own fetch puts its credential helper in the environment, which
    // replaces every helper of the repository: the helper never runs, trusted
    // or not.
    key: "credential.helper (through the app's own fetch)",
    setup: async f => {
      const url = await remoteThatAsksForCredentials()
      await run(['remote', 'set-url', 'origin', url], f.repo.path)
      await run(
        [
          'config',
          'credential.helper',
          `!${marks(f.marker)}; echo username=a; echo password=b`,
        ],
        f.repo.path
      )
    },
    operations: [fetchOp],
    mayFail: true,
    neverRuns: true,
  },
  {
    key: 'core.askPass (a remote that asks for credentials)',
    setup: async f => {
      const url = await remoteThatAsksForCredentials()
      await run(['remote', 'set-url', 'origin', url], f.repo.path)
      const prog = join(f.base, 'askpass.sh')
      await writeFile(prog, `#!/bin/sh\n${marks(f.marker)}\necho x\n`)
      await chmod(prog, 0o755)
      await run(['config', 'core.askPass', shPath(prog)], f.repo.path)
    },
    operations: [plainFetchOp],
    mayFail: true,
    noTrustedProofOnWindows: true,
  },
  {
    key: 'core.gitProxy',
    setup: async f => {
      const prog = join(f.base, 'proxy.sh')
      await script(prog, f.marker)
      await run(['config', 'core.gitProxy', shPath(prog)], f.repo.path)
    },
    operations: [fetchOp],
    mayFail: true,
    noTrustedProofOnWindows: true,
    remoteUrl: 'git://127.0.0.1:1/x.git',
  },
  {
    key: 'remote.origin.uploadpack',
    setup: f =>
      run(
        [
          'config',
          'remote.origin.uploadpack',
          `${marks(f.marker)}; git-upload-pack`,
        ],
        f.repo.path
      ),
    operations: [fetchOp],
    // The file transport is off for an untrusted repository, so a fetch from a local path fails.
    mayFail: true,
  },
  {
    key: 'diff.external',
    setup: async f => {
      const prog = join(f.base, 'ext.sh')
      await script(prog, f.marker)
      await run(['config', 'diff.external', shPath(prog)], f.repo.path)
    },
    operations: [diff],
    neverRuns: true,
  },
  {
    key: 'diff.*.textconv',
    setup: async f => {
      await writeFile(join(f.repo.path, '.gitattributes'), '*.txt diff=evil\n')
      await run(['config', 'diff.evil.textconv', marks(f.marker)], f.repo.path)
    },
    operations: [diff],
    neverRuns: true,
  },
  {
    key: 'filter.*.clean',
    setup: async f => {
      await writeFile(
        join(f.repo.path, '.gitattributes'),
        '*.txt filter=evil\n'
      )
      await run(
        ['config', 'filter.evil.clean', `${marks(f.marker)}; cat`],
        f.repo.path
      )
    },
    operations: [diff, commitOp],
  },
  {
    key: 'filter.*.smudge',
    setup: async f => {
      await writeFile(
        join(f.repo.path, '.gitattributes'),
        '*.txt filter=evil\n'
      )
      await run(
        ['config', 'filter.evil.smudge', `${marks(f.marker)}; cat`],
        f.repo.path
      )
    },
    operations: [checkoutOp],
  },
  {
    key: 'gpg.program',
    setup: async f => {
      await run(['config', 'commit.gpgsign', 'true'], f.repo.path)
      const prog = join(f.base, 'gpg.sh')
      await script(prog, f.marker)
      await run(['config', 'gpg.program', shPath(prog)], f.repo.path)
    },
    operations: [commitOp],
    mayFail: true,
    noTrustedProofOnWindows: true,
  },
  {
    key: 'core.alternateRefsCommand',
    setup: async f => {
      const alternate = join(f.base, 'alternate')
      await mkdir(alternate)
      await run(['init', '-q'], alternate)
      await writeFile(
        join(f.repo.path, '.git', 'objects', 'info', 'alternates'),
        `${shPath(join(alternate, '.git', 'objects'))}\n`
      )
      await run(
        ['config', 'core.alternateRefsCommand', marks(f.marker)],
        f.repo.path
      )
    },
    operations: [fetchOp],
    // The file transport is off for an untrusted repository, so a fetch from a local path fails.
    mayFail: true,
    noTrustedProofOnWindows: true,
  },
  {
    key: 'protocol.ext.allow (an ext:: remote)',
    setup: async f => {
      await run(['config', 'protocol.ext.allow', 'always'], f.repo.path)
      await run(
        ['remote', 'set-url', 'origin', extRemote(f.marker)],
        f.repo.path
      )
    },
    operations: [fetchOp],
    mayFail: true,
    noTrustedProofOnWindows: true,
  },
]

/** Looks at the repository the way the app does and sets its policy. */
async function setPolicy(f: IFixture, trusted: boolean) {
  const findings = await readRepositoryFindings(f.repo.path)
  assert.ok(findings)
  assert.equal(hasFindings(findings), true, 'the plant is found')

  setRepositoryGitPolicy(
    f.repo.path,
    buildRepositoryGitPolicy(trusted ? 'trusted' : 'untrusted', findings)
  )
}

afterEach(async () => {
  // Each test sets its own policy; nothing carries over. The servers a case
  // started for a remote that asks for credentials are closed.
  await Promise.all(
    servers.splice(0).map(s => new Promise<void>(done => s.close(() => done())))
  )
})

describe('repository trust: what an untrusted repository may run', () => {
  for (const v of vectors) {
    for (const op of v.operations) {
      it(`${v.key}: ${op.name} does not run it, and works`, async t => {
        const f = await fixture(t)
        if (v.remoteUrl) {
          await run(['remote', 'set-url', 'origin', v.remoteUrl], f.repo.path)
        }
        await v.setup(f)
        await setPolicy(f, false)
        t.after(() => setRepositoryGitPolicy(f.repo.path, null))

        await removeMarker(f)
        let failure = ''
        const failed = await op.run(f).then(
          () => false,
          e => {
            failure = String(e).slice(0, 200)
            return true
          }
        )

        assert.equal(await exists(f.marker), false, 'the planted command ran')

        // A fetch from a local path fails while untrusted: the file transport is off.
        if (!v.mayFail && op !== fetchOp) {
          assert.equal(failed, false, `the operation failed: ${failure}`)
          await op.worked(f)
        }
      })

      it(`${v.key}: ${op.name} runs it in a trusted repository, as Git does`, async t => {
        if (__WIN32__ && v.noTrustedProofOnWindows) {
          t.skip('Git for Windows does not start this program as a bare script')
          return
        }
        const f = await fixture(t)
        if (v.remoteUrl) {
          await run(['remote', 'set-url', 'origin', v.remoteUrl], f.repo.path)
        }
        await v.setup(f)
        await setPolicy(f, true)
        t.after(() => setRepositoryGitPolicy(f.repo.path, null))

        await removeMarker(f)
        await op.run(f).catch(() => {})

        assert.equal(
          await exists(f.marker),
          !(v.neverRuns || v.neverRunsOn?.includes(op.name)),
          v.neverRuns || v.neverRunsOn?.includes(op.name)
            ? 'the app let it run'
            : 'the vector is not real'
        )
      })
    }
  }
})

describe('repository trust: transport keys', () => {
  for (const [key, value] of [
    ['http.sslVerify', 'false'],
    ['http.proxy', 'http://127.0.0.1:9'],
    ['url.http://127.0.0.1:9/.insteadOf', 'https://example.com/'],
  ]) {
    it(`${key} blocks fetch and push of an untrusted repository, not local work`, async t => {
      const f = await fixture(t)
      await run(['config', key, value], f.repo.path)
      const findings = await readRepositoryFindings(f.repo.path)
      assert.ok(findings)
      setRepositoryGitPolicy(
        f.repo.path,
        buildRepositoryGitPolicy('untrusted', findings)
      )
      t.after(() => setRepositoryGitPolicy(f.repo.path, null))

      await assert.rejects(fetchOp.run(f), RepositoryNetworkBlockedError)
      await assert.rejects(
        git(['push', 'origin', 'main'], f.repo.path, 'test'),
        RepositoryNetworkBlockedError
      )
      await status.worked(f)
    })

    it(`${key} does not block a trusted repository`, async t => {
      const f = await fixture(t)
      await run(['config', key, value], f.repo.path)
      const findings = await readRepositoryFindings(f.repo.path)
      assert.ok(findings)
      setRepositoryGitPolicy(
        f.repo.path,
        buildRepositoryGitPolicy('trusted', findings)
      )
      t.after(() => setRepositoryGitPolicy(f.repo.path, null))

      await fetchOp.run(f)
      await fetchOp.worked(f)
    })
  }
})

describe('repository trust: submodules, protocols and unknown paths', () => {
  it('does not fetch from a local path while untrusted, and does once trusted', async t => {
    const f = await fixture(t)
    await run(['config', 'core.sshCommand', 'ssh -v'], f.repo.path)
    const findings = await readRepositoryFindings(f.repo.path)
    assert.ok(findings)
    t.after(() => setRepositoryGitPolicy(f.repo.path, null))

    setRepositoryGitPolicy(
      f.repo.path,
      buildRepositoryGitPolicy('untrusted', findings)
    )
    await assert.rejects(
      git(['fetch', 'origin'], f.repo.path, 'test').catch(e => {
        // Not blocked by us but by Git: the file transport is not allowed.
        assert.match(String(e), /transport 'file' not allowed/)
        throw e
      })
    )

    setRepositoryGitPolicy(
      f.repo.path,
      buildRepositoryGitPolicy('trusted', findings)
    )
    await fetchOp.run(f)
    await fetchOp.worked(f)
  })

  it('asks about a submodule whose own configuration runs a filter, and runs nothing meanwhile', async t => {
    const f = await fixture(t)
    const sub = join(f.base, 'sub')
    await mkdir(sub)
    await run(['init', '-q', '-b', 'main'], sub)
    await run(['config', 'user.name', 't'], sub)
    await run(['config', 'user.email', 't@example.com'], sub)
    await writeFile(join(sub, '.gitattributes'), '* filter=x\n')
    await writeFile(join(sub, 's.txt'), 'content\n')
    await run(['add', '.'], sub)
    await run(['commit', '-q', '-m', 'sub'], sub)
    await run(
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sm'],
      f.repo.path
    )
    // The submodule's own configuration, in .git/modules/sm/config.
    await run(
      ['config', 'filter.x.clean', `${marks(f.marker)}; cat`],
      join(f.repo.path, 'sm')
    )
    // Stat data that no longer matches the index: Git hashes the file again.
    const file = join(f.repo.path, 'sm', 's.txt')
    await writeFile(file, 'content\n')
    const later = new Date(Date.now() + 60_000)
    await utimes(file, later, later)
    await run(['config', 'filter.x.smudge', 'cat'], join(f.repo.path, 'sm'))

    const findings = await readRepositoryFindings(f.repo.path)
    assert.ok(findings)
    assert.equal(hasFindings(findings), true, 'the submodule is asked about')
    assert.ok(
      describeFindings(findings).some(l => l.startsWith('[submodule ')),
      'the question names the submodule'
    )

    setRepositoryGitPolicy(
      f.repo.path,
      buildRepositoryGitPolicy('untrusted', findings)
    )
    t.after(() => setRepositoryGitPolicy(f.repo.path, null))

    await removeMarker(f)
    const s = await getStatus(f.repo)
    assert.ok(s, 'status still works')
    assert.equal(await exists(f.marker), false, 'the filter did not run')

    await assert.rejects(
      git(['submodule', 'update', '--init'], f.repo.path, 'test'),
      RepositorySubmoduleBlockedError
    )

    // Control: as the Git command line does it, the filter runs.
    setRepositoryGitPolicy(
      f.repo.path,
      buildRepositoryGitPolicy('trusted', findings)
    )
    await removeMarker(f)
    await getStatus(f.repo)
    assert.equal(await exists(f.marker), true, 'the vector is not real')
  })

  it('keeps an untrusted repository out of submodules on status, fetch and pull', async t => {
    const f = await fixture(t)
    const findings = await readRepositoryFindings(f.repo.path)
    assert.ok(findings)
    setRepositoryGitPolicy(
      f.repo.path,
      buildRepositoryGitPolicy('untrusted', findings)
    )
    t.after(() => setRepositoryGitPolicy(f.repo.path, null))

    const args = (a: string[]) => getGitArgumentsFor(f.repo.path, a)
    assert.ok(
      args(['-c', 'x=y', 'status', '--porcelain']).includes(
        '--ignore-submodules=all'
      )
    )
    assert.ok(
      args(['fetch', '--recurse-submodules=on-demand', 'origin']).includes(
        '--no-recurse-submodules'
      )
    )
    assert.ok(
      !args(['fetch', '--recurse-submodules=on-demand', 'origin']).includes(
        '--recurse-submodules=on-demand'
      )
    )
    assert.ok(
      args(['pull', '--recurse-submodules']).includes('--no-recurse-submodules')
    )
    assert.ok(args(['checkout', 'main']).includes('submodule.recurse=false'))
  })

  it('treats protocol.* of the repository as a transport key and limits the protocols', async t => {
    const f = await fixture(t)
    await run(['config', 'protocol.ext.allow', 'always'], f.repo.path)
    const findings = await readRepositoryFindings(f.repo.path)
    assert.ok(findings)
    assert.equal(hasFindings(findings), true, 'the key is asked about')

    const policy = buildRepositoryGitPolicy('untrusted', findings)
    assert.deepEqual(policy.transportKeys, ['protocol.ext.allow'])
    setRepositoryGitPolicy(f.repo.path, policy)
    t.after(() => setRepositoryGitPolicy(f.repo.path, null))

    // The variable alone, without the block, keeps ext:: from running.
    await run(['remote', 'set-url', 'origin', extRemote(f.marker)], f.repo.path)
    const env = getGitEnvironmentFor(f.repo.path, ['fetch'])
    assert.ok(env.GIT_ALLOW_PROTOCOL)
    await removeMarker(f)
    await exec(['fetch', 'origin'], f.repo.path, { env })
    assert.equal(await exists(f.marker), false)
  })

  it('gives a path the app does not know the cautious policy once the app has loaded', () => {
    const unknown = join(process.cwd(), 'not-a-known-repository')
    setFailClosed(true)
    try {
      const args = getGitArgumentsFor(unknown, ['status'])
      assert.ok(args.some(a => a.startsWith('core.hooksPath=')))
      assert.ok(args.includes('core.fsmonitor=false'))
      assert.equal(
        getGitArgumentsFor(unknown, ['clone', 'x', 'y']).some(a =>
          a.startsWith('core.hooksPath=')
        ),
        false,
        'a clone has no repository yet'
      )
    } finally {
      setFailClosed(false)
    }
    assert.equal(
      getGitArgumentsFor(unknown, ['status']).some(a =>
        a.startsWith('core.hooksPath=')
      ),
      false
    )
  })
})
