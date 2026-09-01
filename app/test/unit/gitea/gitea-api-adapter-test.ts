import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  normalizePayload,
  translateQuery,
} from '../../../src/lib/gitea/gitea-api-adapter'

const htmlBase = 'https://git.example.com'

describe('gitea api adapter', () => {
  describe('translateQuery', () => {
    it('renames per_page, which Gitea does not read', () => {
      assert.equal(translateQuery('per_page=100'), '?limit=100')
    })

    it('keeps other parameters', () => {
      const result = new URLSearchParams(
        translateQuery('per_page=50&state=open').substring(1)
      )

      assert.equal(result.get('limit'), '50')
      assert.equal(result.get('state'), 'open')
      assert.equal(result.get('per_page'), null)
    })

    it('drops the protected filter, which is applied client side', () => {
      assert.equal(translateQuery('protected=true'), '')
    })

    it('leaves an empty query alone', () => {
      assert.equal(translateQuery(''), '')
    })
  })

  describe('normalizePayload', () => {
    it('gives a repository the pushed_at the app sorts by', () => {
      const repo = normalizePayload(
        {
          clone_url: 'https://git.example.com/team/desktop.git',
          updated_at: '2026-01-02T03:04:05Z',
        },
        htmlBase
      )

      assert.equal(repo.pushed_at, '2026-01-02T03:04:05Z')
    })

    it('does not overwrite a repository name with a display name', () => {
      const repo = normalizePayload(
        {
          clone_url: 'https://git.example.com/team/desktop.git',
          name: 'desktop',
          full_name: 'team/desktop',
        },
        htmlBase
      )

      assert.equal(repo.name, 'desktop')
    })

    it('gives a user the display name the app reads', () => {
      const user = normalizePayload(
        { login: 'tim', full_name: 'Tim Example' },
        htmlBase
      )

      assert.equal(user.name, 'Tim Example')
      assert.equal(user.type, 'User')
    })

    it('falls back to the login when a user has no full name', () => {
      const user = normalizePayload({ login: 'tim', full_name: '' }, htmlBase)
      assert.equal(user.name, 'tim')
    })

    it('gives an organisation the login the app looks it up by', () => {
      // Gitea names organisations `username` and gives them no login at all.
      const org = normalizePayload(
        { username: 'team', full_name: 'The Team', id: 3 },
        htmlBase
      )

      assert.equal(org.login, 'team')
      assert.equal(org.type, 'Organization')
      assert.equal(org.html_url, 'https://git.example.com/team')
    })

    it('renames a commit status state', () => {
      // Gitea calls the field `status`, the app and GitHub call it `state`.
      const status = normalizePayload(
        { context: 'ci/build', status: 'success' },
        htmlBase
      )

      assert.equal(status.state, 'success')
    })

    it('maps the two states the app has no equivalent for', () => {
      const warning = normalizePayload(
        { context: 'ci/lint', status: 'warning' },
        htmlBase
      )
      const skipped = normalizePayload(
        { context: 'ci/test', status: 'skipped' },
        htmlBase
      )

      assert.equal(warning.state, 'failure')
      assert.equal(skipped.state, 'success')
    })

    it('normalises a combined status and its items', () => {
      const combined = normalizePayload(
        {
          state: 'warning',
          sha: 'abc',
          statuses: [{ context: 'ci/build', status: 'skipped' }],
        },
        htmlBase
      )

      assert.equal(combined.state, 'failure')
      assert.equal(combined.statuses[0].state, 'success')
    })

    it('reaches into nested payloads such as a pull request', () => {
      const pr = normalizePayload(
        {
          number: 7,
          user: { login: 'tim', full_name: 'Tim Example' },
          head: {
            ref: 'topic',
            repo: {
              clone_url: 'https://git.example.com/tim/desktop.git',
              updated_at: '2026-01-02T03:04:05Z',
            },
          },
        },
        htmlBase
      )

      assert.equal(pr.user.name, 'Tim Example')
      assert.equal(pr.head.repo.pushed_at, '2026-01-02T03:04:05Z')
    })

    it('passes through values it does not recognise', () => {
      assert.equal(normalizePayload(null, htmlBase), null)
      assert.equal(normalizePayload('text', htmlBase), 'text')
      assert.deepEqual(normalizePayload([1, 2], htmlBase), [1, 2])
    })
  })
})
