import { describe, it } from 'node:test'
import assert from 'node:assert'
import { parseCredentialTargets } from '../../src/lib/credential-targets'

const english = [
  '',
  'Currently stored credentials:',
  '',
  '    Target: LegacyGeneric:target=Lodestone - https://git.example.com/alice',
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

const german = [
  '',
  'Aktuell gespeicherte Anmeldeinformationen:',
  '',
  '    Ziel: LegacyGeneric:target=Lodestone - http://localhost:3000/wt',
  '    Typ: Generisch ',
  '    Benutzer: wt',
  '    ',
  '    Ziel: LegacyGeneric:target=Lodestone Dev - http://localhost:3000/wt',
  '    Typ: Generisch ',
  '    Benutzer: wt',
  '    ',
  '    Ziel: MicrosoftAccount:target=SSO_POP_Device',
  '    Typ: Generisch ',
  '    Benutzer: 02abcdefghijklmn',
  '    Nur für diese Anmeldesitzung gespeichert',
  '',
].join('\r\n')

describe('parseCredentialTargets', () => {
  it('finds the entries carrying the prefix', () => {
    assert.deepEqual(parseCredentialTargets(english, 'Lodestone - '), [
      'Lodestone - https://git.example.com/alice',
    ])
  })

  it('does not depend on the language Windows speaks', () => {
    assert.deepEqual(parseCredentialTargets(german, 'Lodestone - '), [
      'Lodestone - http://localhost:3000/wt',
    ])
  })

  it('leaves the entries of a development build to that build', () => {
    assert.deepEqual(parseCredentialTargets(german, 'Lodestone Dev - '), [
      'Lodestone Dev - http://localhost:3000/wt',
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
