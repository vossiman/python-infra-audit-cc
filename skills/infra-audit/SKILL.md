---
name: infra-audit
description: Audit Python project infrastructure against known-good blueprint
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
argument-hint: "[area] (git|ruff|pyright|pre-commit|ci|renovate|pyproject|uv|venv|docker|makefile|alembic|env|tests|deadcode|claude-md|all)"
---

You are an infrastructure auditor. Audit the current project against the standards in the blueprint. Do NOT modify any files — this is a read-only audit.

**Reference files** — read these at the start of Phase 1 using Bash `cat` (they live outside the project tree; avoid the Read tool):
- Blueprint standards: `~/.claude/infra/blueprint.md`
- Version baselines: `~/.claude/infra/versions.yml`
- CI workflow template: `~/.claude/infra/blueprints/ci.yml` (needed when auditing CI)
- Renovate config template: `~/.claude/infra/blueprints/renovate.yml` (needed when auditing Renovate)

The user may optionally specify an area to audit: `$ARGUMENTS`

If `$ARGUMENTS` is empty or "all", audit all applicable areas. Otherwise audit only the specified area(s).

**Working tree protection:** verify.sh handles git stash/restore to ensure tools like `pre-commit run --all-files` don't leave modifications. Do NOT run pre-commit or other auto-fixing tools directly via Bash — always use verify.sh.

---

## Phase 1: Detection (1 LLM round)

First, read the reference files and run detection in parallel (single message, multiple Bash calls):

**Bash call 1 — read reference files:**
```bash
cat ~/.claude/infra/blueprint.md
cat ~/.claude/infra/versions.yml
cat ~/.claude/infra/blueprints/ci.yml
cat ~/.claude/infra/blueprints/renovate.yml
```
This is silent bookkeeping — parse and retain the standards, do not echo to the user.

**Bash call 2 — run detection:**
```bash
AUDIT_TMPDIR=".infra-audit"
mkdir -p "$AUDIT_TMPDIR"
grep -qxF "$AUDIT_TMPDIR/" .gitignore 2>/dev/null || echo "$AUDIT_TMPDIR/" >> .gitignore
DETECT_JSON="$AUDIT_TMPDIR/detect.json"
bash ~/.claude/infra/scripts/detect.sh > "$DETECT_JSON"
```

Read the detection results from the temp file using Bash (`cat .infra-audit/detect.json`) — this is silent bookkeeping, not user-facing output.

The JSON contains: `areas` (boolean map), `venv_tools` (version strings), `requires_python`, `project_name`, `ci_files`, `claude_md_files`, `env` (config mechanism details), `tests` (coverage/snapshot config).

Parse the JSON output.

Print a styled detection summary using checkmarks and crosses. Split across two rows for readability:
```
━━━ DETECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [x] ruff        [x] pyright     [ ] pre-commit  [x] CI          [x] pyproject
  [x] uv          [ ] docker      [x] makefile    [x] alembic     [x] env
  [x] tests       [x] claude-md
```
Use `[x]` for detected and `[ ]` for not found.

Skip areas that are not detected AND not explicitly requested. If the user requests a specific area that isn't detected, report it as a CRITICAL finding (missing entirely).

If the user requests `deadcode` and vulture is not in `venv_tools`, report an INFO finding suggesting installation rather than a CRITICAL "missing" finding.

---

## Phase 2: Parallel Audit + Verification (1 LLM round)

Launch ALL of the following in a **single message** (parallel tool calls):

### 2a. CI Verification (Bash)

```bash
AUDIT_TMPDIR=".infra-audit"
DETECT_JSON="$AUDIT_TMPDIR/detect.json"
VERIFY_JSON="$AUDIT_TMPDIR/verify.json"
bash ~/.claude/infra/scripts/verify.sh "$DETECT_JSON" > "$VERIFY_JSON" && echo "verify.sh complete"
```

This runs ruff, pyright, pre-commit, pytest **in parallel** with git stash/restore protection. Results are saved to `.infra-audit/verify.json` — read them later with `cat .infra-audit/verify.json` (silent bookkeeping).

### 2b. Area Audit Agents (Task — one per detected area)

Spawn one `Explore` sub-agent per detected area via the `Task` tool. Launch all in the same message as verify.sh.

**If only 1 area to audit → audit it directly.** No agents needed.

