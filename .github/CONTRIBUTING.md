# Contributing

Lodestone is a fork of [GitHub Desktop](https://github.com/desktop/desktop),
maintained by one person. The upstream project's governance, triage rotas and
release planning do not apply here; those documents were removed rather than
renamed, because renaming them would have made them say untrue things.

## Reporting something

Open an issue at <https://git.firestrike.de/tim.heyne/Lodestone/issues>. A bug
report is most useful with the forge type and version (Gitea 1.27, Forgejo 12,
GitHub Enterprise Server), what you did, and what happened instead. Logs are
under Help, Show logs.

For anything security related see [SECURITY.md](../SECURITY.md).

## Building

See [docs/contributing/setup.md](../docs/contributing/setup.md). The toolchain
is unchanged from upstream; on Windows you need the Visual Studio build tools
for the native modules.

```sh
yarn
yarn build:dev
yarn start
```

Before sending a change, run:

```sh
yarn prettier --write
yarn tsc --noEmit -p tsconfig.json
node script/test.mjs app/test/unit/gitea
yarn test:unit
```

## Changes that come from upstream

Identifiers still carry GitHub's names (`GitHubRepository`, `viewOnGitHub`) on
purpose, so that changes can still be merged from `upstream`. Please keep it
that way: rename user-facing text, not symbols.

The forge-specific translation lives in `app/src/lib/gitea/`. New differences
between forge APIs belong there rather than scattered through the call sites.
