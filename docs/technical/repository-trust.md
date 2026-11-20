# Repository trust

Git runs programs that a repository's own configuration names, and the hooks in its hooks directory. A repository that arrives from elsewhere (an archive, a copied folder) brings its own configuration and hooks, so whoever made it, not you, chose what runs. The Git command line accepts that. Lodestone asks first.

## What is checked

When a repository is first opened, and once after the update for repositories already in the list, Lodestone reads the repository's own configuration (local and work tree scope, including included files, as `git config --list --show-origin --show-scope` gives it) and its hooks directory. Any file there that does not end in `.sample` counts as a hook, on every system, whether or not it is executable.

It looks for:

- keys that make Git run a program: `core.fsmonitor` (when not a plain on/off), `core.hooksPath`, `core.sshCommand`, `core.askPass`, `core.gitProxy`, `core.pager`, `core.editor`, `pager.*`, `sequence.editor`, `diff.external`, `diff.*.textconv`, `diff.*.command`, `merge.*.driver`, `filter.*.clean/smudge/process`, `credential.helper`, `gpg.program` and its variants, `remote.*.uploadpack/receivepack`, `core.alternateRefsCommand`, and `submodule.*.update` set to a command;
- keys that change where Git connects or what it trusts: `http.sslVerify`, `http.sslCAInfo`, `http.sslCAPath`, `http.proxy`, `http.cookieFile`, `http.saveCookies` (also per URL) and `url.*.insteadOf`/`pushInsteadOf`, and every `protocol.*` key (`protocol.ext.allow=always` lets an `ext::` remote run a command);
- hooks;
- the same keys and hooks in the Git directory of every submodule (`.git/modules/**`, nested modules, and the target of a populated submodule's `.git` file), because Git reads that configuration when it looks at a submodule.

## The question

The dialog lists every key, value and hook name as text. Control characters, bidirectional marks and zero-width characters are shown as `[U+XXXX]`. It names the keys that block network operations. The default answer, and the focused button, is **Don't trust**. The dialog is fully usable with the keyboard and a screen reader.

## Untrusted

Until you answer, and after you answer no, every Git call for that repository, automatic or started by you, runs with the command keys overridden and hooks pointed at an empty folder. Local operations keep working. Git never goes into a submodule: status runs with `--ignore-submodules=all`, fetch and pull with `--no-recurse-submodules`, `submodule.recurse` is off, and submodules are not updated. Only `git:`, `http:`, `https:` and `ssh:` transports are allowed (`GIT_ALLOW_PROTOCOL`), whatever `protocol.*` says. `file` is left out, so an untrusted repository cannot fetch from a local path (which would copy the objects of another repository on the machine into it); trusting the repository restores that. If the repository also sets transport keys, it gets no network operations, background fetch included.

## Trusted

Trusted works like the Git command line: nothing is overridden.

## Remembering

Lodestone stores a fingerprint (keys, values, origin files, hook names and the SHA-256 of each hook) per repository path in the app's local storage. It holds no secrets. After operations that change the work tree and on refresh the fingerprint is compared; any difference asks again, and the repository is untrusted until you answer. Revoke a decision in Settings, Advanced, Trusted repositories.

## Network paths

On Windows, reading `\\host\share\...` connects to that host and sends the user's credentials. So before Git runs in a folder, Lodestone checks the files that name paths Git opens on every call: the `.git` entry, `config`, `config.worktree`, `commondir` and the alternates file of every Git directory (the common one, submodule modules, and the targets of populated submodules' `.git` files), and the files they include. Configuration is read with Git's own parser run from a folder outside the repository (`git config --file <file> --no-includes --list -z`). Includes are followed to a depth of 10 and alternates to 5, whatever the conditions say, and a file reached again at a smaller depth is scanned again. Subsection names such as `url.<base>.insteadOf` are checked as well as values.

