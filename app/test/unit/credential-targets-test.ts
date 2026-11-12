import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  parseCredentialTargets,
  splitCredentialTarget,
} from '../../src/lib/credential-targets'

// What an English Windows prints, as far as its form is known. Not captured.
const english = [
  '',
  'Currently stored credentials:',
  '',
  '    Target: LegacyGeneric:target=Lodestone - https://git.example.com/api/v1/alice',
  '    Type: Generic ',
  '    User: alice',
  '    ',
  '    Target: LegacyGeneric:target=git:https://github.com',
  '    Type: Generic ',
  '    User: PersonalAccessToken',
  '    ',
  '    Target: Domain:target=fileserver',
  '    Type: Domain Password',
  '    User: EXAMPLE\\alice',
  '',
].join('\r\n')

// Captured from `cmdkey /list` on a German Windows 11 with one account signed
// in to a Gitea on port 3000, the name of the device account replaced. The
// second entry of the app is added in its form.
const german = [
  '',
  'Momentan gespeicherte Anmeldeinformationen:',
  '',
  '    Ziel: MicrosoftAccount:target=SSO_POP_Device',
  '    Typ: Allgemeine ',
  '    Benutzer: 02abcdefghijklmn',
  '    Nur für diese Sitzung gespeichert',
  '',
  '    Ziel: WindowsLive:target=virtualapp/didlogical',
  '    Typ: Allgemeine ',
  '    Benutzer: 02abcdefghijklmn',
  '    Beständigkeit des lokalen Computers',
  '',
  '    Ziel: LegacyGeneric:target=Lodestone - http://localhost:3000/api/v1/wt',
  '    Typ: Allgemeine ',
  '    Benutzer: wt',
  '    ',
  '    Ziel: LegacyGeneric:target=Lodestone Dev - http://localhost:3000/api/v1/wt',
  '    Typ: Allgemeine ',
  '    Benutzer: wt',
  '    ',
].join('\r\n')

describe('parseCredentialTargets', () => {
  it('finds the entries carrying the prefix', () => {
    assert.deepEqual(parseCredentialTargets(english, 'Lodestone - '), [
      'Lodestone - https://git.example.com/api/v1/alice',
    ])
  })

  it('does not depend on the language Windows speaks', () => {
    assert.deepEqual(parseCredentialTargets(german, 'Lodestone - '), [
      'Lodestone - http://localhost:3000/api/v1/wt',
    ])
  })

  it('leaves the entries of a development build to that build', () => {
    assert.deepEqual(parseCredentialTargets(german, 'Lodestone Dev - '), [
      'Lodestone Dev - http://localhost:3000/api/v1/wt',
    ])
  })

  it('takes nothing that is not a generic credential', () => {
    assert.deepEqual(parseCredentialTargets(english, 'fileserver'), [])
    assert.deepEqual(parseCredentialTargets(german, 'SSO_'), [])
  })

  it('keeps a name as it is, spaces inside it included', () => {
    const output =
      '    Target: LegacyGeneric:target=Lodestone - https://git.example.com/a b  \n'

    assert.deepEqual(parseCredentialTargets(output, 'Lodestone - '), [
      'Lodestone - https://git.example.com/a b',
    ])
  })

  it('finds nothing in an empty list', () => {
    assert.deepEqual(parseCredentialTargets('', 'Lodestone - '), [])
    assert.deepEqual(
      parseCredentialTargets(
        '\r\nCurrently stored credentials:\r\n\r\n* NONE *\r\n',
        'Lodestone - '
      ),
      []
    )
  })
})

describe('splitCredentialTarget', () => {
  it('gives keytar two parts that make the name again', () => {
    // keytar joins a key and a login with a slash and deletes by the result.
    const target = 'Lodestone - http://localhost:3000/api/v1/wt'
    const parts = splitCredentialTarget(target)

    assert.deepEqual(parts, {
      key: 'Lodestone - http://localhost:3000/api/v1',
      login: 'wt',
    })
    assert.equal(`${parts?.key}/${parts?.login}`, target)
  })

  it('keeps a login with a space in it', () => {
    assert.deepEqual(
      splitCredentialTarget('Lodestone - https://git.example.com/api/v1/a b'),
      { key: 'Lodestone - https://git.example.com/api/v1', login: 'a b' }
    )
  })

  it('makes nothing of a name keytar did not write', () => {
    assert.strictEqual(splitCredentialTarget('Lodestone - no slash'), null)
  })
})
