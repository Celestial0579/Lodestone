import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { exec } from 'dugite'
import { promises as fsPromises } from 'fs'
import { chmod, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../../helpers/temp'
import {
  findNetworkPaths,
  findNetworkPathsUpward,
  hasTrailingDotOrSpace,
  isNetworkPath,
  parseGitFile,
  PathKeys,
  unquoteAlternate,
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
    '\\/host/share',
    '/\\host/share',
    'file://host/share/repo',
    'FILE://host/x',
    '\\??\\UNC\\host\\share',
    '/??/UNC/host/share',
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
    // On Windows the same value can be reported once more by a later check.
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('core.excludesfile'))
    )
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

describe('network paths: gaps found in review (#103)', () => {
  async function repo(t: Parameters<typeof createTempDirectory>[0]) {
    const path = await createTempDirectory(t)
    await exec(['init', '-q', '-b', 'main'], path)
    return path
  }

  it('refuses a config file Git cannot parse, an included one and a submodule one', async t => {
    const path = await repo(t)
    const dir = await createTempDirectory(t)
    // The include comes before the line Git fails on.
    await writeFile(
      join(dir, 'bad'),
      `[include]\n\tpath = //host/share/x\n[core\n`
    )
    await exec(['config', 'include.path', fwd(join(dir, 'bad'))], path)
    const found = await findNetworkPaths(path)
    assert.ok(found.some(l => l.includes('Git cannot parse')))

    const sub = await repo(t)
    await mkdir(join(sub, '.git', 'modules', 'sm'), { recursive: true })
    await writeFile(join(sub, '.git', 'modules', 'sm', 'HEAD'), 'ref: x\n')
    await writeFile(
      join(sub, '.git', 'modules', 'sm', 'config'),
      '[include]\n\tpath = //h/x\n[core\n'
    )
    assert.ok((await findNetworkPaths(sub)).length > 0)
  })

  it('scans a file again when it is reached at a smaller depth', async t => {
    const path = await repo(t)
    const dir = await createTempDirectory(t)
    const f = (n: string) => fwd(join(dir, n))
    // config -> c0 -> ... -> c8 -> X is depth 10: X's own include is out of range.
    for (let i = 0; i < 8; i++) {
      await writeFile(
        join(dir, `c${i}`),
        `[include]\n\tpath = ${f(`c${i + 1}`)}\n`
      )
    }
    await writeFile(join(dir, 'c8'), `[include]\n\tpath = ${f('X')}\n`)
    await writeFile(join(dir, 'X'), `[include]\n\tpath = ${f('Y')}\n`)
    await writeFile(join(dir, 'Y'), '[core]\n\texcludesFile = //host/x\n')
    // First the long chain behind a false condition, then X directly.
    await exec(['config', 'includeIf.onbranch:never.path', f('c0')], path)
    await exec(['config', 'include.path', f('X')], path)
    assert.equal((await findNetworkPaths(path)).length, 1)
  })

  it('decodes quoted alternates the way Git does', async t => {
    assert.equal(unquoteAlternate('"\\057/host"'), '//host')
    assert.equal(unquoteAlternate('"a\\tb"'), 'a\tb')
    assert.equal(unquoteAlternate('"\\134\\134host"'), '\\\\host')
    assert.equal(unquoteAlternate('"bad\\q"'), null)
    assert.equal(unquoteAlternate('"no end'), null)
    assert.equal(unquoteAlternate('plain'), 'plain')

    const path = await repo(t)
    await mkdir(join(path, '.git', 'objects', 'info'), { recursive: true })
    await writeFile(
      join(path, '.git', 'objects', 'info', 'alternates'),
      '"\\057/host/share/objects"\n'
    )
    assert.equal((await findNetworkPaths(path)).length, 1)
  })

  it('refuses a populated submodule whose .git file points to a network path or to a place with one', async t => {
    const path = await repo(t)
    await mkdir(join(path, 'sm'))
    await writeFile(join(path, 'sm', '.git'), 'gitdir: //host/share/evil\n')
    await exec(
      [
        'update-index',
        '--add',
        '--cacheinfo',
        '160000,0123456789012345678901234567890123456789,sm',
      ],
      path
    )
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('network path'))
    )

    // A local target outside the repository is checked as the Git directories are.
    const outside = await createTempDirectory(t)
    await writeFile(join(outside, 'config'), '[core]\n\thooksPath = //host/h\n')
    await writeFile(join(path, 'sm', '.git'), `gitdir: ${fwd(outside)}\n`)
    assert.ok((await findNetworkPaths(path)).length > 0)
  })

  it('follows commondir of a linked work tree and refuses a network one', async t => {
    const main = await repo(t)
    await exec(['config', 'user.name', 't'], main)
    await exec(['config', 'user.email', 't@e.x'], main)
    await exec(['commit', '-q', '--allow-empty', '-m', 'one'], main)
    const linked = join(await createTempDirectory(t), 'linked')
    await exec(['worktree', 'add', '-q', linked], main)
    assert.deepEqual(await findNetworkPaths(linked), [])

    await exec(['config', 'core.excludesFile', '//host/share/ignore'], main)
    assert.equal((await findNetworkPaths(linked)).length, 1)

    await exec(['config', '--unset', 'core.excludesFile'], main)
    const gitFile = await (
      await import('fs/promises')
    ).readFile(join(linked, '.git'), 'utf8')
    const gitDir = gitFile.replace(/^gitdir:\s*/, '').trim()
    await writeFile(join(gitDir, 'commondir'), '//host/share/common\n')
    assert.ok((await findNetworkPaths(linked)).length > 0)
  })

  it('refuses links and junctions where the repository has its own files', async t => {
    const target = await createTempDirectory(t)
    const attempt = async (
      make: (path: string) => Promise<unknown>
    ): Promise<ReadonlyArray<string> | null> => {
      const path = await repo(t)
      try {
        await make(path)
      } catch {
        return null // no permission to make links here
      }
      return findNetworkPaths(path)
    }

    const forms = [
      (path: string) =>
        mkdir(join(path, '.git', 'objects'), { recursive: true }).then(() =>
          symlink(target, join(path, '.git', 'objects', 'info'), 'junction')
        ),
      async (path: string) => {
        const real = join(path, 'realgit')
        await exec(['init', '-q', real], path)
        await (
          await import('fs/promises')
        ).rm(join(path, '.git'), { recursive: true })
        await symlink(join(real, '.git'), join(path, '.git'), 'junction')
      },
      async (path: string) => {
        await writeFile(join(target, 'cfg'), '[core]\n')
        await (await import('fs/promises')).rm(join(path, '.git', 'config'))
        await symlink(join(target, 'cfg'), join(path, '.git', 'config'), 'file')
      },
    ]

    let tried = 0
    for (const make of forms) {
      const found = await attempt(make)
      if (found !== null) {
        tried++
        assert.ok(
          found.some(l => l.includes('link or junction')),
          JSON.stringify(found)
        )
      }
    }
    if (tried === 0) {
      t.skip('this system does not let the test make links')
    }
  })
})

