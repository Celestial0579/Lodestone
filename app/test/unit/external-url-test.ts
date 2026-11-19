import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  describeRefusedAddress,
  getSafeExternalURL,
} from '../../src/lib/external-url'

describe('getSafeExternalURL', () => {
  it('lets web addresses through, in the normalised form', () => {
    assert.equal(
      getSafeExternalURL('https://git.example.com/team/repo/issues/new'),
      'https://git.example.com/team/repo/issues/new'
    )
    assert.equal(
      getSafeExternalURL('http://localhost:3000/a?b=c#d'),
      'http://localhost:3000/a?b=c#d'
    )
    assert.equal(
      getSafeExternalURL('HTTPS://GIT.EXAMPLE.COM/x'),
      'https://git.example.com/x'
    )
  })

  it('refuses the schemes that start a program or reach a share', () => {
    for (const address of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'file://attacker.example/share/x',
      '\\\\attacker.example\\share\\x',
      'smb://attacker.example/share',
      'search-ms:query=x&crumb=location:\\\\attacker.example\\share',
      'ms-msdt:/id PCWDiagnostic /skip force',
      'ms-officecmd:{}',
      'vscode://file/C:/x',
      'x-lodestone-client://oauth?code=x',
      'steam://run/1',
      'mailto:someone@example.com',
      'tel:+4912345',
      'data:text/html,<script>1</script>',
      'ftp://example.com/x',
      'ssh://git@example.com/x',
      'ws://example.com/',
      'blob:https://example.com/uuid',
    ]) {
      assert.equal(getSafeExternalURL(address), null, address)
    }
  })

  it('reads the scheme without regard to case', () => {
    assert.equal(getSafeExternalURL('JavaScript:alert(1)'), null)
    assert.equal(getSafeExternalURL('FILE://attacker.example/x'), null)
    assert.equal(getSafeExternalURL('SMB://attacker.example/x'), null)
  })

  it('refuses leading and trailing white space and control characters', () => {
    for (const address of [
      ' https://example.com/',
      'https://example.com/ ',
      '\thttps://example.com/',
      '\nhttps://example.com/',
      '\u0000https://example.com/',
      '\u0001javascript:alert(1)',
      ' javascript:alert(1)',
      '\u001fjavascript:alert(1)',
      '\u00a0https://example.com/',
      '\u2028https://example.com/',
      'https://example.com/\r\n',
    ]) {
      assert.equal(getSafeExternalURL(address), null, JSON.stringify(address))
    }
  })

  it('refuses a scheme broken up by characters a parser ignores', () => {
    for (const address of [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'fi\rle://attacker.example/x',
      'https://example.com/\tpath',
      'ht\ttps://example.com/',
    ]) {
      assert.equal(getSafeExternalURL(address), null, JSON.stringify(address))
    }
  })

  it('refuses what is not an address', () => {
    for (const address of [
      '',
      'example.com',
      '//example.com/x',
      '/just/a/path',
      'https://',
      'http:',
      'C:\\Windows\\System32\\calc.exe',
    ]) {
      assert.equal(getSafeExternalURL(address), null, address)
    }
  })

  it('opens the normalised address, so the check and the use see the same one', () => {
    // A parser reads this as a host called "path"; that is what is opened.
    assert.equal(getSafeExternalURL('https:///path'), 'https://path/')
  })

  it('refuses what is not a string', () => {
    for (const value of [
      null,
      undefined,
      42,
      {},
      [],
      ['https://example.com/'],
    ]) {
      assert.equal(getSafeExternalURL(value), null)
    }
  })

  it('does not let a web address with a trick in it become another scheme', () => {
    // The scheme is the part before the first colon, whatever follows.
    assert.equal(
      getSafeExternalURL('https://example.com/javascript:alert(1)'),
      'https://example.com/javascript:alert(1)'
    )
    assert.equal(
      getSafeExternalURL('javascript://example.com/%0aalert(1)'),
      null
    )
  })
})

describe('describeRefusedAddress', () => {
  it('names the scheme and nothing of the rest', () => {
    assert.equal(
      describeRefusedAddress('file://attacker.example/share/secret?token=abc'),
      'scheme file:'
    )
    assert.equal(
      describeRefusedAddress('  JavaScript:alert(1)'),
      'scheme javascript:'
    )
  })

  it('says so when there is no scheme or no string', () => {
    assert.equal(describeRefusedAddress('example.com/x'), 'no scheme')
    assert.equal(describeRefusedAddress(42), 'a number')
  })
})
