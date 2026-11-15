import { describe, it } from 'node:test'
import assert from 'node:assert'
import { redactSecrets } from '../../../src/lib/logging/redact-secrets'

const ghToken = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const giteaToken = '0123456789abcdef0123456789abcdef01234567'

describe('redactSecrets', () => {
  it('masks the password in a clone URL, keeping user, host and path', () => {
    assert.equal(
      redactSecrets(
        '`git clone --recursive -- https://alice:s3cr3t@git.example.com/team/repo.git C:\\repo` exited with an unexpected code: 128.'
      ),
      '`git clone --recursive -- https://alice:***@git.example.com/team/repo.git C:\\repo` exited with an unexpected code: 128.'
    )
  })

  it('masks a token given as the whole userinfo', () => {
    assert.equal(
      redactSecrets(
        `fatal: unable to access 'https://${giteaToken}@git.example.com/team/repo.git/'`
      ),
      "fatal: unable to access 'https://***@git.example.com/team/repo.git/'"
    )
  })

  it('keeps a plain user name in a URL', () => {
    const line =
      'ssh://git@git.example.com/team/repo.git and https://alice@host/x'
    assert.equal(redactSecrets(line), line)
  })

  it('masks authorization headers however they are written', () => {
    assert.equal(
      redactSecrets('Authorization: Bearer abc.def.ghi'),
      'Authorization: Bearer ***'
    )
    assert.equal(
      redactSecrets('authorization: token 12345678'),
      'authorization: token ***'
    )
    assert.equal(
      redactSecrets('{"Authorization":"Basic dXNlcjpwYXNz"}'),
      '{"Authorization":"Basic ***"}'
    )
    assert.equal(
      redactSecrets('Proxy-Authorization: Basic dXNlcjpwYXNz'),
      'Proxy-Authorization: Basic ***'
    )
    assert.equal(
      redactSecrets('sent bearer abcdefgh12345678'),
      'sent bearer ***'
    )
  })

  it('masks credentials in a query string and keeps the rest', () => {
    assert.equal(
      redactSecrets('GET https://host/api/v1/user?access_token=abc123&page=2'),
      'GET https://host/api/v1/user?access_token=***&page=2'
    )
    assert.equal(
      redactSecrets(
        'POST /login/oauth/access_token?client_id=x&client_secret=y&code=z'
      ),
      'POST /login/oauth/access_token?client_id=x&client_secret=***&code=z'
    )
    assert.equal(
      redactSecrets('&refresh_token=r1&grant_type=refresh_token'),
      '&refresh_token=***&grant_type=refresh_token'
    )
  })

  it('masks GitHub tokens wherever they appear', () => {
    assert.equal(redactSecrets(`token is ${ghToken}.`), 'token is ***.')
    assert.equal(redactSecrets(`github_pat_${'a1'.repeat(20)}_x`), '***')
  })

  it('leaves an ordinary entry alone', () => {
    const line =
      '2026-11-16T10:00:00.000Z - warn: [updates] failed checking https://github.com/Celestial0579/Lodestone at C:\\Users\\alice\\AppData'
    assert.equal(redactSecrets(line), line)
    const sha = 'commit 3d3c42e5aac5ba805825da76410c181273ba90b1 on main'
    assert.equal(redactSecrets(sha), sha)
  })

  it('masks every occurrence', () => {
    assert.equal(
      redactSecrets('https://a:1@h/x https://b:2@h/y'),
      'https://a:***@h/x https://b:***@h/y'
    )
  })
})
