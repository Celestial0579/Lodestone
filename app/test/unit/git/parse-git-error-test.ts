import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitError as DugiteError } from 'dugite'
import { parseGitError } from '../../../src/lib/git/parse-git-error'

describe('parseGitError', () => {
  it('knows a folder that is not a repository', () => {
    assert.strictEqual(
      parseGitError(
        'fatal: not a git repository (or any of the parent directories): .git\n'
      ),
      DugiteError.NotAGitRepository
    )
  })

  it('knows it at the boundary of a filesystem as well', () => {
    // What git 2.53.0 said in a temp folder on a tmpfs, where two tests
    // expected an empty list and got an unclassified failure thrown at them.
    assert.strictEqual(
      parseGitError(
        'fatal: not a git repository (or any parent up to mount point /)\n' +
          'Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\n'
      ),
      DugiteError.NotAGitRepository
    )
    assert.strictEqual(
      parseGitError(
        'fatal: not a git repository (or any parent up to mount point /Volumes/Work)\n'
      ),
      DugiteError.NotAGitRepository
    )
  })

  it('leaves the errors dugite knows as they are', () => {
    assert.strictEqual(
      parseGitError("fatal: A branch named 'main' already exists.\n"),
      DugiteError.BranchAlreadyExists
    )
  })

  it('makes nothing of what is not an error it knows', () => {
    assert.strictEqual(parseGitError(''), null)
    assert.strictEqual(parseGitError('Already up to date.\n'), null)
  })
})
