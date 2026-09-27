import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getUpdateSourceURL,
  isRetiredProjectRepositoryURL,
  parseUpdateSource,
  setUpdateSourceURL,
} from '../../../src/lib/forges/update-source'
import {
  ProjectRepositoryURL,
  RetiredProjectRepositoryURLs,
} from '../../../src/lib/project-links'

/** The localStorage key update-source.ts keeps the chosen repository under. */
const UpdateSourceKey = 'gitea-update-source-url'

describe('parseUpdateSource', () => {
  it('splits a repository URL into instance, owner and name', () => {
    const source = parseUpdateSource('https://git.example.com/team/lodestone')

    assert.deepEqual(source, {
      endpoint: 'https://git.example.com/api/v1',
      owner: 'team',
      name: 'lodestone',
      htmlURL: 'https://git.example.com/team/lodestone',
    })
  })

  it('assumes https when no scheme is given', () => {
    assert.equal(
      parseUpdateSource('git.example.com/team/desktop')?.endpoint,
      'https://git.example.com/api/v1'
    )
  })

  it('accepts a clone URL', () => {
    assert.equal(
      parseUpdateSource('https://git.example.com/team/desktop.git')?.name,
      'desktop'
    )
  })

  it('supports an instance hosted under a sub path', () => {
    const source = parseUpdateSource('https://example.com/gitea/team/desktop')

    assert.equal(source?.endpoint, 'https://example.com/gitea/api/v1')
    assert.equal(source?.owner, 'team')
    assert.equal(source?.name, 'desktop')
  })

  it('keeps a non-default port', () => {
    assert.equal(
      parseUpdateSource('https://git.example.com:3000/team/desktop')?.endpoint,
      'https://git.example.com:3000/api/v1'
    )
  })

  it('returns null when nothing is configured', () => {
    assert.equal(parseUpdateSource(''), null)
    assert.equal(parseUpdateSource('   '), null)
  })

  it('returns null for an address that names no repository', () => {
    assert.equal(parseUpdateSource('https://git.example.com'), null)
    assert.equal(parseUpdateSource('https://git.example.com/team'), null)
  })

  it('asks api.github.com about a repository on github.com', () => {
    const source = parseUpdateSource('https://github.com/team/lodestone')

    assert.deepEqual(source, {
      endpoint: 'https://api.github.com',
      owner: 'team',
      name: 'lodestone',
      htmlURL: 'https://github.com/team/lodestone',
    })
  })

  it('checks the project repository on GitHub by default', () => {
    const source = parseUpdateSource(ProjectRepositoryURL)

    assert.deepEqual(source, {
      endpoint: 'https://api.github.com',
      owner: 'Celestial0579',
      name: 'Lodestone',
      htmlURL: 'https://github.com/Celestial0579/Lodestone',
    })
  })
})

describe('getUpdateSourceURL', () => {
  afterEach(() => localStorage.removeItem(UpdateSourceKey))

  it('falls back to the project repository when nothing is stored', () => {
    localStorage.removeItem(UpdateSourceKey)
    assert.equal(getUpdateSourceURL(), ProjectRepositoryURL)
  })

  it('keeps a repository the user chose', () => {
    setUpdateSourceURL('https://git.example.com/team/lodestone')
    assert.equal(getUpdateSourceURL(), 'https://git.example.com/team/lodestone')
  })

  it('keeps update checks switched off', () => {
    setUpdateSourceURL('')
    assert.equal(getUpdateSourceURL(), '')
  })

  it('reads a stored former project address as the current one', () => {
    for (const retired of RetiredProjectRepositoryURLs) {
      setUpdateSourceURL(retired)
      assert.equal(getUpdateSourceURL(), ProjectRepositoryURL)
    }
  })

  it('recognises a former project address however it was written', () => {
    for (const variant of [
      'https://git.firestrike.de/tim.heyne/Lodestone',
      'https://git.firestrike.de/tim.heyne/Lodestone/',
      'https://git.firestrike.de/tim.heyne/Lodestone.git',
      'git.firestrike.de/tim.heyne/lodestone',
      '  HTTPS://GIT.FIRESTRIKE.DE/tim.heyne/Lodestone  ',
    ]) {
      assert.equal(isRetiredProjectRepositoryURL(variant), true, variant)
    }
  })

  it('does not mistake other repositories on the same host for it', () => {
    assert.equal(
      isRetiredProjectRepositoryURL(
        'https://git.firestrike.de/tim.heyne/Other'
      ),
      false
    )
    assert.equal(
      isRetiredProjectRepositoryURL('https://git.firestrike.de/team/Lodestone'),
      false
    )
    assert.equal(isRetiredProjectRepositoryURL(''), false)
  })
})
