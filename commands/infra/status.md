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

Compute the path hash for unique filename lookup:
```bash
PATH_HASH=$(echo -n "$(pwd)" | sha256sum | cut -c1-8)
```

---

## Step 2: Look up history

Look up the history file using a fallback strategy:

1. Try `~/.claude/infra/history/{sanitized}-{PATH_HASH}.json` (new format)
2. Fall back to `~/.claude/infra/history/{sanitized}.json` (legacy format)
3. If neither exists → no history found

If **neither file exists**, print:

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

### Run history

Show this section only when the history file has a `runs` array with 2 or more entries. If the file is v1 (no `runs` array), skip this section entirely.

```
  History:     5 audits, 2 fixes over 36 days
  Progression: 3.5 -> 5.5 -> 8.0 -> 9.5 -> 10.0
  Trend:       +6.0 since first audit
```

**History line:**
- Count entries with `"type": "audit"` and `"type": "fix"` separately
- Time span: days between the earliest and latest `date` in the `runs` array
- If span is 0, say "today" instead of "over 0 days"

**Progression line:**
- Show the `score` from each run entry in chronological order
- If there are more than 8 entries, show the first 2 scores + ` ... ` + the last 5 scores (e.g. `3.5 -> 5.0 -> ... -> 8.0 -> 9.0 -> 9.5 -> 10.0 -> 10.0`)

**Trend line:**
- Delta between the first run's score and the last run's score
- Use `+` prefix for positive, `-` for negative, `0.0` for no change (e.g. `+6.5 since first audit`)
