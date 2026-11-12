import assert from 'node:assert'
import { mkdir, writeFile } from 'fs/promises'
import * as path from 'path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { getSHA } from '../../git-info'
import { createTempDirectory } from '../helpers/temp'

describe('getSHA', () => {
  // getSHA prefers this variable to anything it reads, and a build from a
  // source archive, which has no .git to read, sets it. A shell that built the
  // app and then runs the tests still has it, so take it away for the tests
  // that are about reading.
  let circleSHA: string | undefined

  beforeEach(() => {
    circleSHA = process.env.CIRCLE_SHA1
    delete process.env.CIRCLE_SHA1
  })

  afterEach(() => {
    if (circleSHA === undefined) {
      delete process.env.CIRCLE_SHA1
    } else {
      process.env.CIRCLE_SHA1 = circleSHA
    }
  })

  it('takes the commit from CIRCLE_SHA1 where that is set', async t => {
    const directory = await createTempDirectory(t)
    const gitDir = path.join(directory, '.git')

    await mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(
      path.join(gitDir, 'refs', 'heads', 'main'),
      '0123456789abcdef0123456789abcdef01234567\n'
    )

    process.env.CIRCLE_SHA1 = 'fedcba9876543210fedcba9876543210fedcba98'

    assert.equal(getSHA(gitDir), 'fedcba9876543210fedcba9876543210fedcba98')
  })

  it('reads HEAD from a standard .git directory', async t => {
    const directory = await createTempDirectory(t)
    const gitDir = path.join(directory, '.git')
    const sha = '0123456789abcdef0123456789abcdef01234567'

    await mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(gitDir, 'refs', 'heads', 'main'), `${sha}\n`)

    assert.equal(getSHA(gitDir), sha)
  })

  it('reads HEAD from a linked worktree .git file', async t => {
    const directory = await createTempDirectory(t)
    const worktreeDir = path.join(directory, 'worktree')
    const commonGitDir = path.join(directory, 'repo.git')
    const worktreeGitDir = path.join(commonGitDir, 'worktrees', 'desktop-test')
    const sha = '89abcdef0123456789abcdef0123456789abcdef'

    await mkdir(worktreeDir, { recursive: true })
    await mkdir(path.join(worktreeGitDir), { recursive: true })
    await mkdir(path.join(commonGitDir, 'refs', 'heads'), { recursive: true })

    await writeFile(
      path.join(worktreeDir, '.git'),
      'gitdir: ../repo.git/worktrees/desktop-test\n'
    )
    await writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n')
    await writeFile(
      path.join(commonGitDir, 'refs', 'heads', 'main'),
      `${sha}\n`
    )

    assert.equal(getSHA(path.join(worktreeDir, '.git')), sha)
  })

  it('reads packed refs from a linked worktree common git dir', async t => {
    const directory = await createTempDirectory(t)
    const worktreeDir = path.join(directory, 'worktree')
    const commonGitDir = path.join(directory, 'repo.git')
    const worktreeGitDir = path.join(commonGitDir, 'worktrees', 'desktop-test')
    const sha = 'fedcba9876543210fedcba9876543210fedcba98'

    await mkdir(worktreeDir, { recursive: true })
    await mkdir(path.join(worktreeGitDir), { recursive: true })
    await mkdir(commonGitDir, { recursive: true })

    await writeFile(
      path.join(worktreeDir, '.git'),
      'gitdir: ../repo.git/worktrees/desktop-test\n'
    )
    await writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n')
    await writeFile(
      path.join(commonGitDir, 'packed-refs'),
      `${sha} refs/heads/main\n`
    )

    assert.equal(getSHA(path.join(worktreeDir, '.git')), sha)
  })
})