**Sub-agent prompt template** — every sub-agent must receive:
- The area it's responsible for
- The detection context JSON (which files were found, venv tool versions if relevant)
- The project's `requires-python` value (if found)
- The full list of triggers below relevant to its area
- The blueprint standards for its area
- Instruction to return findings as: `severity | area | description | current | expected | fix`
- Instruction that this is READ-ONLY — no file modifications

### 2c. CLAUDE.md Agents (Task — when claude-md detected)

Spawn two `Explore` sub-agents in the same parallel message:

1. **Extractor + Verifier** (merged into one agent) — Reads all CLAUDE.md files, extracts claims (commands, file refs, tool refs, workflow refs, package refs), then verifies each claim against the actual project:
   - For commands: check make targets exist in Makefile, scripts exist on disk, referenced binaries in `.venv/bin/`
   - For file references: confirm each path exists
   - For tool references: cross-check against detection results and venv probe
   - For package references: check against `pyproject.toml` dependencies
   - Returns: list of stale/broken references with `claim | type | status (valid/stale/broken) | details`

2. **Coverage checker** — Receives detection results, reads CLAUDE.md, finds gaps:
   - For each detected infra area, check if CLAUDE.md mentions it
   - Flag detected areas with zero CLAUDE.md coverage
   - Flag undocumented developer workflows (test, lint, setup)
   - Returns: list of coverage gaps with `area | covered (yes/no) | details`

**Skip CLAUDE.md agents** if `claude-md` was not detected AND not explicitly requested.

---

## Audit Criteria

For each applicable area, read the relevant config files and compare against the blueprint standards. Classify each finding:

| Severity | Criteria | Score Impact |
|----------|----------|-------------|
| **CRITICAL** | Security risks, committed secrets, broken CI, completely missing essential config | -2 per finding (uncapped) |
| **WARNING** | Best-practice deviations that may cause issues in practice | -0.5 per finding (capped at -4 total) |
| **INFO** | Nice-to-haves, cosmetic differences, legitimate alternative approaches | No impact |

