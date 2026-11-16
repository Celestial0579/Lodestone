/**
 * The end-to-end test of Lodestone, using Playwright + Electron.
 *
 * It launches the real production-built app, goes through it via Playwright,
 * and checks what came of it in the repository: that a build starts, takes a
 * new user through the welcome flow, opens a repository, commits, and creates
 * and switches branches. Video and trace recording are configured in the
 * shared Electron fixtures (see ./e2e-fixtures), not in playwright.config.ts.
 *
 * Upstream's suite went on to test the Squirrel updater against a mock update
 * server. Lodestone asks a forge for its latest release instead and installs
 * nothing, so those tests described an updater this app does not use. What
 * the update check does is covered by unit tests: update-source-test,
 * update-store-test and about-update-check-test.
 */

import { test, expect, dismissMoveToApplicationsDialog } from './e2e-fixtures'
import {
  smokeRepoFileContents,
  smokeRepoFileName,
  smokeRepoPath,
  getSmokeRepoCurrentBranch,
  getSmokeRepoHeadMessage,
  getSmokeRepoHeadSha,
  longPathDirectories,
  longPathFileName,
  getSmokeRepoStatus,
} from './test-helpers'
import type { Page } from '@playwright/test'
import path from 'path'

// All tests run sequentially in the same Electron session.
test.describe.configure({ mode: 'serial' })

async function failIfAppErrorDialogIsVisible(page: Page) {
  const appErrorDialog = page.locator('dialog#app-error')
  const isVisible = await appErrorDialog.isVisible().catch(() => false)

  if (!isVisible) {
    return
  }

  const title =
    (await appErrorDialog.locator('.dialog-header h1').textContent()) ?? ''
  const description =
    (await page
      .locator('#app-error-description')
      .textContent()
      .catch(() => null)) ?? ''

  throw new Error(
    `App error dialog blocked the E2E flow. Title: ${title.trim()} Description: ${description.trim()}`
  )
}

// ── Smoke tests ─────────────────────────────────────────────────────

test.describe('Lodestone - App Launch', () => {
  test('should launch, complete welcome flow, commit, and switch branches', async ({
    mainWindow: page,
  }) => {
    // Wait for the React app to mount
    await page.waitForFunction(
      () =>
        (document.getElementById('desktop-app-container')?.innerHTML.length ??
          0) > 100,
      null,
      { timeout: 30000 }
    )

    // ── Welcome flow ────────────────────────────────────────────────
    const skipButton = page.locator('a.skip-button')
    await skipButton.waitFor({ state: 'visible', timeout: 30000 })
    await skipButton.click()

    const nameInput = page.locator('input[placeholder="Your Name"]')
    await nameInput.waitFor({ state: 'visible', timeout: 15000 })
    if ((await nameInput.inputValue()) === '') {
      await nameInput.fill('Lodestone E2E')
    }

    const emailInput = page.locator(
      'input[placeholder="your-email@example.com"]'
    )
    if ((await emailInput.inputValue()) === '') {
      await emailInput.fill('lodestone-e2e@example.com')
    }

    await page.locator('button:has-text("Finish")').click()
    await page.waitForSelector('#welcome', { state: 'hidden', timeout: 15000 })

    await dismissMoveToApplicationsDialog(page)

    // ── Repository view ─────────────────────────────────────────────
    const repoFile = page
      .locator(`//*[contains(normalize-space(), "${smokeRepoFileName}")]`)
      .first()
    const addButton = page
      .locator(
        '//*[contains(normalize-space(), "Add an Existing Repository from your Local Drive") or contains(normalize-space(), "Add an Existing Repository from your local drive")]'
      )
      .first()
    const addRepositoryDialog = page.locator('dialog#add-existing-repository')

    await Promise.race([
      repoFile.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
      addRepositoryDialog
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => {}),
      addButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    ])

    await failIfAppErrorDialogIsVisible(page)

    if (!(await repoFile.isVisible().catch(() => false))) {
      if (!(await addRepositoryDialog.isVisible().catch(() => false))) {
        await addButton.click()
      }

      await addRepositoryDialog.waitFor({ state: 'visible', timeout: 15000 })
      const pathInput = addRepositoryDialog.locator(
        'input[placeholder="repository path"]'
      )
      await pathInput.waitFor({ state: 'visible', timeout: 15000 })
      if ((await pathInput.inputValue()) !== smokeRepoPath) {
        await pathInput.fill(smokeRepoPath)
      }
      await addRepositoryDialog
        .locator(
          'button:has-text("Add Repository"), button:has-text("Add repository")'
        )
        .click()
    }

    await repoFile.waitFor({ state: 'visible', timeout: 15000 })
    await repoFile.click()

    // ── Diff ────────────────────────────────────────────────────────
    const diffContainer = page.locator('.diff-container')
    await diffContainer.waitFor({ state: 'visible', timeout: 15000 })
    await expect(diffContainer).toContainText(smokeRepoFileContents, {
      timeout: 15000,
    })

    // ── Commit ──────────────────────────────────────────────────────
    const commitButton = page.locator(
      '[aria-label="Create commit"] .commit-button'
    )
    await commitButton.waitFor({ state: 'visible', timeout: 15000 })
    await dismissMoveToApplicationsDialog(page)
    await commitButton.click()

    await expect
      .poll(() => getSmokeRepoHeadMessage(), { timeout: 15000 })
      .toBe(`Create ${smokeRepoFileName}`)
    await expect.poll(() => getSmokeRepoStatus(), { timeout: 15000 }).toBe('')

    // ── Create branch ───────────────────────────────────────────────
    const initialBranch = getSmokeRepoCurrentBranch()
    const smokeBranch = 'smoke-branch'

    await dismissMoveToApplicationsDialog(page)
    await page.locator('.branch-button button').click()

    const newBranchBtn = page.locator('.new-branch-button')
    await newBranchBtn.waitFor({ state: 'visible', timeout: 15000 })
    await newBranchBtn.click()

    const createBranchDialog = page.locator('#create-branch')
    await createBranchDialog.waitFor({ state: 'visible', timeout: 15000 })
    const branchNameInput = createBranchDialog.locator('input').first()
    await branchNameInput.evaluate((el, value) => {
      const input = el as HTMLInputElement
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, smokeBranch)

    await createBranchDialog
      .locator(
        'button:has-text("Create Branch"), button:has-text("Create branch")'
      )
      .click()

    await expect
      .poll(() => getSmokeRepoCurrentBranch(), { timeout: 15000 })
      .toBe(smokeBranch)

    // ── Switch back ─────────────────────────────────────────────────
    await dismissMoveToApplicationsDialog(page)
    await page.locator('.branch-button button').click()

    await page
      .locator(
        `//div[contains(@class, "branches-list-item")]//div[contains(@class, "name") and normalize-space()="${initialBranch}"]`
      )
      .click()

    await expect
      .poll(() => getSmokeRepoCurrentBranch(), { timeout: 15000 })
      .toBe(initialBranch)
    await expect.poll(() => getSmokeRepoStatus(), { timeout: 15000 }).toBe('')
  })
})

