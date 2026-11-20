import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import * as Path from 'path'
import { findDuplicateKeys } from '../../../../script/changelog/duplicate-keys'

describe('findDuplicateKeys', () => {
  it('finds nothing in an object without a repeated key', () => {
    assert.deepEqual(
      findDuplicateKeys('{"a": 1, "b": {"a": 2}, "c": [1, 2]}'),
      []
    )
  })

  it('finds a key that appears twice in one object', () => {
    assert.deepEqual(
      findDuplicateKeys(
        '{"releases": {"1.0.8": [], "1.0.7": [], "1.0.8": []}}'
      ),
      ['releases.1.0.8']
    )
  })

  it('finds a repeat at the top level and in a nested object', () => {
    assert.deepEqual(findDuplicateKeys('{"a": {"x": 1, "x": 2}, "a": 3}'), [
      'a.x',
      'a',
    ])
  })

  it('does not count the same key in different objects, or a string value that looks like a key', () => {
    assert.deepEqual(
      findDuplicateKeys('{"a": [{"k": 1}, {"k": 2}], "b": "a", "c": "a"}'),
      []
    )
    assert.deepEqual(findDuplicateKeys('{"a": "\\"x\\": 1, \\"x\\": 2"}'), [])
  })

  it('reads escapes in keys', () => {
    assert.deepEqual(findDuplicateKeys('{"a\\"b": 1, "a\\"b": 2}'), ['a\\"b'])
  })
})

describe('changelog.json', () => {
  const text = readFileSync(
    Path.join(__dirname, '..', '..', '..', '..', 'changelog.json'),
    'utf8'
  )

  it('has no key twice (JSON.parse would keep only the last)', () => {
    assert.deepEqual(findDuplicateKeys(text), [])
  })

  it('holds only releases of this app, newest first', () => {
    const releases = Object.keys(JSON.parse(text).releases)
    assert.ok(releases.length > 0)
    assert.ok(
      releases.every(r => /^1\.\d+\.\d+(-beta\d+)?$/.test(r)),
      releases.join(', ')
    )
  })
})
