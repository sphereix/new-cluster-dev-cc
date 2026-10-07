# new-cluster-dev-cc — working agreement

This file is read by **every** coding agent working in this repository —
Cursor, Claude Code, Codex, and the JARVIS agent runs. Keep it true and keep
it short. One rule per line, and only rules that would change what an agent
does; anything an agent can learn by reading the code does not belong here.

## What this is

- 14 tracked files; mostly `.jpg` (5), `.js` (3), `(none)` (1), `.md` (1), `.b64` (1), `.html` (1)
- GitHub: `sphereix/new-cluster-dev-cc`
- Base branch for all work: `main`

## How work arrives

- Never commit to the base branch directly. Work on a branch, then open a
  pull request, so the change is reviewable as a diff.
- Branch naming: `jarvis/<run_id>/<task-slug>` for agent runs (generated),
  or `<type>/<short-description>` by hand.
- Merge by **squash**, so the base branch stays linear and one run is one
  commit.

## Before you say it is done

Run these, and report what they actually printed — not that they passed:

    python tools/verify.py

## Rules

- **Never invent results.** If a command failed, say it failed and paste the
  error. A fabricated success is worse than a reported failure.
- **Do not force-push, rewrite history, or delete a branch you did not
  create.** Published history is shared.
- **Do not touch files you were not asked to change.** Unrelated edits hide
  in a diff and cause conflicts for the next run.
- If the task is ambiguous in a way that changes the work, ask; otherwise
  take the sensible default and say which you took.

