---
name: infra:update
description: Update the infra:audit skill to the latest version
allowed-tools:
  - Bash
  - Read
  - Glob
---

You are updating the `python-infra-audit-cc` skill. Follow these steps:

## Step 1: Check current version

Look for the VERSION file in these locations (check local first, then global):
1. `./.claude/infra/VERSION` (local install)
2. `~/.claude/infra/VERSION` (global install)

Read the file and note the installed version. If neither file exists, report "no version file found (manual install?)".

## Step 2: Check latest version on npm

Run:
```bash
npm view python-infra-audit-cc version
```

Compare the installed version against the latest.

If they match, report: "Already up to date (v{version})." and stop.

## Step 3: Show changelog

Run:
```bash
npm view python-infra-audit-cc dist-tags --json
```

Tell the user what version they're updating from/to.

## Step 4: Run the update

Determine install type from where the VERSION file was found:
- If found at `./.claude/infra/VERSION` → local install → use `--local`
- If found at `~/.claude/infra/VERSION` → global install → use `--global`

Run:
```bash
npx python-infra-audit-cc@latest --global
```
(or `--local` as appropriate)

The installer preserves `infra/history/` — audit history is never overwritten or deleted by updates.

## Step 5: Clear update cache

After successful update, remove the cached update check:
```bash
rm -f ~/.claude/cache/infra-audit-update-check.json
```

Report the result to the user.
