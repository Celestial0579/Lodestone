import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  findUpdateAssets,
  formatReleasesEntry,
  IReleaseAsset,
  isAllowedUpdateURL,
  parseSha256Sums,
} from '../../../src/lib/forges/update-assets'

const sum = (c: string) => c.repeat(64)
const download = 'https://github.com/team/lodestone/releases/download/v1.2.3'
const asset = (name: string, size = 100): IReleaseAsset => ({
  name,
  url: `${download}/${name}`,
  size,
})

describe('findUpdateAssets', () => {
  const pkg = asset('Lodestone-1.2.3-full.nupkg')
  const sums = asset('SHA256SUMS.txt')

  it('finds the full package of the version and the sum file', () => {
    assert.deepEqual(
      findUpdateAssets(
        [asset('LodestoneSetup-x64.exe'), pkg, sums],
        'Lodestone',
        '1.2.3'
      ),
      { package: pkg, sums }
    )
  })

  it('refuses a release without the package of that very version', () => {
    const result = findUpdateAssets(
      [
        asset('Lodestone-1.2.2-full.nupkg'),
        asset('Lodestone-1.2.3-x64-full.nupkg'),
        sums,
      ],
      'Lodestone',
      '1.2.3'
    )
    assert.equal(typeof result, 'string')
  })

  it('refuses a release without a sum file', () => {
    assert.match(
      findUpdateAssets([pkg], 'Lodestone', '1.2.3') as string,
      /SHA256SUMS\.txt/
    )
  })

  it('refuses a package of no size or an implausible one', () => {
    for (const size of [0, -1, 2 * 1024 * 1024 * 1024]) {
      assert.equal(
        typeof findUpdateAssets(
          [asset('Lodestone-1.2.3-full.nupkg', size), sums],
          'Lodestone',
          '1.2.3'
        ),
        'string'
      )
    }
  })
})

describe('parseSha256Sums', () => {
  it('reads the lines sha256sum writes, in either case and line ending', () => {
    const sums = parseSha256Sums(
      `${sum('a')}  LodestoneSetup-x64.exe\r\n${sum(
        'B'
      )} *Lodestone-1.2.3-full.nupkg\n\nnot a line\n`
    )
    assert.equal(sums?.get('LodestoneSetup-x64.exe'), sum('a'))
    assert.equal(sums?.get('Lodestone-1.2.3-full.nupkg'), sum('b'))
    assert.equal(sums?.size, 2)
  })

  it('leaves out a sum of the wrong length', () => {
    assert.equal(parseSha256Sums(`${'a'.repeat(40)}  file`)?.size, 0)
  })

  it('refuses a file listing one name with two sums', () => {
    assert.equal(
      parseSha256Sums(`${sum('a')}  file\n${sum('b')}  file\n`),
      null
    )
  })
})

describe('isAllowedUpdateURL', () => {
  const github = 'https://github.com/team/lodestone'
  const gitea = 'https://git.example.com/team/lodestone'

  it('takes the host of the repository', () => {
    assert.equal(isAllowedUpdateURL(`${download}/x`, github), true)
    assert.equal(
      isAllowedUpdateURL(
        'https://git.example.com/team/lodestone/releases/download/v1/x',
        gitea
      ),
      true
    )
  })

  it("takes GitHub's asset storage, for a repository on github.com only", () => {
    const storage =
      'https://release-assets.githubusercontent.com/github-production-release-asset/1/x'
    assert.equal(isAllowedUpdateURL(storage, github), true)
    assert.equal(
      isAllowedUpdateURL('https://objects.githubusercontent.com/x', github),
      true
    )
    assert.equal(isAllowedUpdateURL(storage, gitea), false)
  })

  it('refuses anything but HTTPS', () => {
    assert.equal(
      isAllowedUpdateURL('http://github.com/team/lodestone/x', github),
      false
    )
    assert.equal(
      isAllowedUpdateURL(`${download}/x`, 'http://github.com/team/lodestone'),
      false
    )
    assert.equal(isAllowedUpdateURL('file:///C:/x.nupkg', github), false)
  })

  it('refuses other hosts, look-alikes and other ports', () => {
    for (const url of [
      'https://evil.example/x',
      'https://github.com.evil.example/x',
      'https://githubusercontent.com.evil.example/x',
      'https://evil.githubusercontent.com/x',
      'https://git.example.com:8443/team/lodestone/x',
    ]) {
      assert.equal(
        isAllowedUpdateURL(url, url.includes('git.example') ? gitea : github),
        false,
        url
      )
    }
  })

  it('refuses credentials in the address and what is no address', () => {
    assert.equal(
      isAllowedUpdateURL('https://user:secret@github.com/x', github),
      false
    )
    assert.equal(isAllowedUpdateURL('not a url', github), false)
  })
})

describe('formatReleasesEntry', () => {
  it('writes the SHA-1 in upper case, the name and the size', () => {
    assert.equal(
      formatReleasesEntry(
        '3aea351e9ac264fdc770438cd1f571dea10300cb',
        'Lodestone-1.0.2-full.nupkg',
        196405645
      ),
      '3AEA351E9AC264FDC770438CD1F571DEA10300CB Lodestone-1.0.2-full.nupkg 196405645'
    )
  })
})
