---
name: infra:audit
description: Audit Python project infrastructure against known-good blueprint
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
argument-hint: "[area] (ruff|pyright|pre-commit|ci|pyproject|uv|docker|makefile|alembic|env|all)"
---

You are an infrastructure auditor. Audit the current project against the standards in the blueprint below. Do NOT modify any files — this is a read-only audit.

@~/.claude/infra/blueprint.md

The user may optionally specify an area to audit: `$ARGUMENTS`

If `$ARGUMENTS` is empty or "all", audit all applicable areas. Otherwise audit only the specified area(s).

---

## Phase 1: Detection

Scan the project root for key files to determine which infrastructure areas exist. Use Glob to check for:

| Area | Detection files |
|------|----------------|
| ruff | `pyproject.toml` containing `[tool.ruff]`, or `ruff.toml` |
| pyright | `pyrightconfig.json` |
| pre-commit | `.pre-commit-config.yaml` |
| ci | `.github/workflows/*.yml` or `.gitlab-ci.yml` or `.circleci/config.yml` |
| pyproject | `pyproject.toml` |
| uv | `uv.lock` in root or subdirectories |
| docker | `Dockerfile*` or `compose.yml` or `docker-compose.yml` |
| makefile | `Makefile` |
| alembic | `alembic.ini` |
| env | `.env` pattern (check `.gitignore` for `.env`, look for `example.env`) |

Print a styled detection summary using checkmarks and crosses. Split across two rows for readability:
```
━━━ DETECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [x] ruff        [x] pyright     [ ] pre-commit  [x] CI          [x] pyproject
  [x] uv          [ ] docker      [x] makefile    [x] alembic     [x] env
```
Use `[x]` for detected and `[ ]` for not found.

Skip areas that are not detected AND not explicitly requested. If the user requests a specific area that isn't detected, report it as a CRITICAL finding (missing entirely).

---

## Phase 2: Audit

For each applicable area, read the relevant config files and compare against the blueprint standards. Classify each finding:

| Severity | Criteria | Score Impact |
|----------|----------|-------------|
| **CRITICAL** | Security risks, committed secrets, broken CI, completely missing essential config | -2 per finding |
| **WARNING** | Best-practice deviations that may cause issues in practice | -0.5 per finding |
| **INFO** | Nice-to-haves, cosmetic differences, legitimate alternative approaches | No impact |

### CRITICAL triggers (always flag these)
- `.env` file tracked by git (run: `git ls-files .env` — must return empty)
- No linting tool configured at all (no ruff, no flake8, nothing)
- No `.pre-commit-config.yaml` when ruff exists (linting without pre-commit = CI failures)
- No CI workflow files at all
- Hardcoded database credentials in `alembic.ini` (non-blank `sqlalchemy.url` with a real connection string)
- Lock files (`uv.lock`, `poetry.lock`, `package-lock.json`) in `.gitignore`
- No `.gitignore` at all
- Actual secrets (API keys matching `sk-`, `key-`, long hex strings) in tracked files

### WARNING triggers (common issues)
- ruff configured but missing security rules (`S`)
- ruff configured but missing import sorting (`I`)
- No type checker configured (pyright or mypy)
- pre-commit hooks missing `ruff-format` (lint without format)
- CI exists but doesn't run linting
- CI exists but doesn't run tests
- `pyproject.toml` missing `requires-python`
- Docker images not SHA256-pinned
- Docker using `pip install` instead of lockfile-based install
- Makefile missing `help` target
- Alembic `env.py` missing model imports for autogenerate
- No `example.env` when `.env` is gitignored

### INFO triggers (suggestions)
- ruff `line-length` differs from 120 (legitimate preference)
- pyright mode is `off` or not `basic`/`standard`/`strict`
- Different build backend (setuptools vs hatchling vs flit)
- Tests exist but no `asyncio_mode` configured (may not need async)
- Alternative CI provider (GitLab, CircleCI) — just note it
- `docker-compose.yml` instead of `compose.yml` (old naming, still works)

---

## Phase 3: Report

After completing the audit, calculate the score and output a structured report.

### Score calculation
- Start at 10.0
- Subtract 2.0 per CRITICAL finding
- Subtract 0.5 per WARNING finding
- INFO findings don't affect score
- Minimum score is 0.0

### Output styling

Use rich Unicode box-drawing and bold/emphasis to make the report scannable. The output is GitHub-flavored markdown rendered in a monospace terminal.

IMPORTANT: Never use closed boxes (right-side `║` or `│`). Right-side borders require manual padding to align, and they WILL break in variable-width rendering. Always use open-right designs — left border + top/bottom bars only.

Use these conventions:

**Report header** — open-right double-line box:
```
╔══════════════════════════════════════════════════════════════
║  INFRA AUDIT REPORT
║  {project-name}  ·  {date}
╚══════════════════════════════════════════════════════════════
```

**Score bar** — visual progress bar, 20 chars wide. Fill proportionally to score (e.g. 9.5/10 = 19 filled). Use `█` for filled, `░` for empty:
```
  Score  [███████████████████░]  9.5 / 10
         Critical: 0  ·  Warnings: 1  ·  Info: 1
```

**Section headers** — prominent horizontal rules with the section name:
```
━━━ CRITICAL (0) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
If section has 0 findings, print the header then "None." on the next line.

**Individual findings** — severity icon prefix with indented details:
```
  !! [CRITICAL] {area}: {short description}
     Current:  {what was found}
     Expected: {what the blueprint recommends}
     Fix:      {specific actionable remediation step}

  ?? [WARNING] {area}: {short description}
     Current:  {what was found}
     Expected: {what the blueprint recommends}
     Fix:      {specific actionable remediation step}

  -- [INFO] {area}: {short description}
     Note: {explanation}
```

**Area breakdown table** — standard markdown table with status column:

| Area | Status | Notes |
|------|--------|-------|
| ruff | PASS | ... |
| pyright | PASS | ... |
| ci | 1 warning | ... |

**Summary footer** — open-right single-line box:
```
┌──────────────────────────────────────────────────────────────
│  Passing: ruff, pyright, pre-commit, CI, ...
│  Action items: 0 critical fixes, 1 improvement recommended
└──────────────────────────────────────────────────────────────
```

If score >= 9.0, add a line inside the footer:
```
│  This project's infrastructure is in excellent shape.
```
If score < 5.0:
```
│  Significant infrastructure gaps -- prioritize CRITICAL fixes.
```

### Rules
- Project name: derived from `pyproject.toml` `[project] name` or the directory name
- Date: use today's date
- Group findings by severity, then by area within each severity
- Each finding must include a concrete, copy-pasteable fix (command, config snippet, or file to create)
- If a CRITICAL finding has a one-liner fix, include the exact command
