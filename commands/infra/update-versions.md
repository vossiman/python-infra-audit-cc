---
name: infra:update-versions
description: Refresh blueprint version baselines in versions.yml against latest upstream releases
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - WebFetch
  - Glob
  - Grep
---

You are refreshing the version baselines in `~/.claude/infra/versions.yml`. This file is the single source of truth for what versions the infra blueprint recommends. After confirming changes with the user, you also sync those versions into the downstream blueprint files.

This is a two-phase operation: **research** (parallel agents fetch latest releases) then **update** (write files after user approval).

---

## Phase 1: Read current baselines

Read `~/.claude/infra/versions.yml` and note every current version value.

---

## Phase 2: Fetch latest releases in parallel

**IMPORTANT: Launch all research sub-agents simultaneously as a single parallel batch. Do not wait for one before starting the next. Use the Task tool with multiple concurrent calls.**

Launch these agents in parallel, one per group:

### Agent 1 — GitHub Actions (floating major tags)
Fetch the releases page for each and identify the latest stable major tag:
- `https://github.com/actions/checkout/releases`
- `https://github.com/actions/setup-python/releases`
- `https://github.com/actions/setup-node/releases`
- `https://github.com/astral-sh/setup-uv/releases`

For each, confirm whether a floating major tag (e.g. `v6`) exists that tracks the latest patch — these repos maintain such tags. Report the latest major version.

### Agent 2 — GitHub Actions (exact pins)
Fetch and identify the latest exact release tag:
- `https://github.com/renovatebot/github-action/releases`

Note: this repo does NOT maintain a floating major tag. Report the latest exact version (e.g. `v46.1.2`).

### Agent 3 — Pre-commit hooks
Fetch the releases page for each and identify the latest stable tag:
- `https://github.com/pre-commit/pre-commit-hooks/releases`
- `https://github.com/astral-sh/ruff/releases` (also used for ruff-pre-commit rev)
- `https://github.com/jendrikseipp/vulture/releases`

### Agent 4 — Tool version floors
Fetch the latest release for:
- `https://github.com/astral-sh/ruff/releases` (for the `>=x.y.z` floor in pyproject.toml)
- `https://pypi.org/pypi/pre-commit/json` (parse `.info.version`)
- `https://pypi.org/pypi/pytest/json` (parse `.info.version`)
- `https://pypi.org/pypi/vulture/json` (parse `.info.version`)

---

## Phase 3: Compile comparison

Once all agents return, compile a table showing current vs latest for every entry in `versions.yml`:

```
┌─────────────────────────────────────────┬─────────────┬──────────┬────────┐
│ Item                                    │ Current     │ Latest   │ Delta  │
├─────────────────────────────────────────┼─────────────┼──────────┼────────┤
│ actions/checkout                        │ v6          │ v6       │ ✓      │
│ actions/setup-python                    │ v6          │ v6       │ ✓      │
│ ...                                     │ ...         │ ...      │ ...    │
└─────────────────────────────────────────┴─────────────┴──────────┴────────┘
```

Use `↑` for updates available, `✓` for current, `?` if the fetch failed.

**Key nuance on "latest":** We track major versions for floating-tag actions, and exact versions for pinned ones. For tool floors (`>=x.y.z`), we only bump the floor if the new release is in a newer minor or major — patch bumps to the floor are typically not worth the churn.

---

## Phase 4: Confirm with user

Show the table. If everything is current, say so and stop.

If there are updates available, ask the user to confirm before writing anything:

> The following updates are available. Apply them to `versions.yml` and sync downstream files?
> [show the delta rows only]

Do not auto-apply. Wait for explicit confirmation.

---

## Phase 5: Apply updates

On confirmation, update files in this order:

### 5a. Update `~/.claude/infra/versions.yml`
- Update the changed version values
- Update the `# Last updated:` date to today's date (use `date +%Y-%m-%d` via Bash)

### 5b. Sync downstream files in parallel (use parallel Task agents or direct edits)

**`~/.claude/infra/blueprints/ci.yml`** — update action versions:
- `actions/checkout`
- `actions/setup-python`
- `actions/setup-node`

**`~/.claude/infra/blueprints/renovate.yml`** — update action versions:
- `actions/checkout`
- `astral-sh/setup-uv`
- `renovatebot/github-action` (exact pin)

**`~/.claude/infra/blueprint.md`** — update pre-commit example revs and tool floors:
- `pre-commit/pre-commit-hooks` rev
- `astral-sh/ruff-pre-commit` rev
- vulture pre-commit hook rev (appears twice — in the optional hooks section and the dead code section)
- ruff `>=` floor in pyproject.toml example
- pre-commit `>=` floor in pyproject.toml example
- pytest `>=` floor in pyproject.toml example
- vulture `>=` floor in pyproject.toml example

**`fix.md`** — update vulture version in recipe snippets. Resolve the path from your install location:
- Claude Code global: `~/.claude/commands/infra/fix.md`
- Claude Code local: `.claude/commands/infra/fix.md`
- OpenCode global: `~/.config/opencode/commands/infra-fix.md`
- Update: `vulture>=x.y` in pyproject.toml dev-dependencies example
- Update: `rev: vx.y` in pre-commit hook recipe

### 5c. Do NOT auto-commit

Leave the changes uncommitted. Report what was changed and suggest the user commit and push when ready, then publish a new release if they want the updates to ship to other installs.

---

## Phase 6: Report

Summarise what changed (or confirm nothing changed). Remind the user:

> These updates are live on this machine immediately. Other installs of the skill will receive them on the next `npm` release. Run `/infra:update` on other machines to get the latest published release.
