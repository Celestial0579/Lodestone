import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { getSettingsDialogName } from '../../src/lib/settings-dialog-name'
import { editorButtonTooltip } from '../../src/ui/lib/conflicts/unmerged-file'

/** Run `fn` as each platform would, and put `__DARWIN__` back afterwards. */
function onEachPlatform(fn: (darwin: boolean) => void) {
  const wasDarwin = __DARWIN__

  try {
    for (const darwin of [false, true]) {
      Object.assign(globalThis, { __DARWIN__: darwin })
      fn(darwin)
    }
  } finally {
    Object.assign(globalThis, { __DARWIN__: wasDarwin })
  }
}

describe('getSettingsDialogName', () => {
  it('is what the menu item and the title of the dialog say', () => {
    // File > Options… on Windows, Lodestone > Settings… on macOS.
    onEachPlatform(darwin =>
      assert.equal(getSettingsDialogName(), darwin ? 'Settings' : 'Options')
    )
  })
})

describe('editorButtonTooltip', () => {
  it('sends the user to the tab the editor is chosen on', () => {
    onEachPlatform(darwin =>
      assert.equal(
        editorButtonTooltip(null),
        `No editor configured in ${
          darwin ? 'Settings' : 'Options'
        } > Integrations`
      )
    )
  })

  it('has nothing to say where an editor is known', () => {
    assert.equal(editorButtonTooltip('Visual Studio Code'), undefined)
  })
})

describe('the texts of the app', () => {
  it('send nobody to a dialog called Preferences', async () => {
    // The app has no such dialog. These are the ways a text points at one:
    // "Preferences > Git", "Open Preferences", "in Preferences", "under
    // Preferences". Names in code, such as PopupType.Preferences, are not
    // texts and do not match.
    const pointer =
      /Preferences\s*(?:>|->)|(?:\b[Oo]pen|\bin|\bunder)\s+Preferences\b/g

    const sources = join(__dirname, '..', '..', 'src')
    const offenders = new Array<string>()

    for (const file of await readdir(sources, { recursive: true })) {
      if (!/\.tsx?$/.test(file)) {
        continue
      }

      // A text can wrap, so look at the file as a whole. Comments may say
      // what the dialog used to be called.
      const text = (await readFile(join(sources, file), 'utf8'))
        .split('\n')
        .filter(line => !/^\s*(?:\/\/|\/?\*)/.test(line))
        .join('\n')

      for (const match of text.matchAll(pointer)) {
        offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ')}`)
      }
    }

    assert.deepEqual(offenders, [])
  })
})
