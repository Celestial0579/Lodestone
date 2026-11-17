# Releasing

Releases are made by hand from installers that the workflow
[Build the Windows setup for a release](../.github/workflows/release-windows.yml)
leaves behind. It builds them with
[Build the Windows setup](../.github/workflows/build-windows.yml) and attests the
files (build provenance). The workflow publishes nothing. The builds are unsigned
(#23). Check a downloaded file with
`gh attestation verify <file> --repo Celestial0579/Lodestone`.

## Versions

| What            | App version (`app/package.json`) | Git tag           | GitHub release |
| --------------- | -------------------------------- | ----------------- | -------------- |
| Final           | `1.0.3`                          | `v1.0.3`          | latest         |
| Beta            | `1.0.3-beta01`                   | `v1.0.3-beta01`   | pre-release    |

- A beta carries the prerelease version of the final it leads to, so the final
  counts as newer than every beta of it and is offered to everyone who runs one.
- The app version has no dot in the prerelease label. Squirrel.Windows reads
  versions with NuGet 2, which accepts a label that starts with a letter and holds
  only letters, digits and `-`. `1.0.3-beta.1` is not accepted. The git tag is
  `v` plus the app version, so the old tags of the form `-beta.N` are no longer made.
- Semver compares a label character by character, so the beta number has two
  digits (`beta01` to `beta99`); then the order of the labels is the order of the
  numbers.
- The app offers an update only from the latest release, which is never a
  pre-release or a draft. A beta is installed by hand and does not update to the
  next beta; it updates to the final.
- A tag stands on the commit the installers were built from, and only on one
  that was built and tested. Never tag a commit that was not built.

## A beta

1. Make sure CI on `main` is green.
2. Set the app version to the prerelease version (`1.0.3-beta01`) in
   `app/package.json`, and add the entries of the release to `changelog.json` under
   the final version (`1.0.3`). Run `npm run validate-changelog`. Merge this to `main`.
3. Run _Build the Windows setup for a release_ on that commit (`workflow_dispatch`). Note the
   run id.
4. Run _Smoke test the Windows setup_ (`workflow_dispatch`) with that run id as
   `build-run`. It must pass without warnings.
5. Download the artifact `lodestone-windows-x64` of the build run. Check the files
   against `SHA256SUMS.txt`.
6. Tag the built commit `v1.0.3-beta01` and push the tag.
7. Create the release as a pre-release, with the files of the artifact
   (`LodestoneSetup-x64.exe`, `LodestoneSetup-x64.msi`, `Lodestone-1.0.3-beta01-full.nupkg`,
   `RELEASES`, `SHA256SUMS.txt`):

   ```sh
   gh release create v1.0.3-beta01 --prerelease --verify-tag \
     --repo Celestial0579/Lodestone --title "Lodestone for Git v1.0.3-beta01" \
     --notes-file notes.md LodestoneSetup-x64.exe LodestoneSetup-x64.msi \
     Lodestone-1.0.3-beta01-full.nupkg RELEASES SHA256SUMS.txt
   ```

A change after the beta means a new beta (`1.0.3-beta02`).

## A final

The final is a build of its own, because the app version differs from the beta's.
It is tested like the beta.

1. Make sure CI on `main` is green and every open item for the release is closed.
2. Set the app version to the final version (`1.0.3`) in `app/package.json`.
   `changelog.json` already holds the entries. Merge this to `main`.
3. Run _Build the Windows setup for a release_ on that commit. Note the run id.
4. Run _Smoke test the Windows setup_ with that run id. It must pass without
   warnings. Run it again if it fails, but find out why a run failed before
   trusting the second one.
5. Download the artifact and check the files against `SHA256SUMS.txt`.
6. Tag the built commit `v1.0.3` and push the tag.
7. Create the release, not as a pre-release, with the same files. The self-update
   checks the package against the SHA-256 the release lists for it, so
   `SHA256SUMS.txt` and `RELEASES` must be those of this build. The final is
   released by the team lead; betas are published by the sessions that build them.
8. Check that an installed older release finds it (the main window announces it,
   and an installed 1.0.2 or later updates itself).

## Security fixes

A fix for a vulnerability is made in the private fork of its advisory and merged
from the advisory page; see [SECURITY.md](../SECURITY.md). Release it as a final
as above once the advisory is ready to be published.