describe('links anywhere in a Git directory (#103)', () => {
  /** Makes a link, or says the system does not allow it here. */
  async function link(
    target: string,
    path: string,
    kind: 'file' | 'junction'
  ): Promise<boolean> {
    try {
      await symlink(target, path, kind)
      return true
    } catch {
      return false
    }
  }

  async function repoWithCommit(t: Parameters<typeof createTempDirectory>[0]) {
    const path = await createTempDirectory(t)
    await exec(['init', '-q', '-b', 'main'], path)
    await exec(['config', 'user.name', 't'], path)
    await exec(['config', 'user.email', 't@e.x'], path)
    await writeFile(join(path, 'a.txt'), 'a\n')
    await exec(['add', '.'], path)
    await exec(['commit', '-q', '-m', 'one'], path)
    return path
  }

  const cases: ReadonlyArray<{
    name: string
    kind: 'file' | 'junction'
    at: (git: string) => string
  }> = [
    { name: '.git/index', kind: 'file', at: g => join(g, 'index') },
    { name: '.git/HEAD', kind: 'file', at: g => join(g, 'HEAD') },
    { name: '.git/refs', kind: 'junction', at: g => join(g, 'refs') },
    {
      name: '.git/info/exclude',
      kind: 'file',
      at: g => join(g, 'info', 'exclude'),
    },
    {
      name: '.git/objects/pack',
      kind: 'junction',
      at: g => join(g, 'objects', 'pack'),
    },
  ]

  for (const c of cases) {
    it(`refuses a link at ${c.name} before any Git call`, async t => {
      const path = await repoWithCommit(t)
      const elsewhere = await createTempDirectory(t)
      const at = c.at(join(path, '.git'))
      await mkdir(join(at, '..'), { recursive: true })
      await rm(at, { recursive: true, force: true })

      if (!(await link(elsewhere, at, c.kind))) {
        return t.skip('this system does not let the test make links')
      }

      const found = await findNetworkPaths(path)
      assert.ok(
        found.some(l => l.includes('link or junction')),
        JSON.stringify(found)
      )
    })
  }

  it('refuses a link where a loose object is', async t => {
    const path = await repoWithCommit(t)
    const objects = join(path, '.git', 'objects')
    const { readdir } = await import('fs/promises')
    const dir = (await readdir(objects)).find(n => /^[0-9a-f]{2}$/.test(n))
    assert.ok(dir)
    const elsewhere = await createTempDirectory(t)
    await rm(join(objects, dir), { recursive: true })

    if (!(await link(elsewhere, join(objects, dir), 'junction'))) {
      return t.skip('this system does not let the test make links')
    }
    assert.ok((await findNetworkPaths(path)).length > 0)
  })

  it('refuses gitdir: lnk/r.git and core.excludesFile = lnk/x when lnk is a link', async t => {
    const elsewhere = await createTempDirectory(t)

    const withGitFile = await createTempDirectory(t)
    await writeFile(join(withGitFile, '.git'), 'gitdir: lnk/r.git\n')
    if (!(await link(elsewhere, join(withGitFile, 'lnk'), 'junction'))) {
      return t.skip('this system does not let the test make links')
    }
    assert.ok(
      (await findNetworkPaths(withGitFile)).some(l =>
        l.includes('link or junction')
      )
    )

    const withKey = await repoWithCommit(t)
    await link(elsewhere, join(withKey, 'lnk'), 'junction')
    await exec(['config', 'core.excludesFile', 'lnk/x'], withKey)
    assert.ok(
      (await findNetworkPaths(withKey)).some(l =>
        l.includes('link or junction')
      )
    )
  })

  it('refuses a hooks directory that goes through a link and one that holds a link', async t => {
    const elsewhere = await createTempDirectory(t)
    const path = await repoWithCommit(t)
    await mkdir(join(path, 'hk'))
    if (!(await link(elsewhere, join(path, 'hk', 'pre-commit'), 'file'))) {
      return t.skip('this system does not let the test make links')
    }
    await exec(['config', 'core.hooksPath', 'hk'], path)
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('link or junction'))
    )
  })
})

