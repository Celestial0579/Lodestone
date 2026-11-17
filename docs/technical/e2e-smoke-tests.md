# The End-to-End Test

Lodestone has one end-to-end test. It launches the real, production-built app
with Playwright's Electron support, goes through it as a new user would, and
checks in the repository what came of it. This document says what it covers,
how it is run, and which files it is made of.

## What It Covers

The test lives in `app/test/e2e/app-launch.e2e.ts` and does this, in one
Electron session:

- launches the app and completes the welcome flow without signing in
- opens a repository from disk
- checks that the changed file shows up with its diff
- creates a commit
- creates a branch and switches back
- copies the SHA of a commit and reads it back from the clipboard of the main
  process
- right-clicks a commit and checks that the main process was asked for a menu
  with a Copy entry (a native menu cannot be seen from the page)
- on Windows, opens a menu of the menu bar in the title bar
- saves one picture of the main window to `e2e-screenshots/`, which CI keeps as
  the artifact `e2e-main-window`

It mixes what the window shows with what git says: after each step it asks the
repository itself, with git, whether the commit and the branch are there.

That is deliberately little. The test is there to show that a build starts and
can do the one thing the app is for. It is the only automated check that runs
the app as a whole.

## What It Does Not Cover

Upstream's suite went on to test the updater: a mock update server stood in
for the Squirrel feed, and nine tests expected what that updater shows, from
"downloading update" to the dialog that warns against closing GitHub Desktop
while an update installs. Lodestone does not update that way. It asks a forge
for the latest release of a repository and links to it; it downloads and
installs nothing. Those tests expected texts and dialogs this app never shows.
They were removed, together with the mock server and the build switch that
pointed the app at it.

What the update check does is covered by unit tests instead:

- `app/test/unit/forges/update-source-test.ts`: asking a forge, in either API
  dialect, and every way that can fail
- `app/test/unit/update-store-test.ts`: what the app makes of the answer
- `app/test/unit/ui/about-update-check-test.tsx`: what the About dialog says

## Files

- `app/test/e2e/app-launch.e2e.ts`: the test
- `app/test/e2e/e2e-fixtures.ts`: the Playwright fixtures, which choose how the
  app is launched and record video and a trace
- `app/test/e2e/test-helpers.ts`: creates the repository the test works in and
  reads its state back
- `app/test/e2e/playwright.config.ts`: the Playwright configuration

## How The App Is Launched

The fixtures can launch the app in three ways.

### Packaged

The default. The fixtures take the app from `dist`, where `npm run build:prod`
puts it, and start that executable. This is the form a release is made from.

### Unpackaged

With `DESKTOP_E2E_APP_MODE=unpackaged` the fixtures start `out/main.js` with
the Electron from `node_modules`. This is for working on the test or on code
near it: it needs no packaging, and still runs a production webpack bundle.

### Installed

With `DESKTOP_E2E_APP_PATH` set to an executable, the fixtures start that one.
This is for running the test against an app that was installed with its setup.

In every mode the app gets a user data folder of its own under the temp
folder, so it starts as a fresh installation would. Git is pointed at a global
and a system configuration of its own there (`GIT_CONFIG_GLOBAL`,
`GIT_CONFIG_SYSTEM`), so the run does not use the git settings of the person
running the test.

## Running It

The test needs `git` on the PATH: the repository it works in is made with it.

```bash
npm run test:e2e:packaged
```

builds a packaged production app and runs the test against it.

```bash
npm run test:e2e:unpackaged
```

This builds a production-configured staged app in `out/` and runs the same E2E
suite against `out/main.js`.

The unpackaged build path uses `DESKTOP_SKIP_PACKAGE=1` so `script/build.ts`
stages the app without invoking the final packaging step.

### Default alias

```bash
npm run test:e2e
```

This remains the packaged path and is equivalent to `npm run test:e2e:packaged`.

## Smoke Repository Setup

The suite uses a throwaway local Git repository created in the system temp
directory.

`app/test/e2e/test-helpers.ts` is responsible for:

- creating the repository
- initializing Git
- configuring a local author name and email
- creating an initial commit
- adding an uncommitted smoke file used by the tests

The tests then verify Desktop's behavior both through the UI and by checking the
repository state directly with Git commands.

## Updater Testing

Updater behavior is tested through a local HTTP server defined in
`app/test/e2e/mock-update-server.ts`.

### Build-time updater URL override

`app/app-info.ts` now uses `DESKTOP_E2E_UPDATES_URL` when present. This is what
lets E2E builds point the app at the local mock update server instead of the
real update service.

### macOS behavior

For macOS, the mock server serves a Squirrel.Mac-style JSON response.

- `no-update` returns HTTP 204
- `update-available` returns a JSON payload with a fake zip URL

The fake download stays open rather than completing, which keeps the app in the
"Downloading update…" state without requiring a valid signed update archive.

### Windows behavior

For Windows, the mock server serves Squirrel.Windows-style responses.

- requests for `RELEASES` receive a text manifest
- requests for `.nupkg` receive a fake long-lived binary response

This is necessary because Windows updater behavior does not use the macOS JSON
contract.

### Mock server control plane

The mock server exposes a simple control surface under `/_control/`.

The tests use it to:

- switch between `no-update` and `update-available`
- reset the captured request log
- inspect which requests the app made

## CI Design

The `e2e-smoke` job in `.github/workflows/ci.yml` runs separately from the main
`build` job.

It currently:

- checks out the repository
- uses the shared CI environment setup action
- builds the production app with `DESKTOP_E2E_UPDATES_URL` pointed at the mock
  server
- uses the shared Windows signing action when needed
- packages the app
- installs the app on macOS and Windows
- exports `DESKTOP_E2E_APP_PATH`
- runs `npm run test:e2e:run:packaged`
- uploads `playwright-videos` as artifacts so traces and videos are retained

The CI job intentionally tests production-like packaged or installed artifacts.
This catches failures that do not show up when running only webpack output.

## Windows-Specific Notes

Windows needed a few extra pieces to keep the suite stable.

`npm run test:e2e` is the packaged form. `npm run test:e2e:run:packaged` and
`npm run test:e2e:run:unpackaged` run the test without building first.

## In CI

The `windows` job of `.github/workflows/ci.yml` packages the app with
`npm run test:e2e:build:packaged` and runs the test against it. When a run fails
there, the job keeps the `playwright-videos` folder as an artifact.

## The Repository It Works In

`app/test/e2e/test-helpers.ts` makes a throwaway repository under the temp
folder before the app starts: it initialises it, gives it an author, makes a
first commit, and adds one file that is not committed yet. That file is what
the test expects to find in the list of changes.

## Videos And Traces

The run writes to `playwright-videos`, which git ignores:

- a video of the window, recorded through the Electron fixture
- a trace, saved when the session ends, that Playwright's trace viewer opens

The fixtures also pass errors from the renderer's console, and uncaught errors
of the page, on to the output of the run. That helps when the app dies before
the test has anything to assert.

## Limits

- Use `npm run test:e2e:unpackaged` when iterating locally on the smoke suite or
  nearby app behavior.
- Use `npm run test:e2e:packaged` when you need parity with the packaged runtime.
- Rely on the CI `e2e-smoke` job for the final check against production-like
  packaged and installed artifacts.
