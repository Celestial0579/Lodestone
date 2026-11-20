import { describe, it } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'crypto'
import { getEmailAvatarUrl } from '../../../src/ui/lib/avatar'

const hash = createHash('md5').update('a@example.com').digest('hex')

describe('getEmailAvatarUrl for a Gitea instance', () => {
  it('asks the root of an instance that has no sub path', () => {
    const url = getEmailAvatarUrl(
      'https://git.example.com/api/v1',
      'A@Example.com '
    )
    assert.equal(url?.toString(), `https://git.example.com/avatar/${hash}`)
  })

  it('keeps the sub path of an instance under one', () => {
    const url = getEmailAvatarUrl(
      'https://example.com/gitea/api/v1',
      'a@example.com'
    )
    assert.equal(url?.toString(), `https://example.com/gitea/avatar/${hash}`)
  })
})
