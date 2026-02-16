---
name: infra:status
description: Show audit/fix status for the current project — last run times, score, findings
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
---

You show the infrastructure audit status for the current project. This is a read-only, lightweight command — no auditing, no file changes.

---

## Step 1: Identify the project

Determine the project name:
1. Read `pyproject.toml` and extract `[project] name`
2. If no `pyproject.toml`, use the current directory basename

Sanitize the name: replace any non-alphanumeric characters (except `-` and `_`) with `_`.

---

## Step 2: Look up history

Check for a history file at `~/.claude/infra/history/{project-name}.json`.

If the file **does not exist**, print:

```
━━━ INFRA STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Project:  {project-name}
  Status:   No audit history found

  Run /infra:audit to get started.
```

And stop.

---

## Step 3: Calculate time deltas

Use Bash to get the current date and compute how long ago each event happened:

```bash
echo $(( ($(date +%s) - $(date -d "YYYY-MM-DD" +%s)) / 86400 ))
```

Convert the day count to a human-friendly string:
- 0 days → "today"
- 1 day → "yesterday"
- 2-6 days → "N days ago"
- 7-13 days → "1 week ago"
- 14-27 days → "N weeks ago"
- 28-59 days → "1 month ago"
- 60+ days → "N months ago"

Compute this for:
- `last_audit` (always present in history)
- `last_fix` (may be absent — skip if missing)

---

## Step 4: Display status

Read the full history JSON and print a styled report.

**If score >= 9.0:**
```
━━━ INFRA STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Project:     {project-name}
  Score:       [████████████████████]  10.0 / 10

  Last audit:  {date} ({time delta})
  Last fix:    {date} ({time delta})

  Findings:    0 critical · 0 warnings · 1 info
  Status:      Clean — no action needed
```

**If score < 9.0:**
```
━━━ INFRA STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Project:     {project-name}
  Score:       [██████████████░░░░░░]  7.0 / 10

  Last audit:  {date} ({time delta})
  Last fix:    never

  Findings:    1 critical · 2 warnings · 0 info
  Status:      Action needed — run /infra:fix
```

**If the audit is older than 30 days, add a staleness warning:**
```
  Staleness:   Audit is {N} days old — consider re-running /infra:audit
```

### Score bar

20 chars wide. Fill proportionally: `filled = round(score * 2)`. Use `█` for filled, `░` for empty.

### Last fix line

- If `last_fix` exists in the JSON → show the date and time delta
- If `last_fix` is absent → show "never"

### Finding summary

If there are findings in the history, list up to 3 of the highest-severity ones as a quick reminder:

```
  Top findings:
    !! No .pre-commit-config.yaml
    ?? Missing ruff security rules (S)
    ?? No renovate config
```

Only show this section if there are CRITICAL or WARNING findings. Skip for clean projects.
