# Lodestone

**Lodestone for Git** is a desktop client for [Gitea](https://about.gitea.com/),
forked from [GitHub Desktop](https://github.com/desktop/desktop). It is an
open-source [Electron](https://www.electronjs.org/) app written in
[TypeScript](https://www.typescriptlang.org) and [React](https://reactjs.org/).

Forked from GitHub Desktop 3.6.5-beta1.

> Lodestone is an independent project. It is not affiliated with, endorsed by or
> supported by Gitea Ltd or GitHub, Inc. Gitea, GitHub and Git are trademarks of
> their respective owners and are used here only to say what this software works
> with.

## What it does

Everything GitHub Desktop does against a GitHub repository, Lodestone does
against a repository on any Gitea instance:

- browse, clone, and create repositories
- commit, push, pull, fetch, and manage branches
- open, view, and check out pull requests
- see issues and CI state from commit statuses
- resolve conflicts, stash, rebase, cherry-pick, squash

## Signing in

Lodestone signs in with a **personal access token**. Gitea instances have no
shared OAuth application the way GitHub.com does, and registering one is an
administrative task per instance, so a token is the only approach that works
against every instance without setup.

1. In Gitea, go to **Settings -> Applications -> Generate New Token**.
2. Give it these scopes:
   `read:user`, `write:repository`, `write:issue`, `write:organization`

   `write:organization` rather than `read:` matters: Gitea derives the required
   scope level from the HTTP method, and publishing a repository into an
   organisation is a POST under `/orgs/{org}`.
3. In Lodestone, enter your instance address (e.g. `https://git.example.com`)
   and paste the token.

Plain `http://` is accepted for `localhost` only. Everywhere else TLS is
required, because the token is sent to that host.

## Updates

Lodestone ships with **no update source configured**. Nothing is checked and
nothing is reported anywhere until you point it at a repository yourself.

To enable update checks, open **Preferences -> Advanced -> Updates** and enter
the Gitea repository that publishes your releases, e.g.
`https://git.example.com/team/gitea-desktop`. The app then asks that
repository's release API whether a newer version exists and links you to it.
Releases are downloaded by hand; the app never installs anything on its own.
If the repository is private, the account you are signed in to on that same
instance is used to read it.

If you run a Squirrel-compatible update feed, set `GITEA_DESKTOP_UPDATES_URL` at
build time to use the built-in auto updater instead.

## What was removed

The GitHub-specific parts of the upstream app are gone or inert:

- **Usage reporting.** Measures are still counted locally because in-app
  features read them, but nothing is ever sent anywhere.
- **Copilot.** Gitea has no GraphQL API and no Copilot integration.
- **Check runs, rulesets, secret scanning push protection, Alive.** These are
  GitHub-only APIs. Their endpoints are answered locally so callers degrade
  rather than error. CI state comes from Gitea commit statuses instead.
- **The GitHub.com sign-in flow and the GitHub changelog feed.**

## How Gitea support is wired in

The app still calls the GitHub-shaped endpoints it was written against. A
translation layer under [`app/src/lib/gitea`](app/src/lib/gitea) sits beneath
the HTTP request function and does three things for any endpoint belonging to a
Gitea instance:

1. rewrites request paths and query strings to their Gitea equivalents
   (`per_page` to `limit`, `mentionables/users` to `assignees`, `meta` to
   `version`, and so on)
2. answers GitHub-only endpoints locally instead of hitting the server
3. reshapes response payloads into the shape the caller expects (Gitea has no
   `pushed_at`, and calls a user's display name `full_name`)

Keeping the translation in one place means changes from upstream GitHub Desktop
can be merged without conflicting with the Gitea support.

## Artwork

The application icons, the installer splash and the in-app logo are built from
the Gitea mark (`assets/logo.svg` in
[go-gitea/gitea](https://github.com/go-gitea/gitea)), placed on a rounded tile.
Development builds use a sand-coloured tile so they can be told apart from a
release build in the taskbar.

`script/generate-icons.mjs` regenerates all of them from a single SVG.

Note that Gitea is a trademark of its owners and this fork is not an official
Gitea product. Using the mark is fine for an in-house build; check their
trademark policy before distributing one publicly under this name.

The macOS 26 asset catalogue (`Assets.car`) is not included, because compiling
one needs Xcode's `actool` on a Mac. The `.icon` source and the ICNS are both
there, so a macOS build still gets a correct icon, and `script/build.ts` treats
the catalogue as optional.

## Building

The toolchain is unchanged from upstream, see
[setup instructions](docs/contributing/setup.md).

```sh
yarn
yarn build:dev
yarn start
```

Building the native vendor modules requires the Visual Studio build tools on
Windows; without them `yarn test:unit` cannot load `windows-argv-parser` and the
whole suite fails before running. The Gitea translation layer has its own tests,
which need none of that:

```sh
node script/test.mjs app/test/unit/gitea
```

## License

**[MIT](LICENSE)**

The copyright for the original GitHub Desktop code remains with GitHub, Inc.
See [LICENSE](LICENSE).
