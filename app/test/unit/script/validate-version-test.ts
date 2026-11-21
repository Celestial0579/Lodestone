import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import * as Path from 'path'
import { versionProblems } from '../../../../script/validate-version'

const lock = (top: unknown, inner: unknown) => ({
  version: top,
  packages: { '': { version: inner } },
})

describe('versionProblems', () => {
  it('agrees when package.json and both places in the lock file hold the version', () => {
    assert.deepEqual(
      versionProblems({ version: '1.0.9' }, lock('1.0.9', '1.0.9')),
      []
    )
  })

  it('names each place of the lock file that is behind', () => {
    assert.deepEqual(
      versionProblems(
        { version: '1.0.9' },
        lock('1.0.9-beta01', '1.0.9-beta01')
      ),
      [
        'package-lock.json version is 1.0.9-beta01, package.json has 1.0.9',
        'package-lock.json packages[""].version is 1.0.9-beta01, package.json has 1.0.9',
      ]
    )
    assert.equal(
      versionProblems({ version: '1.0.9' }, lock('1.0.9', '1.0.8')).length,
      1
    )
  })

  it('reports a lock file without versions and a package.json without one', () => {
    assert.equal(versionProblems({ version: '1.0.9' }, {}).length, 2)
    assert.equal(versionProblems({}, lock('1', '1')).length, 1)
  })

  it('finds the two files of this repository in agreement', () => {
    const read = (name: string) =>
      JSON.parse(
        readFileSync(
          Path.join(__dirname, '..', '..', '..', '..', 'app', name),
          'utf8'
        )
      )
    assert.deepEqual(
      versionProblems(read('package.json'), read('package-lock.json')),
      []
    )
  })
})
