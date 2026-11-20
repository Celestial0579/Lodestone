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

Until you answer, and after you answer no, every Git call for that repository, automatic or started by you, runs with the command keys overridden and hooks pointed at an empty folder. Local operations keep working. Git never goes into a submodule: status runs with `--ignore-submodules=all`, fetch and pull with `--no-recurse-submodules`, `submodule.recurse` is off, and submodules are not updated. Only `git:`, `http:`, `https:`, `ssh:` and `file:` transports are allowed (`GIT_ALLOW_PROTOCOL`), whatever `protocol.*` says. If the repository also sets transport keys, it gets no network operations, background fetch included.

## Trusted

Trusted works like the Git command line: nothing is overridden.

## Remembering

Lodestone stores a fingerprint (keys, values, origin files, hook names and the SHA-256 of each hook) per repository path in the app's local storage. It holds no secrets. After operations that change the work tree and on refresh the fingerprint is compared; any difference asks again, and the repository is untrusted until you answer. Revoke a decision in Settings, Advanced, Trusted repositories.

## Always on

- A path the app does not know (not in the list, not yet added) gets the overrides of an untrusted repository, except for `clone` and `init`.
- The work tree is the folder that holds `.git`. A repository whose `core.worktree` points elsewhere is refused. In a subfolder, Lodestone offers the top-level folder.
- `-c safe.bareRepository=explicit` on every call.
- Status runs with `core.fsmonitor=false`; diff, log and show run with `--no-ext-diff --no-textconv`.
