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

The default. The fixtures take the app from `dist`, where `yarn build:prod`
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
yarn test:e2e:packaged
```

builds a packaged production app and runs the test against it.

```bash
yarn test:e2e:unpackaged
```

builds the staged app in `out/` and runs the test against `out/main.js`. The
build sets `DESKTOP_SKIP_PACKAGE=1`, which makes `script/build.ts` stop before
packaging.

`yarn test:e2e` is the packaged form. `yarn test:e2e:run:packaged` and
`yarn test:e2e:run:unpackaged` run the test without building first.

## In CI

The `windows` job of `.github/workflows/ci.yml` packages the app with
`yarn test:e2e:build:packaged` and runs the test against it. When a run fails
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

- One path through the app, not the interface as a whole.
- Nothing that needs an account: no sign-in, no clone, no push.
- The unpackaged mode is for speed. It does not stand in for a packaged build,
  and neither stands in for an installation.
