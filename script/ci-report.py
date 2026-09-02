#!/usr/bin/env python3
"""Report a CI outcome as an issue, and withdraw the report when it passes.

This instance runs Forgejo 15.0.7, whose API has no endpoint for workflow logs
and whose web routes accept neither basic auth nor an API token. A failing run
therefore cannot be read programmatically at all, which makes diagnosing one
depend on somebody downloading the log by hand.

So the run reports itself. The tracker holds an open issue exactly while the
branch is broken:

  failure  ->  open an issue with the tail of the log, or add the tail as a
               comment when one is already open, so a run that keeps failing
               does not fill the tracker with copies of itself
  success  ->  close it, saying which run fixed it

Nothing else depends on this. Deleting the two steps that call it, in
.gitea/workflows/ci.yml, switches the whole thing off.
"""

import json
import os
import sys
import urllib.error
import urllib.request

# How a report is recognised as one, so a green run knows what to close. Any
# open issue whose title starts with this is treated as this script's.
TITLE_PREFIX = "CI failure:"

# Issue bodies are size-limited, and the interesting part of a build log is the
# end of it.
LOG_TAIL_BYTES = 40_000


def api(path: str, method: str = "GET", payload: dict | None = None):
    """One call against the repository's API. Returns the decoded body."""
    request = urllib.request.Request(
        f"{os.environ['API']}{path}",
        method=method,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"token {os.environ['TOKEN']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read().decode("utf-8")

    return json.loads(body) if body.strip() else None


def open_reports() -> list:
    """Every open issue this script has filed."""
    issues = api("/issues?state=open&type=issues&limit=50")

    if not isinstance(issues, list):
        return []

    return [i for i in issues if i.get("title", "").startswith(TITLE_PREFIX)]


def log_tail() -> str:
    """The end of the combined output, or a note saying there was none."""
    path = os.environ.get("CI_LOG", "ci.log")

    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - LOG_TAIL_BYTES))
            tail = handle.read().decode("utf-8", errors="replace")
    except OSError:
        return "(no output was captured)"

    # A fence inside the log would end the code block early. The replacement
    # carries a zero-width space, so it reads the same and nests safely.
    return tail.replace("```", "`​``")


def describe(run: str, commit: str, url: str) -> str:
    return f"Run [#{run}]({url}) on `{commit[:9]}`"


def report_failure() -> None:
    run = os.environ["RUN_NUMBER"]
    commit = os.environ["COMMIT"]
    url = os.environ["RUN_URL"]

    body = (
        f"{describe(run, commit, url)} failed.\n\n"
        "Tail of the combined output:\n\n"
        f"```\n{log_tail()}\n```\n"
    )

    existing = open_reports()

    if existing:
        # Already broken and already reported. Another issue saying the same
        # thing helps nobody; the new output belongs on the open one.
        issue = existing[0]
        api(f"/issues/{issue['number']}/comments", "POST", {"body": body})
        print(f"commented on existing report #{issue['number']}")
        return

    issue = api(
        "/issues",
        "POST",
        {
            "title": f"{TITLE_PREFIX} run #{run} on {commit[:9]}",
            "body": (
                body
                + "\nThis issue was opened by the CI workflow and will close "
                "itself once a run passes.\n"
            ),
        },
    )
    print(f"opened report #{issue['number']}")


def report_success() -> None:
    run = os.environ["RUN_NUMBER"]
    commit = os.environ["COMMIT"]
    url = os.environ["RUN_URL"]

    reports = open_reports()

    if not reports:
        return

    for issue in reports:
        number = issue["number"]
        api(
            f"/issues/{number}/comments",
            "POST",
            {"body": f"Fixed by {describe(run, commit, url)}, which passed."},
        )
        api(f"/issues/{number}", "PATCH", {"state": "closed"})
        print(f"closed report #{number}")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("failure", "success"):
        print(f"usage: {sys.argv[0]} failure|success", file=sys.stderr)
        return 2

    try:
        if sys.argv[1] == "failure":
            report_failure()
        else:
            report_success()
    except (urllib.error.URLError, KeyError, ValueError) as error:
        # Never fail the job over its own reporting. A failing run must keep
        # its own exit code, and a passing one must not be turned red by the
        # tracker being briefly unreachable.
        print(f"could not report to the tracker: {error}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