### CRITICAL triggers (always flag these)
- Config file containing secrets tracked by git (run: `git ls-files .env config.json config.yaml settings.json` etc. — must return empty for any file that is gitignored or known to hold secrets)
- No linting tool configured at all (no ruff, no flake8, nothing)
- No `.pre-commit-config.yaml` when ruff exists (linting without pre-commit = CI failures)
- No CI workflow files at all
- Hardcoded database credentials in `alembic.ini` (non-blank `sqlalchemy.url` with a real connection string)
- Lock files (`uv.lock`, `poetry.lock`, `package-lock.json`) in `.gitignore`
- No `.gitignore` at all
- Actual secrets (API keys matching `sk-`, `key-`, long hex strings) in tracked files
- No `.venv` when Python source files exist (tools can't run without an environment)
- Not a git repo (no `.git/` directory) — version control is a prerequisite for everything else
- No test files at all (`tests/`, `test_*.py`, `*_test.py`) when Python source files exist — CRITICAL even if `pyproject.toml` configures testpaths or CI runs pytest, because that means CI is running against nothing

### Verification triggers (mapped from verify.sh JSON)

**CRITICAL** (from verify.sh results):
- `ruff_check.status == "fail"` — ruff check fails locally (CI will reject)
- `ruff_format.status == "fail"` — ruff format fails locally (CI will reject)
- `pre_commit.status == "fail"` — pre-commit fails locally (CI runs the same hooks)
- `test_collect.status == "fail"` — test collection broken (CI can't discover tests)
- `pytest.status == "fail"` — tests fail (CI will reject)
- `pytest.coverage_pct == 0` — tests exist but cover nothing

**WARNING** (from verify.sh results):
- `pyright.status == "fail"` — pyright fails locally (type errors CI may catch)
- `version_mismatches` contains `venv_vs_precommit` — ruff version drift between local dev and hooks
- `version_mismatches` contains `venv_vs_ci` — ruff/python version drift between local and CI
- `hooks_registered == false` when pre-commit config exists — hooks won't run on commit
- `pytest.status == "timeout"` — tests hanging or too slow for CI
- `pytest.coverage_pct < 50` (but > 0)
- `vulture.finding_count > 10` — significant dead code detected (maintainability concern)
- `vulture_precommit == false` when `vulture` is in `venv_tools` and pre-commit config exists — dead code checks won't run on commit
- `vulture_config == false` when `vulture` is in `venv_tools` — no `[tool.vulture]` in pyproject.toml (config inconsistency risk; pre-commit hook requires it)

**WARNING** (from detection JSON — `detect.vulture.has_dep`):
- `vulture.has_dep == false` when `vulture` is in `venv_tools` — vulture installed in venv but not in pyproject.toml dev dependencies (won't survive `uv sync`)

**INFO** (from verify.sh results):
- `pytest.coverage_pct < 80` (but >= 50)
- `vulture.finding_count > 0` AND `vulture.finding_count <= 10` — minor dead code detected
- `vulture.status == "skip"` when Python source files exist — vulture not installed (consider adding for dead code detection)

### WARNING triggers (common issues)
- ruff configured but missing security rules (`S`)
- ruff configured but missing import sorting (`I`)
- ruff configured but missing complexity rules (`C901`, `PLR0913`, `PLR0912`, `PLR0915`) or missing `[tool.ruff.lint.mccabe]` / `[tool.ruff.lint.pylint]` thresholds
- No type checker configured (pyright or mypy)
- pre-commit hooks missing `ruff-format` (lint without format)
- pre-commit hooks missing `detect-private-key` (no last-resort secret leak prevention)
- CI exists but doesn't run linting
- CI exists but doesn't run tests
- `pyproject.toml` missing `requires-python`
- Docker images not SHA256-pinned
- Docker using `pip install` instead of lockfile-based install
- Makefile missing `help` target
- Alembic `env.py` missing model imports for autogenerate
- No example/template for the project's config file (e.g. no `example.env` when `.env` is gitignored, no `config.example.json` or `config.json.example` when `config.json` is gitignored). Only flag this for whichever config mechanism the project actually uses
- `.venv` exists but `ruff` not installed (when ruff config is present)
- `.venv` exists but `pytest` not installed (when test files exist)
- `.venv` exists but `pre-commit` not installed (when `.pre-commit-config.yaml` exists)
- `.venv` Python version doesn't match `requires-python` from `pyproject.toml`
- No renovate config when CI exists (no automated dependency updates)
- Renovate config exists but no `.github/workflows/renovate.yml` (self-hosted workflow required)
- Renovate config exists but `rangeStrategy` is not `"bump"` for Python deps (`pep621` manager) — version range floors in `pyproject.toml` (e.g. `ruff>=0.15.2`) won't be bumped automatically, they silently go stale
- Renovate config exists but `pinDigests` is not enabled for GitHub Actions — action refs use mutable tags instead of SHA-pinned digests (supply chain risk). Only flag this when Renovate is actually configured (pinDigests without Renovate is impractical)
- Renovate schedule is monthly (or less frequent) but `prHourlyLimit` is not `0` — updates will be drip-fed across months instead of delivered in one batch. Either set `prHourlyLimit: 0` or increase schedule frequency
- Renovate config exists but does not extend `config:best-practices` (or at minimum `config:recommended`) — missing config migration, abandonment detection, and lock file maintenance
- Renovate config exists but `osvVulnerabilityAlerts` is not enabled — free vulnerability scanning left on the table
- Renovate config exists with Python deps but no `minimumReleaseAge` for PyPI datasource — no stability gate against broken/malicious releases
- Tests exist but no coverage configuration (`pytest-cov` not in dependencies AND no `[tool.coverage]`/`.coveragerc`)
- Coverage configured but no minimum threshold (`fail_under` not set in `[tool.coverage.report]`, `.coveragerc`, or `--cov-fail-under` in pytest args)
- CI runs tests but doesn't collect or report coverage (no `--cov` flag or coverage step in CI workflow)
- Tests exist and `pydantic` is a project dependency but `inline-snapshot` not in dev dependencies
- `inline-snapshot` is in dev dependencies but no test files contain `from inline_snapshot import snapshot`
- CI `python-version` doesn't match local `.venv` Python version (dev/CI divergence)
- Renovate or CI workflow uses GitHub Actions versions more than 1 major version behind the baselines in `versions.yml` — a project using versions NEWER than `versions.yml` is perfectly fine, do not flag it (our baselines may lag the absolute latest)
- Pre-commit hook revs more than 1 major version behind baselines in `versions.yml` (e.g. `pre-commit-hooks` at `v4.x` when baseline is `v6.x`) — same logic as GH Actions version check: newer than baseline is fine, don't flag it

### INFO triggers (suggestions)
- ruff `line-length` differs from 120 (legitimate preference)
- pyright mode is `off` or not `basic`/`standard`/`strict`
- Different build backend (setuptools vs hatchling vs flit)
- Tests exist but no `asyncio_mode` configured (may not need async)
- Alternative CI provider (GitLab, CircleCI) — just note it
- `docker-compose.yml` instead of `compose.yml` (old naming, still works)
- Pyright not installed locally (may be run via CI only)
- Configured `fail_under` threshold is below 80% (may be intentional for early-stage projects)
- Tests exist but no `conftest.py` (may not need shared fixtures)
- Low test-to-source ratio — count `test_*.py`/`*_test.py` files vs `*.py` source files (excluding `__init__.py`, `conftest.py`); flag if ratio is below 0.5
- Tests exist but `inline-snapshot` not in dev dependencies and project doesn't use Pydantic
- `inline-snapshot` used but `dirty-equals` not in dev dependencies

### CLAUDE.md audit triggers

**WARNING:**
- CLAUDE.md references make targets that don't exist in the Makefile
- CLAUDE.md references commands or scripts that don't exist on disk
- CLAUDE.md mentions tools not installed in `.venv` (when venv exists)
- CLAUDE.md references files or paths that don't exist in the project
- CLAUDE.md mentions packages not found in `pyproject.toml` dependencies
- Detected infrastructure area has zero coverage in CLAUDE.md
- CLAUDE.md describes workflows that contradict actual CI configuration
- No CLAUDE.md at all when project has 4+ detected infrastructure areas
- CLAUDE.md lists key files but is missing more than a third of the actual source files

**INFO:**
- CLAUDE.md exists but is very short (< 20 lines) for a project with 5+ infra areas
- CLAUDE.md doesn't describe how to set up the development environment
- CLAUDE.md doesn't describe how to run tests

---

## Phase 3: Report + Save (1 LLM round)

Read the verification results using Bash:
```bash
cat .infra-audit/verify.json
```
This is silent bookkeeping — do not echo raw JSON to the user. (Detection results were already parsed in Phase 1.)

Collect all results: verify.sh JSON + area agent findings + CLAUDE.md agent findings. Merge into a unified findings list. Map verify.sh JSON fields to severity-tagged findings using the trigger rules above.

### Score calculation
- Start at 10.0
- Subtract 2.0 per CRITICAL finding (no cap — critical issues always hit hard)
- Subtract 0.5 per WARNING finding, capped at 4.0 total WARNING deduction (i.e. warnings alone cannot push the score below 6.0)
- INFO findings don't affect score
- Minimum score is 0.0
- Formula: `score = max(0.0, 10.0 - (2.0 × CRITICAL_count) - min(0.5 × WARNING_count, 4.0))`

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

**Score bar** — visual progress bar, 20 chars wide. Fill proportionally to score (e.g. 9.5/10.0 = 19 filled). Use `█` for filled, `░` for empty:
```
  Score  [███████████████████░]  9.5 / 10.0
         Critical: 0  ·  Warnings: 1  ·  Info: 1
```

**Color coding** — use bold + color tokens to make the score pop:
- Score >= 9.0: show score in **green** (`**9.5 / 10.0**` — the agent should render the number prominently)
- Score 5.0–8.9: show score in **yellow**
- Score < 5.0: show score in **red**
- Severity counts: Critical count in **red** (if > 0), Warnings in **yellow** (if > 0), Info stays neutral
- Section headers (CRITICAL/WARNING/INFO): use `🔴` for CRITICAL, `🟡` for WARNING, `🔵` for INFO before the section name
- Perfect score (10.0): add `✅` before the score line

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

**Area breakdown** — icon-based status grid with fixed-width area names. Pad every area name to the same width (longest area name in the report, typically 12 chars for `pre-commit`) so the notes column aligns perfectly:
```
━━━ AREA STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ ruff           All rules present, format clean
  ✅ pyright        basic mode, no errors
  ⚠️  pre-commit    Missing ruff-format hook
  ❌ CI             No lint job
  ✅ pyproject      Complete
```
Icons: `✅` = PASS (0 findings), `⚠️` = has warnings only, `❌` = has critical findings. Right-pad every area name with spaces so the description column starts at the same position on every line. Only list areas that were audited (detected or explicitly requested).

**Summary footer** — compact open-right single-line box (keep this short, NO priority list here):
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

**Next steps** — only if there are action items. List outside the box with a section header, one item per line. Order by severity (critical first), then by impact:
```
━━━ NEXT STEPS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1.  Add .pre-commit-config.yaml with ruff hooks
  2.  Add CI workflow (.github/workflows/ci.yml)
  3.  Move ruff lint config to [tool.ruff.lint] and add S rules
  4.  Add pyrightconfig.json for type checking
```

### Rules
- Project name: derived from detection JSON `project_name` field
- Date: use today's date
- Group findings by severity, then by area within each severity
- Each finding must include a concrete, copy-pasteable fix (command, config snippet, or file to create)
- If a CRITICAL finding has a one-liner fix, include the exact command

### Save findings locally

After outputting the report, persist the structured findings to `.infra-audit/` so `/infra-fix` can reuse them without re-auditing.

**Write `.infra-audit/findings.json`** using Bash (silent bookkeeping — do not print to user):
```bash
cat <<'EOF' > .infra-audit/findings.json
{
  "date": "{today}",
  "score": {score},
  "critical": {critical_count},
  "warnings": {warning_count},
  "info": {info_count},
  "findings": [
    {
      "severity": "CRITICAL|WARNING|INFO",
      "area": "{area}",
      "description": "{short description}",
      "current": "{what was found}",
      "expected": "{what blueprint recommends}",
      "fix": "{actionable fix}",
      "status": "open"
    }
  ]
}
EOF
```

Every finding from the report must appear in the `findings` array with `"status": "open"`. These are template variables — fill them from the actual audit results at runtime. This file is the bridge between `/infra-audit` and `/infra-fix`.

### Save audit history

After outputting the report, persist the results so future sessions have context on what was audited and when.

**History location:** `~/.claude/infra/history/`

**Filename with path hash:**
```bash
SANITIZED="{project-name}"   # same sanitized name from the report
PATH_HASH=$(echo -n "$(pwd)" | sha256sum | cut -c1-8)
HISTORY_FILE="$HOME/.claude/infra/history/${SANITIZED}-${PATH_HASH}.json"
LEGACY_FILE="$HOME/.claude/infra/history/${SANITIZED}.json"
```

**Read existing history** (use Bash, not the Read tool — history files are outside the project tree):
```bash
if [ -f "$HISTORY_FILE" ]; then
  cat "$HISTORY_FILE"
elif [ -f "$LEGACY_FILE" ]; then
  cat "$LEGACY_FILE"
else
  echo "{}"
fi
```
Parse the JSON output. If the file has no `runs` array (v1 schema), seed the array with one entry from the existing top-level fields:
   ```json
   {"date": "{last_audit}", "type": "audit", "score": {score}, "critical": {critical}, "warnings": {warnings}, "info": {info}}
   ```
   If the file also has a `last_fix` field, add a second seed entry:
   ```json
   {"date": "{last_fix}", "type": "fix", "score": {score}, "critical": {critical}, "warnings": {warnings}, "info": {info}}
   ```
   Sort the seeded entries by date.
4. If no history file exists at all, start with an empty `runs` array

**Append current run:**
```json
{"date": "{today}", "type": "audit", "score": {score}, "critical": {critical}, "warnings": {warnings}, "info": {info}}
```
If `runs` has more than 50 entries after appending, drop the oldest entries to keep only the last 50.

**Write schema v2 JSON:**
```json
{
  "schema_version": 2,
  "project": "{project-name}",
  "path": "{absolute-repo-path}",
  "last_audit": "{today}",
  "score": {score},
  "critical": {critical},
  "warnings": {warnings},
  "info": {info},
  "findings": [ ... ],
  "runs": [ ... ]
}
```

**IMPORTANT:** Use Bash with `mkdir -p` and `cat <<'EOF' > file` (heredoc) to write the JSON file — do NOT use the Write tool, as its output renders the full file contents to the user and clutters the report.

**Cleanup legacy file:** If `$LEGACY_FILE` exists and differs from `$HISTORY_FILE`, remove `$LEGACY_FILE` after writing the new file. This is silent bookkeeping — do NOT print anything about it to the user.

**Keep `.infra-audit/`:** Do NOT delete the `.infra-audit/` directory — it persists between runs so `/infra-fix` can reuse the detection and findings data.
