import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../src/models/repository'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import {
  getIssueCreationURL,
  getRepositoryWebURL,
} from '../../src/lib/repository-web-urls'
import { getRepoIssuesEnabled } from '../../src/lib/menu-update'
import { getKnownForge } from '../../src/lib/forges/forge-registry'
import { ForgeKind, getForgeDisplayName } from '../../src/lib/forges/forge-type'

/**
 * A repository linked to a forge from its remote alone, as it is before the
 * forge has answered or when a refresh failed: no address, nothing known about
 * issues (#83).
 */
function linkedRepository(
  endpoint: string,
  htmlURL: string | null,
  issuesEnabled: boolean | null = null
) {
  const gitHubRepository = new GitHubRepository(
    'lodestone',
    new Owner('team', endpoint, 1),
    1,
    null,
    htmlURL,
    null,
    issuesEnabled
  )
  return new Repository('/some/path', 1, gitHubRepository, false)
}

describe('getRepositoryWebURL', () => {
  it('uses the address the forge reported', () => {
    const repository = linkedRepository(
      'https://api.github.com',
      'https://github.com/team/lodestone'
    )
    assert.equal(
      getRepositoryWebURL(repository),
      'https://github.com/team/lodestone'
    )
  })

  it('builds the address of a github.com repository that has none stored', () => {
    const repository = linkedRepository('https://api.github.com', null)
    assert.equal(
      getRepositoryWebURL(repository),
      'https://github.com/team/lodestone'
    )
  })

  it('builds the address of a Gitea or Forgejo repository that has none stored', () => {
    const repository = linkedRepository('https://git.example.com/api/v1', null)
    assert.equal(
      getRepositoryWebURL(repository),
      'https://git.example.com/team/lodestone'
    )
  })

  it('has none for a repository that is not linked to a forge', () => {
    assert.equal(
      getRepositoryWebURL(new Repository('/some/path', 1, null, false)),
      null
    )
  })
})

describe('getIssueCreationURL', () => {
  it('opens the new issue form, which Gitea and Forgejo have as well', () => {
    assert.equal(
      getIssueCreationURL(linkedRepository('https://api.github.com', null)),
      'https://github.com/team/lodestone/issues/new'
    )
    assert.equal(
      getIssueCreationURL(
        linkedRepository('https://git.example.com/api/v1', null)
      ),
      'https://git.example.com/team/lodestone/issues/new'
    )
  })

  it('has none for a repository that is not linked to a forge', () => {
    assert.equal(
      getIssueCreationURL(new Repository('/some/path', 1, null, false)),
      null
    )
  })
})

describe('the menu item to create an issue', () => {
  it('is on for a linked repository whose address is not stored yet', () => {
    assert.equal(
      getRepoIssuesEnabled(linkedRepository('https://api.github.com', null)),
      true
    )
  })

  it('is off when issues are switched off for the repository', () => {
    assert.equal(
      getRepoIssuesEnabled(
        linkedRepository(
          'https://api.github.com',
          'https://github.com/team/lodestone',
          false
        )
      ),
      false
    )
  })

  it('is off for a repository that is not linked to a forge', () => {
    assert.equal(
      getRepoIssuesEnabled(new Repository('/some/path', 1, null, false)),
      false
    )
  })
})

describe('the name of the host in the menu', () => {
  it('is GitHub for github.com, with nothing learned about it yet', () => {
    const { kind } = getKnownForge('https://api.github.com')
    assert.equal(kind, ForgeKind.DotCom)
    assert.equal(getForgeDisplayName(kind), 'GitHub')
  })

  it('stays vague for an instance nothing is known about', () => {
    const { kind } = getKnownForge('https://git.example.com/api/v1')
    assert.equal(kind, ForgeKind.Unknown)
  })
})