describe('files read byte for byte, as Git reads them (#103)', () => {
  async function repo(t: Parameters<typeof createTempDirectory>[0]) {
    const path = await createTempDirectory(t)
    await exec(['init', '-q', '-b', 'main'], path)
    return path
  }

  it('reads a .git file the way Git does', () => {
    assert.equal(parseGitFile('gitdir: evil\n'), 'evil')
    assert.equal(parseGitFile('gitdir: evil\r\n'), 'evil')
    assert.equal(parseGitFile('gitdir:  evil\n'), ' evil')
    assert.equal(parseGitFile('\uFEFFgitdir: evil\n'), null)
    assert.equal(parseGitFile('gitdir:evil'), null)
    assert.equal(parseGitFile('gitdir: a\nb\n'), null)
    assert.equal(parseGitFile('gitdir: \n'), null)
  })

  it('checks the folder a .git file names with a leading space, as Git opens it', async t => {
    const path = await createTempDirectory(t)
    const dir = join(path, ' evil')
    await mkdir(dir)
    await writeFile(join(dir, 'config'), '[core]\n\thooksPath = //host/h\n')
    await writeFile(join(path, '.git'), 'gitdir:  evil\n')
    assert.ok((await findNetworkPaths(path)).length > 0)
  })

  it('follows an alternates line that starts with a space and a hash, as Git does', async t => {
    const path = await repo(t)
    const base = await createTempDirectory(t)
    const entry = join(base, ' #x')
    await mkdir(join(entry, 'info'), { recursive: true })
    await writeFile(join(entry, 'info', 'alternates'), '//host/objects\n')
    await writeFile(
      join(path, '.git', 'objects', 'info', 'alternates'),
      `${fwd(entry)}\n`
    )
    assert.equal((await findNetworkPaths(path)).length, 1)

    // The line itself starts with a space and a hash.
    const relative = ' #y'
    await mkdir(join(path, '.git', 'objects', relative, 'info'), {
      recursive: true,
    })
    await writeFile(
      join(path, '.git', 'objects', relative, 'info', 'alternates'),
      '//host/z\n'
    )
    await writeFile(
      join(path, '.git', 'objects', 'info', 'alternates'),
      `${relative}\n`
    )
    assert.equal((await findNetworkPaths(path)).length, 1)
  })

  it('refuses a commondir with whitespace, a carriage return or a byte order mark', async t => {
    const main = await repo(t)
    await exec(['config', 'user.name', 't'], main)
    await exec(['config', 'user.email', 't@e.x'], main)
    await exec(['commit', '-q', '--allow-empty', '-m', 'one'], main)
    const linked = join(await createTempDirectory(t), 'linked')
    await exec(['worktree', 'add', '-q', linked], main)
    const gitFile = await (
      await import('fs/promises')
    ).readFile(join(linked, '.git'), 'utf8')
    const gitDir = gitFile.replace(/^gitdir:\s*/, '').trim()

    for (const value of [
      ' ../..\n',
      '../.. \n',
      '../..\r\n',
      '\uFEFF../..\n',
    ]) {
      await writeFile(join(gitDir, 'commondir'), value)
      assert.ok(
        (await findNetworkPaths(linked)).some(l =>
          l.includes('commondir is not a plain path')
        ),
        JSON.stringify(value)
      )
    }
  })

  it('looks at the include one past the depth limit before it stops', async t => {
    const path = await repo(t)
    const dir = await createTempDirectory(t)
    const f = (n: number) => fwd(join(dir, `i${n}`))
    for (let i = 1; i <= 10; i++) {
      await writeFile(join(dir, `i${i}`), `[include]\n\tpath = ${f(i + 1)}\n`)
    }
    try {
      await symlink(dir, join(dir, 'i11'), 'junction')
    } catch {
      return t.skip('this system does not let the test make links')
    }
    await exec(['config', 'include.path', f(1)], path)
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('link or junction'))
    )
  })

  it('refuses a directory that cannot be listed', async t => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      return t.skip('needs a user that modes apply to')
    }
    const path = await repo(t)
    const locked = join(path, '.git', 'refs', 'heads')
    await chmod(locked, 0o000)
    t.after(() => chmod(locked, 0o755).catch(() => undefined))
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('cannot be listed'))
    )
  })

  it('knows names that end in a dot or a space', () => {
    assert.equal(hasTrailingDotOrSpace('/a/x.cfg.'), true)
    assert.equal(hasTrailingDotOrSpace('C:\\a\\lnk '), true)
    assert.equal(hasTrailingDotOrSpace('/a/.'), false)
    assert.equal(hasTrailingDotOrSpace('/a/..'), false)
    assert.equal(hasTrailingDotOrSpace('/a/x.cfg'), false)
  })
})

