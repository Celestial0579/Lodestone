import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ensureItemIds,
  buildDefaultMenuTemplate,
} from '../../../src/main-process/menu'
import type { MenuLabelsEvent } from '../../../src/models/menu-labels'

/** Extract the Windows-style access key from a menu item label, if any. */
function getAccessKey(label: string): string | null {
  const m = label.match(/(?<!&)&([^&])/)
  return m ? m[1].toLowerCase() : null
}

type DuplicateAccessKey = {
  readonly menuPath: string
  readonly accessKey: string
  readonly firstLabel: string
  readonly secondLabel: string
}

/**
 * Recursively walk a menu template and collect any duplicate access keys
 * within the same submenu level.
 */
function findDuplicateAccessKeys(
  items: ReadonlyArray<Electron.MenuItemConstructorOptions>,
  menuPath = 'root'
): ReadonlyArray<DuplicateAccessKey> {
  const duplicates: DuplicateAccessKey[] = []
  const seenKeys = new Map<string, string>()

  for (const item of items) {
    if (item.type === 'separator') {
      continue
    }
    if (item.visible === false) {
      continue
    }

    const label = item.label
    if (label !== undefined) {
      const accessKey = getAccessKey(label)
      if (accessKey !== null) {
        const existingLabel = seenKeys.get(accessKey)
        if (existingLabel !== undefined) {
          duplicates.push({
            menuPath,
            accessKey,
            firstLabel: existingLabel,
            secondLabel: label,
          })
        } else {
          seenKeys.set(accessKey, label)
        }
      }
    }

    const submenu = item.submenu
    if (submenu !== undefined && Array.isArray(submenu)) {
      const childPath =
        label !== undefined ? `${menuPath} > ${label}` : menuPath
      duplicates.push(...findDuplicateAccessKeys(submenu, childPath))
    }
  }

  return duplicates
}

