import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { findAppExecutionAlias } from '../../../src/lib/hooks/app-execution-alias'

const apps = 'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps'
const system = 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\'

const error = (code: string) => Object.assign(new Error(code), { code })

type Kind = 'file' | 'alias' | 'locked'

/**
 * A file system holding the given files. An alias is what Node 24.15.0 made
 * of `pwsh.exe` from the PowerShell 7 package on Windows 11: `stat` fails
 * with EACCES, `lstat` reports a link.
 */
function fileSystem(files: Record<string, Kind>) {
  return {
    stat: async (path: string) => {
      switch (files[path]) {
        case 'file':
          return {}
        case 'alias':
        case 'locked':
          throw error('EACCES')
        default:
          throw error('ENOENT')
      }
    },
    lstat: async (path: string) => {
      switch (files[path]) {
        case 'file':
        case 'locked':
          return { isSymbolicLink: () => false }
        case 'alias':
          return { isSymbolicLink: () => true }
        default:
          throw error('ENOENT')
      }
    },
  }
}

const find = (files: Record<string, Kind>, pathEnv = `${system};${apps}`) =>
  findAppExecutionAlias('pwsh.exe', pathEnv, fileSystem(files), Path.win32)

describe('findAppExecutionAlias', () => {
  it('finds PowerShell 7 installed as a package', async () => {
    assert.equal(
      await find({ [`${apps}\\pwsh.exe`]: 'alias' }),
      `${apps}\\pwsh.exe`
    )
  })

  it('finds nothing where PowerShell 7 is not installed', async () => {
    assert.equal(await find({}), null)
    assert.equal(await find({ [`${apps}\\winget.exe`]: 'alias' }), null)
  })

  it('leaves an ordinary file to which', async () => {
    // A file `stat` can read is one `which` has already looked at.
    assert.equal(await find({ [`${apps}\\pwsh.exe`]: 'file' }), null)
  })

  it('does not take a file it may not read for an alias', async () => {
    assert.equal(await find({ [`${apps}\\pwsh.exe`]: 'locked' }), null)
  })

  it('looks nowhere but in the folder Windows keeps aliases in', async () => {
    const elsewhere = 'C:\\Tools'

    assert.equal(
      await find(
        { [`${elsewhere}\\pwsh.exe`]: 'alias' },
        `${elsewhere};${system}`
      ),
      null
    )
  })

  it('copes with a PATH that has quotes and gaps in it', async () => {
    assert.equal(
      await find({ [`${apps}\\pwsh.exe`]: 'alias' }, `;"${apps}";;${system}`),
      `${apps}\\pwsh.exe`
    )
    assert.equal(await find({ [`${apps}\\pwsh.exe`]: 'alias' }, ''), null)
  })
})