describe('errors other than "not there" (#104)', () => {
  async function repo(t: Parameters<typeof createTempDirectory>[0]) {
    const path = await createTempDirectory(t)
    await exec(['init', '-q', '-b', 'main'], path)
    return path
  }

  /** Makes lstat fail with `code` for a path that ends in `suffix`. */
  function failLstat(suffix: string, code: string) {
    const original = fsPromises.lstat
    return mock.method(fsPromises, 'lstat', async (p: string, ...rest: []) => {
      if (String(p).endsWith(suffix)) {
        throw Object.assign(new Error(code), { code })
      }
      return (original as (...a: unknown[]) => Promise<unknown>)(p, ...rest)
    })
  }

  for (const code of ['EACCES', 'EPERM', 'EBUSY']) {
    it(`refuses a path that lstat could not look at (${code})`, async t => {
      const path = await repo(t)
      const m = failLstat(join('.git', 'objects'), code)
      t.after(() => m.mock.restore())
      const found = await findNetworkPaths(path)
      assert.ok(
        found.some(l => l.includes(`cannot be looked at (${code})`)),
        JSON.stringify(found)
      )
    })
  }

  for (const code of ['ENOENT', 'ENOTDIR']) {
    it(`does not refuse a path that is not there (${code})`, async t => {
      const path = await repo(t)
      const m = failLstat(join('.git', 'config.worktree'), code)
      t.after(() => m.mock.restore())
      assert.deepEqual(await findNetworkPaths(path), [])
    })
  }

  it('refuses a .git entry that lstat could not look at', async t => {
    const path = await repo(t)
    const m = failLstat(`${join(path, '.git')}`, 'EACCES')
    t.after(() => m.mock.restore())
    assert.equal((await findNetworkPaths(path)).length, 1)
  })

  it('refuses a module directory whose HEAD lstat could not look at', async t => {
    const path = await repo(t)
    await mkdir(join(path, '.git', 'modules', 'sm'), { recursive: true })
    const m = failLstat(join('modules', 'sm', 'HEAD'), 'EACCES')
    t.after(() => m.mock.restore())
    assert.ok(
      (await findNetworkPaths(path)).some(l =>
        l.includes('cannot be looked at (EACCES)')
      )
    )
  })

  it('refuses a file that cannot be read', async t => {
    const path = await repo(t)
    await mkdir(join(path, '.git', 'objects', 'info'), { recursive: true })
    await writeFile(join(path, '.git', 'objects', 'info', 'alternates'), 'x\n')
    const original = fsPromises.readFile
    const m = mock.method(
      fsPromises,
      'readFile',
      async (p: string, ...rest: []) => {
        if (String(p).endsWith('alternates')) {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
        }
        return (original as (...a: unknown[]) => Promise<unknown>)(p, ...rest)
      }
    )
    t.after(() => m.mock.restore())
    assert.ok(
      (await findNetworkPaths(path)).some(l =>
        l.includes('cannot be read (EACCES)')
      )
    )
  })

  it('refuses a file that is not valid UTF-8 (.git file, commondir, alternates)', async t => {
    const path = await repo(t)
    await mkdir(join(path, '.git', 'objects', 'info'), { recursive: true })
    await writeFile(
      join(path, '.git', 'objects', 'info', 'alternates'),
      Buffer.from([0x61, 0xff, 0x62, 0x0a])
    )
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('not valid UTF-8'))
    )

    const withFile = await createTempDirectory(t)
    await writeFile(
      join(withFile, '.git'),
      Buffer.from('gitdir: a\xffb\n', 'latin1')
    )
    assert.ok(
      (await findNetworkPaths(withFile)).some(l =>
        l.includes('not valid UTF-8')
      )
    )
  })

  it('refuses an include path with a byte that is not UTF-8, as Git may read another name', async t => {
    const path = await repo(t)
    const dir = await createTempDirectory(t)
    await writeFile(
      join(dir, 'inc'),
      Buffer.from('[include]\n\tpath = j\xe4/x\n', 'latin1')
    )
    await exec(['config', 'include.path', fwd(join(dir, 'inc'))], path)
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('not valid UTF-8'))
    )
  })

  it('refuses a path key and a subsection with such a byte', async t => {
    for (const text of [
      '[core]\n\texcludesFile = j\xe4/x\n',
      '[includeIf "gitdir:j\xe4/"]\n\tpath = /nonexistent/x\n',
      '[url "j\xe4"]\n\tinsteadOf = x\n',
    ]) {
      const path = await repo(t)
      await writeFile(
        join(path, '.git', 'config'),
        Buffer.from(`[core]\n\tbare = false\n${text}`, 'latin1')
      )
      assert.ok(
        (await findNetworkPaths(path)).some(l => l.includes('not valid UTF-8')),
        JSON.stringify(text)
      )
    }
  })

  it('does not refuse a config file Git reads fine: an umlaut in a name, an ANSI comment', async t => {
    const path = await repo(t)
    await writeFile(
      join(path, '.git', 'config'),
      Buffer.from(
        '# J\xfcrgen wrote this\n[core]\n\tbare = false\n[user]\n\tname = J\xfcrgen\n',
        'latin1'
      )
    )
    assert.deepEqual(await findNetworkPaths(path), [])
  })

  it('looks at every path key part by part, a link in a relative value included', async t => {
    const elsewhere = await createTempDirectory(t)
    const keys = [
      ...PathKeys,
      'http.https://example.com/.sslcainfo',
      'http.https://example.com/.sslkey',
      'http.https://example.com/.cookiefile',
    ].filter(k => k !== 'user.signingkey')

    for (const key of keys) {
      const path = await repo(t)
      try {
        await symlink(elsewhere, join(path, 'lnk'), 'junction')
      } catch {
        return t.skip('this system does not let the test make links')
      }
      await exec(['config', key, 'lnk/x'], path)
      assert.ok(
        (await findNetworkPaths(path)).some(l =>
          l.includes('link or junction')
        ),
        key
      )
    }
  })

  it('does not refuse an ordinary URL-scoped key', async t => {
    const path = await repo(t)
    await exec(['config', 'http.https://example.com/.sslVerify', 'true'], path)
    await exec(
      ['config', 'http.https://example.com/.extraHeader', 'X: y'],
      path
    )
    await exec(['config', 'url.https://example.com/.insteadOf', 'ex:'], path)
    await exec(
      ['config', 'lfs.https://example.com/info/lfs.access', 'basic'],
      path
    )
    await exec(
      ['config', 'credential.https://example.com.username', 'me'],
      path
    )
    assert.deepEqual(await findNetworkPaths(path), [])
  })

  it('looks at user.signingkey as a file unless it is a literal key, ids and addresses not refused', async t => {
    const elsewhere = await createTempDirectory(t)
    const path = await repo(t)

    for (const value of [
      'ABCDEF0123456789',
      'me@example.com',
      'Name <me@example.com>',
      'key::ssh-ed25519 AAAA/BBBB',
      'ssh-ed25519 AAAA/BBBB ' + 'x'.repeat(300),
      '~/key',
    ]) {
      await exec(['config', 'user.signingkey', value], path)
      assert.deepEqual(await findNetworkPaths(path), [], value)
    }

    await exec(['config', 'http.pinnedPubKey', 'sha256//abc/def'], path)
    assert.deepEqual(await findNetworkPaths(path), [])

    // A junction named like a key id, and one under a name that starts like a type.
    for (const [value, name] of [
      ['id_key', 'id_key'],
      ['ecdsa-lnk/key', 'ecdsa-lnk'],
      ['sk-lnk/key', 'sk-lnk'],
      ['lnk/id_key', 'lnk'],
    ]) {
      const withLink = await repo(t)
      try {
        await symlink(elsewhere, join(withLink, name), 'junction')
      } catch {
        return t.skip('this system does not let the test make links')
      }
      await exec(['config', 'user.signingkey', value], withLink)
      assert.ok(
        (await findNetworkPaths(withLink)).some(l =>
          l.includes('link or junction')
        ),
        value
      )
    }
  })

  it('refuses a diff.orderFile that goes through a junction', async t => {
    const elsewhere = await createTempDirectory(t)
    const path = await repo(t)
    try {
      await symlink(elsewhere, join(path, 'lnk'), 'junction')
    } catch {
      return t.skip('this system does not let the test make links')
    }
    await exec(['config', 'diff.orderFile', 'lnk/order'], path)
    assert.ok(
      (await findNetworkPaths(path)).some(l => l.includes('link or junction'))
    )
  })
})
