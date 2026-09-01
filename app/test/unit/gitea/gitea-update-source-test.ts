import { describe, it } from 'node:test'
import assert from 'node:assert'
import { parseGiteaUpdateSource } from '../../../src/lib/gitea/gitea-updates'

describe('parseGiteaUpdateSource', () => {
  it('splits a repository URL into instance, owner and name', () => {
    const source = parseGiteaUpdateSource(
      'https://git.example.com/team/gitea-desktop'
    )

    assert.deepEqual(source, {
      endpoint: 'https://git.example.com/api/v1',
      owner: 'team',
      name: 'gitea-desktop',
      htmlURL: 'https://git.example.com/team/gitea-desktop',
    })
  })

  it('assumes https when no scheme is given', () => {
    assert.equal(
      parseGiteaUpdateSource('git.example.com/team/desktop')?.endpoint,
      'https://git.example.com/api/v1'
    )
  })

  it('accepts a clone URL', () => {
    assert.equal(
      parseGiteaUpdateSource('https://git.example.com/team/desktop.git')?.name,
      'desktop'
    )
  })

  it('supports an instance hosted under a sub path', () => {
    const source = parseGiteaUpdateSource(
      'https://example.com/gitea/team/desktop'
    )

    assert.equal(source?.endpoint, 'https://example.com/gitea/api/v1')
    assert.equal(source?.owner, 'team')
    assert.equal(source?.name, 'desktop')
  })

  it('keeps a non-default port', () => {
    assert.equal(
      parseGiteaUpdateSource('https://git.example.com:3000/team/desktop')
        ?.endpoint,
      'https://git.example.com:3000/api/v1'
    )
  })

  it('returns null when nothing is configured', () => {
    assert.equal(parseGiteaUpdateSource(''), null)
    assert.equal(parseGiteaUpdateSource('   '), null)
  })

  it('returns null for an address that names no repository', () => {
    assert.equal(parseGiteaUpdateSource('https://git.example.com'), null)
    assert.equal(parseGiteaUpdateSource('https://git.example.com/team'), null)
  })
})