A repository is refused, and Git is not run in it at all, when it names a network or device path (two separators of either kind at the start, `\\?\`, `\\.\`, `\??\`, `file://host/share`), when a file Git cannot parse is reached (Git follows an include before it fails on a later line), when a quoted alternates line does not decode as Git decodes it, or when a link or junction stands where the repository's own files are. Before the first Git call (the `ls-files` that finds the submodules included), every Git directory (the main one, the common one, the modules, the targets of submodules' `.git` files) is walked completely and any link or junction in it is a refusal, because Git opens most of what is there: the index and its lock file, `HEAD`, refs, `info/exclude`, pack files. A walk is bounded to 250,000 entries; beyond that the repository is refused (`git gc` packs loose objects). The values of `core.excludesFile`, `core.attributesFile`, `core.hooksPath` and `mailmap.file` are checked part by part, and a hooks directory is walked too. For a path outside the folder, every part below the folder it shares with the repository's own is checked.

Files are read byte for byte as Git reads them: a `.git` file must start with exactly `gitdir: ` and only trailing line ends are cut (so `gitdir:  evil` names ` evil`), alternates lines are split at line feeds and not trimmed, and a `commondir` with leading or trailing whitespace, a carriage return or a byte order mark is refused. On Windows every part of a path from the drive root is checked for links, and a name that ends in a dot or a space is refused (Git drops them, Node does not). A file reached one include or alternates level past the limit is looked at before the check stops. A directory that cannot be listed is refused.

A submodule's `.git` file is a refusal if its target is a network path, and its target is checked like any Git directory.

## Windows name rules

Windows reads a path differently from Node's `lstat`, and a link that `lstat` misses can still be followed by Git or `ssh-keygen`. This is how the check handles each rule (`lookAt` in `repository-trust-paths.ts`), and the test that shows it. Tests marked (Windows) run only on Windows CI.

| Rule | How the check handles it | Test (`repository-trust-paths-test.ts`) |
| --- | --- | --- |
| Drive-relative path (`C:lnk/key`) | `Path.resolve` reads it as Windows does, against the repository's folder on that drive | "reads a drive-relative user.signingkey as Windows does" |
| Stream (`lnk:stream`) | the name is cut at the colon: the part before it is looked at (`lnk` may be a junction); a plain file with a stream is not refused | "cuts a name at a stream colon and maps forbidden characters", "refuses a stream name whose file is a junction, for every key" (Windows), "does not refuse a plain file with a stream" (Windows) |
| `< > " \| ? *` in a name | the walk ends as "not there"; the parts before are looked at; the MSYS2 name (the character as U+F000 plus its code, as `ssh-keygen` of Git for Windows maps it) is looked at instead when it exists | "looks at the parts before a character Windows forbids, and resolves .. first", "maps forbidden characters to the private use area", "looks at the MSYS2 name of a part with a forbidden character when it exists" (Windows) |
| Trailing dot or space of a name | refused: Git opens the name without them, `lstat` sees nothing | "knows names that end in a dot or a space", "refuses a name that ends in a dot or a space where Windows drops them" (Windows) |
| `..` in a value | `Path.resolve` removes it before any part is looked at, as Windows does (`a<b/../lnk/key` is `lnk/key`) | "looks at the parts before a character Windows forbids, and resolves .. first" |
| `\\?\`, `\\.\`, `\??\`, `//`, `\/`, `/\`, `file://host/share` | a network or device path: the repository is refused, nothing is opened | "isNetworkPath" cases |
| 8.3 short names | a short name of a junction reaches the junction; `lstat` of it reports a link, so it is refused | "looks at a junction named by its 8.3 short name" (Windows, skipped when 8.3 names are off) |
| Case | every part from the drive root is looked at, whatever its case; `lstat` ignores case on NTFS | "compares names without regard to case on Windows" (Windows) |
| Link or junction on the way | refused at the first one, every part from the root is looked at | "refuses links and junctions where the repository has its own files" |

## Always on

- A path the app does not know (not in the list, not yet added) gets the overrides of an untrusted repository, except for `clone` and `init`.
- The work tree is the folder that holds `.git`. A repository whose `core.worktree` points elsewhere is refused. In a subfolder, Lodestone offers the top-level folder.
- `-c safe.bareRepository=explicit` on every call.
- Status runs with `core.fsmonitor=false`; diff, log and show run with `--no-ext-diff --no-textconv`.
