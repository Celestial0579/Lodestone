import { describe, it } from 'node:test'
import assert from 'node:assert'
import { exec } from 'dugite'
import { tmpdir } from 'os'
import { getGitConfigParameter } from '../../../src/lib/hooks/git-config-parameters'

/** Ask git what it makes of the variable. */
async function readBack(parameters: string, key: string) {
  const { exitCode, stdout, stderr } = await exec(
    ['config', '--get', key],
    tmpdir(),
    { env: { GIT_CONFIG_PARAMETERS: parameters } }
  )

  assert.equal(exitCode, 0, stderr)
  return stdout.replace(/\r?\n$/, '')
}

describe('getGitConfigParameter', () => {
  it('quotes a plain value', () => {
    assert.equal(
      getGitConfigParameter('core.hooksPath', '/tmp/desktop-git-hooks-abc'),
      `'core.hooksPath=/tmp/desktop-git-hooks-abc'`
    )
  })

  it('gives git a path with an apostrophe in it', async () => {
    // The temp folder of a Windows account called O'Brien. Unquoted, git
    // answers "bogus format in GIT_CONFIG_PARAMETERS" and runs nothing.
    const path = `C:\\Users\\O'Brien\\AppData\\Local\\Temp\\desktop-git-hooks-abc`

    assert.equal(
      await readBack(
        getGitConfigParameter('core.hooksPath', path),
        'core.hooksPath'
      ),
      path
    )
  })

  it('gives git a value with several quotes and with spaces', async () => {
    const value = `it's 'quoted' twice, isn't it`

    assert.equal(
      await readBack(getGitConfigParameter('user.name', value), 'user.name'),
      value
    )
  })

  it('stands beside the entries that are already there', async () => {
    // withHooksEnv appends its entry to whatever the variable held.
    const parameters = `'user.name=Ada' ${getGitConfigParameter(
      'core.hooksPath',
      `/tmp/o'brien/hooks`
    )}`

    assert.equal(await readBack(parameters, 'user.name'), 'Ada')
    assert.equal(
      await readBack(parameters, 'core.hooksPath'),
      `/tmp/o'brien/hooks`
    )
  })

  it('is what git refuses without the quoting', async () => {
    // The entry as it was built before, to show the test would notice.
    const { exitCode, stderr } = await exec(
      ['config', '--get', 'core.hooksPath'],
      tmpdir(),
      { env: { GIT_CONFIG_PARAMETERS: `'core.hooksPath=/tmp/o'brien/hooks'` } }
    )

    assert.notEqual(exitCode, 0)
    assert.match(stderr, /bogus format in GIT_CONFIG_PARAMETERS/)
  })
})