// ── Electron 44 checks ──────────────────────────────────────────────
//
// What the move to Electron 44 changed (#81): copying goes through the main
// process's clipboard, context menus are built there, and the menu bar sits in
// the title bar on Windows. They run in the session of the test above, which
// left a repository with one commit open.

const screenshotDirectory = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'e2e-screenshots'
)

async function showFirstCommit(page: Page) {
  await page.getByRole('tab', { name: /History/ }).click()
  const commit = page.locator('.commit').first()
  await commit.waitFor({ state: 'visible', timeout: 15000 })
  await commit.click()
  return commit
}

test.describe('Lodestone - Electron 44', () => {
  test('copies the SHA of a commit through the clipboard of the main process', async ({
    app,
    mainWindow: page,
  }) => {
    await showFirstCommit(page)

    await app.evaluate(({ clipboard }) => clipboard.writeText('before'))

    const copyButton = page.locator('button.copy-button').first()
    await copyButton.waitFor({ state: 'visible', timeout: 15000 })
    await copyButton.click()

    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), {
        timeout: 15000,
      })
      .toBe(getSmokeRepoHeadSha())

    // One picture of the main window for the run, with the history open. Give
    // the file list of the commit the time to load first.
    await page.waitForTimeout(1500)
    await page.screenshot({
      path: path.join(screenshotDirectory, 'main-window.png'),
    })
  })

  test('opens the context menu of a commit', async ({
    app,
    mainWindow: page,
  }) => {
    // A native menu cannot be seen from the page, so the main process records
    // what it was asked to show instead of showing it.
    await app.evaluate(({ Menu }) => {
      const shown = new Array<ReadonlyArray<string>>()
      Object.assign(globalThis, { e2eShownMenus: shown })
      Menu.prototype.popup = function () {
        shown.push(this.items.map(i => i.label))
        return this
      }
    })

    const commit = await showFirstCommit(page)
    await commit.click({ button: 'right' })

    await expect
      .poll(
        () =>
          app.evaluate(
            () =>
              (
                globalThis as unknown as {
                  e2eShownMenus: ReadonlyArray<ReadonlyArray<string>>
                }
              ).e2eShownMenus.length
          ),
        { timeout: 15000 }
      )
      .toBeGreaterThan(0)

    const labels = await app.evaluate(
      () =>
        (
          globalThis as unknown as {
            e2eShownMenus: ReadonlyArray<ReadonlyArray<string>>
          }
        ).e2eShownMenus[0]
    )
    expect(labels.some(l => /Copy/i.test(l))).toBe(true)
  })

  test('lists a file whose path is longer than 260 characters', async ({
    mainWindow: page,
  }) => {
    // The repository is under a path with spaces and umlauts, and the first
    // commit holds a file deep in it (#49).
    expect(
      path.join(smokeRepoPath, ...longPathDirectories).length
    ).toBeGreaterThan(260)

    await page.getByRole('tab', { name: /History/ }).click()
    await page.locator('.commit').filter({ hasText: 'Initial commit' }).click()

    await expect(
      page.locator('#changed-files, .file-list').getByText(longPathFileName)
    ).toBeVisible({ timeout: 15000 })
  })

  // The menu bar test is the last: it leaves its menu open over the window.
  test('opens a menu of the menu bar in the title bar', async ({
    mainWindow: page,
  }) => {
    // The menu bar is part of the title bar on Windows only.
    test.skip(process.platform !== 'win32', 'the menu bar is Windows only')

    const fileMenu = page
      .locator('#app-menu-bar')
      .getByRole('menuitem', { name: /File/ })
    await fileMenu.waitFor({ state: 'visible', timeout: 15000 })
    await fileMenu.click()

    await expect(page.locator('#app-menu-foldout')).toBeVisible({
      timeout: 15000,
    })
  })
})