describe('main-process menu', () => {
  describe('ensureItemIds', () => {
    it('leaves explicitly specified ids', () => {
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: 'File', id: 'foo' },
      ]

      ensureItemIds(template)

      assert.equal(template[0].id, 'foo')
    })

    it('assigns ids to items which lack it', () => {
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: 'File' },
      ]

      ensureItemIds(template)

      assert.equal(template[0].id, '@.File')
    })

    it('assigns ids recursively', () => {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'File',
          id: 'foo',
          submenu: [
            { label: 'Open' },
            { label: 'Close' },
            {
              label: 'More',
              submenu: [{ label: 'Even more' }],
            },
          ],
        },
      ]

      ensureItemIds(template)

      assert.equal(template[0].id, 'foo')

      const firstSubmenu = template[0]
        .submenu as Electron.MenuItemConstructorOptions[]

      assert.equal(firstSubmenu[0].id, 'foo.Open')
      assert.equal(firstSubmenu[1].id, 'foo.Close')
      assert.equal(firstSubmenu[2].id, 'foo.More')

      const secondSubmenu = firstSubmenu[2]
        .submenu as Electron.MenuItemConstructorOptions[]

      assert.equal(secondSubmenu[0].id, 'foo.More.Even more')
    })

    it('handles duplicate generated ids', () => {
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: 'foo' },
        { label: 'foo' },
      ]

      ensureItemIds(template)

      assert.equal(template[0].id, '@.foo')
      assert.equal(template[1].id, '@.foo1')
    })
  })

  describe('getAccessKey handles escaped ampersands', () => {
    it('does not treat && as an access key prefix', () => {
      // "Save && Upload" has a literal ampersand, no access key
      assert.equal(getAccessKey('Save && Upload'), null)
    })

    it('does not treat && at start of word as access key', () => {
      // "Ben&&Jerrys" has a literal ampersand, no access key
      assert.equal(getAccessKey('Ben&&Jerrys'), null)
    })

    it('extracts access key after escaped ampersand', () => {
      // "Save && &Upload" has a literal ampersand AND an access key 'u'
      assert.equal(getAccessKey('Save && &Upload'), 'u')
    })

    it('extracts normal access key correctly', () => {
      assert.equal(getAccessKey('&File'), 'f')
      assert.equal(getAccessKey('E&xit'), 'x')
    })
  })

  describe('buildDefaultMenuTemplate', () => {
    // The boolean parameters that affect which labels (and therefore access
    // keys) appear in the menu. We generate all 2^N combinations to ensure no
    // state produces a duplicate access key in any submenu.
    const variantKeys = [
      'isStashedChangesVisible',
      'isChangesFilterVisible',
      'hasCurrentPullRequest',
      'askForConfirmationOnRepositoryRemoval',
      'askForConfirmationWhenStashingAllChanges',
      'isForcePushForCurrentRepository',
      'askForConfirmationOnForcePush',
    ] as const

    type VariantKey = typeof variantKeys[number]

    const baseParams: MenuLabelsEvent = {
      selectedShell: null,
      selectedExternalEditor: null,
      askForConfirmationOnForcePush: false,
      askForConfirmationOnRepositoryRemoval: false,
    }

    /** The label of a menu item, without its access key. */
    const getLabel = (id: string, params: MenuLabelsEvent) => {
      const find = (
        items: ReadonlyArray<Electron.MenuItemConstructorOptions>
      ): string | undefined => {
        for (const item of items) {
          if (item.id === id) {
            return item.label
          }

          const found = Array.isArray(item.submenu)
            ? find(item.submenu)
            : undefined

          if (found !== undefined) {
            return found
          }
        }

        return undefined
      }

      return find(buildDefaultMenuTemplate(params))?.replace('&', '')
    }

    /** The products a repository can be hosted on, as the menu is told. */
    const hostNames = ['Gitea', 'Forgejo', 'GitHub', 'GitHub Enterprise']

    /** The items that open something in the browser, and what they say. */
    const hostItems: ReadonlyArray<[string, string, Partial<MenuLabelsEvent>]> =
      [
        ['view-repository-on-github', 'View on', {}],
        ['create-issue-in-repository-on-github', 'Create issue on', {}],
        ['compare-on-github', 'Compare on', {}],
        ['branch-on-github', 'View branch on', {}],
        [
          'create-pull-request',
          'View pull request on',
          { hasCurrentPullRequest: true },
        ],
      ]

    it('names the host of the selected repository in every item that opens it', () => {
      for (const name of hostNames) {
        for (const [id, text, more] of hostItems) {
          assert.equal(
            getLabel(id, {
              ...baseParams,
              ...more,
              repositoryHostName: name,
            }),
            `${text} ${name}`
          )
        }
      }
    })

    it('names no product in those items where none is known', () => {
      // They all said Gitea whatever the repository was hosted on.
      for (const [id, text, more] of hostItems) {
        assert.equal(
          getLabel(id, { ...baseParams, ...more }),
          `${text} the server`
        )
      }
    })

    it('names Gitea nowhere in the menu for a repository on another host', () => {
      const labels = new Array<string>()
      const collect = (
        items: ReadonlyArray<Electron.MenuItemConstructorOptions>
      ) => {
        for (const item of items) {
          if (item.label !== undefined) {
            labels.push(item.label)
          }
          if (Array.isArray(item.submenu)) {
            collect(item.submenu)
          }
        }
      }

      collect(
        buildDefaultMenuTemplate({
          ...baseParams,
          hasCurrentPullRequest: true,
          repositoryHostName: 'Forgejo',
        })
      )

      assert.deepEqual(
        labels.filter(label => /Gitea/.test(label)),
        []
      )
    })

    it('has no duplicate access keys for any combination of label-affecting parameters', () => {
      const combinationCount = 1 << variantKeys.length

      for (let bits = 0; bits < combinationCount; bits++) {
        const variantEntries = variantKeys.map(
          (key, i) => [key, !!(bits & (1 << i))] as [VariantKey, boolean]
        )

        // The name of the host is part of several labels, so go through the
        // names as well. `undefined` stands for a repository with no host.
        for (const repositoryHostName of [undefined, ...hostNames]) {
          const params: MenuLabelsEvent = {
            ...baseParams,
            ...Object.fromEntries(variantEntries),
            repositoryHostName,
          }

          const template = buildDefaultMenuTemplate(params)
          const duplicates = findDuplicateAccessKeys(template)

          assert.deepStrictEqual(
            duplicates,
            [],
            `Duplicate access keys found with params ${JSON.stringify(
              params
            )}: ${JSON.stringify(duplicates)}`
          )
        }
      }
    })
  })
})
