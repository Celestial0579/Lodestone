import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ForgeFamily,
  ForgeKind,
  getForgeDisplayName,
  getForgeFamily,
  guessGiteaKindFromVersion,
} from '../../../src/lib/forges/forge-type'

describe('forge type', () => {
  describe('getForgeFamily', () => {
    it('reads the Gitea family off the api path', () => {
      assert.equal(
        getForgeFamily('https://git.example.com/api/v1'),
        ForgeFamily.Gitea
      )
    })

    it('covers an instance under a sub path', () => {
      assert.equal(
        getForgeFamily('https://example.com/gitea/api/v1'),
        ForgeFamily.Gitea
      )
    })

    it('treats GitHub endpoints as the GitHub family', () => {
      assert.equal(getForgeFamily('https://api.github.com'), ForgeFamily.GitHub)
      assert.equal(
        getForgeFamily('https://github.example.com/api/v3'),
        ForgeFamily.GitHub
      )
    })

    it('falls back to the GitHub shape for nonsense, without throwing', () => {
      // That is what the unmodified upstream code assumes, so it is the safe
      // default for a string we cannot make sense of.
      assert.equal(getForgeFamily('not a url'), ForgeFamily.GitHub)
      assert.equal(getForgeFamily(''), ForgeFamily.GitHub)
    })
  })

  describe('guessGiteaKindFromVersion', () => {
    it('recognises Forgejo by its compatibility suffix', () => {
      // Codeberg reported exactly this on 2026-09-02.
      assert.equal(
        guessGiteaKindFromVersion('16.0.0-dev-714-11075108+gitea-1.22.0'),
        ForgeKind.Forgejo
      )
    })

    it('recognises Forgejo by its major version', () => {
      assert.equal(guessGiteaKindFromVersion('12.0.1'), ForgeKind.Forgejo)
    })

    it('recognises Gitea', () => {
      assert.equal(guessGiteaKindFromVersion('1.27.3'), ForgeKind.Gitea)
      assert.equal(
        guessGiteaKindFromVersion('1.27.0+dev-954-g1f3981a301'),
        ForgeKind.Gitea
      )
    })

    it('admits when it cannot tell', () => {
      assert.equal(guessGiteaKindFromVersion(null), ForgeKind.Unknown)
      assert.equal(guessGiteaKindFromVersion(''), ForgeKind.Unknown)
      assert.equal(guessGiteaKindFromVersion('unstable'), ForgeKind.Unknown)
    })
  })

  describe('getForgeDisplayName', () => {
    it('names the products', () => {
      assert.equal(getForgeDisplayName(ForgeKind.Gitea), 'Gitea')
      assert.equal(getForgeDisplayName(ForgeKind.Forgejo), 'Forgejo')
      assert.equal(getForgeDisplayName(ForgeKind.DotCom), 'GitHub')
      assert.equal(getForgeDisplayName(ForgeKind.GHES), 'GitHub Enterprise')
    })

    it('stays vague rather than guessing wrong', () => {
      assert.equal(getForgeDisplayName(ForgeKind.Unknown), 'the server')
    })
  })
})
