# Lodestone

**Lodestone for Git** is a desktop client for [Gitea](https://about.gitea.com/),
[Forgejo](https://forgejo.org/), [GitHub](https://github.com/) and other Git
hosts, forked from [GitHub Desktop](https://github.com/desktop/desktop). It is
an open-source [Electron](https://www.electronjs.org/) app written in
[TypeScript](https://www.typescriptlang.org) and [React](https://reactjs.org/).

No provider is the default. You give it an address, it works out what runs
there, and the sign-in and the wording follow from the answer.

Forked from GitHub Desktop 3.6.5-beta1.

> Lodestone is an independent project. It is not affiliated with, endorsed by or
> supported by Gitea Ltd, the Forgejo project or GitHub, Inc. Gitea, Forgejo,
> GitHub and Git are trademarks of their respective owners and are used here
> only to say what this software works with.

## What it does

Everything GitHub Desktop does against a GitHub repository, Lodestone does
against a repository on any supported host:

- browse, clone, and create repositories
- commit, push, pull, fetch, and manage branches
- open, view, and check out pull requests
- see issues and CI state from commit statuses
- resolve conflicts, stash, rebase, cherry-pick, squash

## Signing in

Enter the address of your instance — `https://git.example.com`,
`https://codeberg.org`, `https://github.com`, whatever you use. Lodestone probes
it to find out what is running and where its API lives, then offers the sign-in
that instance supports.

### With a personal access token

This works everywhere and needs nothing set up on the server, so it is what is
offered by default.

1. Go to **Settings -> Applications -> Generate New Token** on Gitea or Forgejo,
   or **Settings -> Developer settings -> Personal access tokens** on GitHub.
2. Give it these scopes:
   `write:user`, `write:repository`, `read:issue`, `write:organization`

   `write:organization` rather than `read:` matters on Gitea and Forgejo: they
   derive the required scope level from the HTTP method, and publishing a
   repository into an organisation is a POST under `/orgs/{org}`.
3. Paste it into Lodestone.

### With your browser, including single sign-on

If your instance authenticates through an identity provider — Keycloak, Entra,
an OIDC or SAML gateway — you can sign in the way you always do, in the browser,
and Lodestone never sees a password.

This needs an OAuth application registered on the instance, which is an
administrator task done once:

1. On the instance, under **Settings -> Applications -> OAuth2 Applications**
   (or **Settings -> Developer settings -> OAuth Apps** on GitHub), create an
   application with the redirect URI `x-lodestone-client://oauth`. Leave
   *confidential client* unticked: a desktop application cannot keep a secret.
2. In Lodestone's sign-in dialog, follow **Signing in through single sign-on?**
   and paste the client ID.

The client ID is not a secret. Lodestone proves itself with
[PKCE](https://datatracker.ietf.org/doc/html/rfc7636) instead, generating a
fresh verifier for every sign-in.

Plain `http://` is accepted for `localhost` only. Everywhere else TLS is
required, because the token is sent to that host.

## Updates

Lodestone ships with **no update source configured**. Nothing is checked and
nothing is reported anywhere until you point it at a repository yourself.

To enable update checks, open **Preferences -> Advanced -> Updates** and enter
the repository that publishes your releases, e.g.
`https://git.example.com/team/lodestone`. Any host works; the app asks that
repository's release API whether a newer version exists and links you to it.
Releases are downloaded by hand; the app never installs anything on its own.
If the repository is private, the account you are signed in to on that same
instance is used to read it.

If you run a Squirrel-compatible update feed, set `LODESTONE_UPDATES_URL` at
build time to use the built-in auto updater instead.

## What was removed

The GitHub-specific parts of the upstream app are gone or inert:

- **Usage reporting.** Measures are still counted locally because in-app
  features read them, but nothing is ever sent anywhere.
- **Copilot, check runs, rulesets, secret scanning push protection, Alive.**
  These are GitHub-only APIs with no equivalent elsewhere. Against a host that
  does not have them their endpoints are answered locally, so callers degrade
  rather than error, and CI state comes from commit statuses instead.
- **The GitHub changelog feed.**

## How more than one provider is supported

The app still calls the GitHub-shaped endpoints it was written against.
[`app/src/lib/forges`](app/src/lib/forges) works out which dialect an endpoint
speaks and picks an adapter; GitHub and GitHub Enterprise pass straight through.
For Gitea and Forgejo a translation layer under
[`app/src/lib/gitea`](app/src/lib/gitea) sits beneath the HTTP request function
and does three things:

1. rewrites request paths and query strings to their Gitea equivalents
   (`per_page` to `limit`, `mentionables/users` to `assignees`, `meta` to
   `version`, and so on)
2. answers GitHub-only endpoints locally instead of hitting the server
3. reshapes response payloads into the shape the caller expects (Gitea has no
   `pushed_at`, and calls a user's display name `full_name`)

Keeping the translation in one place means changes from upstream GitHub Desktop
can be merged without conflicting with it, and that adding another provider is a
matter of adding an adapter rather than touching call sites.

## Artwork

The application icons, the installer splash, the title bar mark and the theme
previews are drawn in this repository from `app/static/logos/lodestone-mark.svg`
— a compass needle, for the stone that pointed north before the compass existed.
The colours are the Firestrike palette: ember on steel, with the spark for the
bearing ring.

`script/generate-icons.mjs` produces every size, both release channels, the
macOS icon bundle and the installer GIF from that one file:

```sh
npx electron script/generate-icons.mjs
```

It runs under Electron because nothing in the dependency tree can rasterise an
SVG: Chromium draws it and the script packs the container formats itself. The
bearing ring is dropped below 48px, where it would turn to mush.

Development builds get an ember tile instead of steel, so a dev build and a
release build are distinguishable in the taskbar.

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
