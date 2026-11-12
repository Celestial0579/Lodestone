import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  matchGitHubRepository,
  urlMatchesRemote,
  urlMatchesCloneURL,
} from '../../src/lib/repository-matching'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

describe('repository-matching', () => {
  describe('matchGitHubRepository', () => {
    it('matches HTTPS URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches HTTPS URLs without the git extension', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches git URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'git:github.com/someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches SSH URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'git@github.com:someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    describe('with a port in the address of the instance', () => {
      const accountAt = (endpoint: string, login = 'alovelace') =>
        new Account(login, endpoint, '', [], '', 1, '', 'free')

      it('matches an HTTP remote on the same port', () => {
        // Gitea and Forgejo listen on 3000 unless told otherwise.
        const repo = matchGitHubRepository(
          [accountAt('http://localhost:3000/api/v1')],
          'http://localhost:3000/wt/repo.git'
        )
        assert(repo !== null)
        assert.equal(repo.owner, 'wt')
        assert.equal(repo.name, 'repo')
      })

      it('tells two instances on one machine apart', () => {
        const gitea = accountAt('https://git.example.com:3000/api/v1', 'a')
        const forgejo = accountAt('https://git.example.com:3001/api/v1', 'b')

        const repo = matchGitHubRepository(
          [gitea, forgejo],
          'https://git.example.com:3001/team/app.git'
        )
        assert.equal(repo?.account, forgejo)
      })

      it(`doesn't match a remote on another port`, () => {
        const accounts = [accountAt('http://localhost:3000/api/v1')]

        assert.equal(
          matchGitHubRepository(accounts, 'http://localhost:3001/wt/repo.git'),
          null
        )
        assert.equal(
          matchGitHubRepository(accounts, 'http://localhost/wt/repo.git'),
          null
        )
      })

      it('matches a default port that is written out', () => {
        const repo = matchGitHubRepository(
          [accountAt('https://git.example.com/api/v1')],
          'https://git.example.com:443/team/app.git'
        )
        assert(repo !== null)
      })

      it('matches an SSH remote, whose port is not that of the web', () => {
        const accounts = [accountAt('https://git.example.com:3000/api/v1')]

        assert(
          matchGitHubRepository(
            accounts,
            'git@git.example.com:team/app.git'
          ) !== null
        )
        assert(
          matchGitHubRepository(
            accounts,
            'ssh://git@git.example.com:2222/team/app.git'
          ) !== null
        )
      })

      it('does not hold http against https where neither names a port', () => {
        const repo = matchGitHubRepository(
          [accountAt('https://git.example.com/api/v1')],
          'http://git.example.com/team/app.git'
        )
        assert(repo !== null)
      })
    })

    it(`doesn't match if there aren't any users with that endpoint`, () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://github.babbageinc.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo.git'
      )
      assert(repo === null)
    })
  })

  describe('urlMatchesRemote', () => {
    describe('with HTTPS remote', () => {
      const remote = {
        name: 'origin',
        url: 'https://github.com/shiftkey/desktop',
      }
      const remoteWithSuffix = {
        name: 'origin',
        url: 'https://github.com/shiftkey/desktop.git',
      }

      it('does not match null', () => {
        assert(!urlMatchesRemote(null, remoteWithSuffix))
      })

      it('matches cloneURL from API', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remoteWithSuffix))
      })

      it('matches cloneURL from API with different casing', () => {
        const cloneURL = 'https://GITHUB.COM/SHIFTKEY/DESKTOP.git'
        assert(urlMatchesRemote(cloneURL, remoteWithSuffix))
      })

      it('matches cloneURL from API without suffix', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remote))
      })

      it('matches htmlURL from API', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remoteWithSuffix))
      })

      it('matches htmlURL from API with different casing', () => {
        const htmlURL = 'https://GITHUB.COM/SHIFTKEY/DESKTOP'
        assert(urlMatchesRemote(htmlURL, remoteWithSuffix))
      })

      it('matches htmlURL from API without suffix', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remote))
      })
    })

    describe('with SSH remote', () => {
      const remote = {
        name: 'origin',
        url: 'git@github.com:shiftkey/desktop.git',
      }
      it('does not match null', () => {
        assert(!urlMatchesRemote(null, remote))
      })

      it('matches cloneURL from API', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remote))
      })

      it('matches htmlURL from API', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remote))
      })
    })
  })

  describe('cloneUrlMatches', () => {
    const repository = gitHubRepoFixture({
      name: 'desktop',
      owner: 'shiftkey',
      isPrivate: false,
    })

    const repositoryWithoutCloneURL: GitHubRepository = {
      dbID: 1,
      name: 'desktop',
      fullName: 'shiftkey/desktop',
      cloneURL: null,
      owner: {
        login: 'shiftkey',
        id: 1234,
        endpoint: 'https://api.github.com/',
      },
      isPrivate: false,
      htmlURL: 'https://github.com/shiftkey/desktop',
      parent: null,
      endpoint: 'https://api.github.com/',
      fork: true,
      hash: 'whatever',
      issuesEnabled: true,
      isArchived: false,
      permissions: null,
    }

    it('returns true for exact match', () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/shiftkey/desktop.git',
          repository
        ),
        true
      )
    })

    it(`returns true when URL doesn't have a .git suffix`, () => {
      assert.equal(
        urlMatchesCloneURL('https://github.com/shiftkey/desktop', repository),
        true
      )
    })

    it(`returns false when URL belongs to a different owner`, () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/outofambit/desktop.git',
          repository
        ),
        false
      )
    })

    it(`returns false if GitHub repository does't have a cloneURL set`, () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/shiftkey/desktop',
          repositoryWithoutCloneURL
        ),
        false
      )
    })
  })
})
