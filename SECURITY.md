# Security

Lodestone is maintained by one person as a side project. There is no bounty
programme and no service level agreement.

## Reporting a vulnerability

Please report privately rather than in a public issue on
<https://github.com/Celestial0579/Lodestone>. GitHub has no confidential
issues, so write to the maintainer directly, at the address given in the
imprint at <https://firestrike.de/impressum/>.

Expect an acknowledgement within a week. Fixes ship in the next release; there
is no separate security release channel.

## Scope

Lodestone is a fork of GitHub Desktop and inherits its dependencies. A
vulnerability in Electron, in Git, or in an upstream dependency is best
reported to that project, which can fix it for everyone. Report it here if it
is introduced or made worse by this fork specifically, in particular anything
touching how access tokens are stored or which host they are sent to.

## What this application does with your credentials

Access tokens are held in the credential store your operating system provides,
never in the repository or in plain files. Lodestone talks to the forge
instances you sign in to and to the update source you configure, and to nothing
else. It sends no telemetry.
