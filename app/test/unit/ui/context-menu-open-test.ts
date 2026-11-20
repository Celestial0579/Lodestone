import { describe, it } from 'node:test'
import assert from 'node:assert'
import { canOpenWithDefaultProgram } from '../../../src/ui/lib/context-menu'
import { isSafeToOpenFile } from '../../../src/lib/file-open-policy'

describe('canOpenWithDefaultProgram', () => {
  // The menus and openFile must agree on every name.
  const refusedOnWindows = [
    // all extension
    '.bat',
    '.HTA',
    'dir/.lnk',
    // trailing dots and spaces
    'run.exe.',
    'run.exe ',
    'dir/run.cmd..',
    // a colon: an alternate data stream
    'notes.vbs:x',
    'a.txt:evil.vbs',
    // an extension outside ASCII
    'x.vbſ',
    'x.ınf',
    'x.é',
    // and the plain case
    'setup.exe',
    'x.msu',
  ]

  const openedOnWindows = [
    'README.md',
    'photo.PNG',
    '.gitignore',
    'résumé.md',
    'a.lnk.txt',
  ]

  for (const name of refusedOnWindows) {
    it(`does not offer ${JSON.stringify(name)} on Windows`, () => {
      assert.equal(canOpenWithDefaultProgram(name, true), false)
      assert.equal(
        canOpenWithDefaultProgram(name, true),
        isSafeToOpenFile(name, true)
      )
    })
  }

  for (const name of openedOnWindows) {
    it(`offers ${JSON.stringify(name)} on Windows`, () => {
      assert.equal(canOpenWithDefaultProgram(name, true), true)
    })
  }

  it('offers everything elsewhere', () => {
    for (const name of refusedOnWindows) {
      assert.equal(canOpenWithDefaultProgram(name, false), true)
    }
  })
})
