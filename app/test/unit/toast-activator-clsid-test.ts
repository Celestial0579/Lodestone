import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getSquirrelToastActivatorClsid,
  squirrelAppUserModelId,
} from '../../src/lib/toast-activator-clsid'

describe('getSquirrelToastActivatorClsid', () => {
  it('gives the CLSID an installed Lodestone finds in its shortcuts', () => {
    // Read from the Start menu shortcut Squirrel.Windows wrote for a Windows
    // build of this app, and logged by it on every start.
    assert.equal(squirrelAppUserModelId, 'com.squirrel.Lodestone.Lodestone')
    assert.equal(
      getSquirrelToastActivatorClsid(),
      '{3EC4A9EC-5B9B-5A59-BF73-B4B251A8990F}'
    )
  })

  it('derives it the way Squirrel does', () => {
    // The value upstream wrote down for GitHub Desktop, which Squirrel derived
    // from that app's ID. That it comes out of the same function is what says
    // the derivation is the right one.
    assert.equal(
      getSquirrelToastActivatorClsid(
        'com.squirrel.GitHubDesktop.GitHubDesktop'
      ),
      '{27D44D0C-A542-5B90-BCDB-AC3126048BA2}'
    )
  })

  it('does not fall back to the CLSID of GitHub Desktop', () => {
    assert.notEqual(
      getSquirrelToastActivatorClsid(),
      '{27D44D0C-A542-5B90-BCDB-AC3126048BA2}'
    )
  })
})
