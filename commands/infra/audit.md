---
name: infra:audit
description: Audit Python project infrastructure against known-good blueprint
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - TeamCreate
  - TeamDelete
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
  - SendMessage
argument-hint: "[area] (git|ruff|pyright|pre-commit|ci|renovate|pyproject|uv|venv|docker|makefile|alembic|env|tests|claude-md|all)"
---

You are an infrastructure auditor. Audit the current project against the standards in the blueprint below. Do NOT modify any files — this is a read-only audit.

@~/.claude/infra/blueprint.md

**Blueprint YAML files** — the blueprint references canonical workflow files. When auditing CI or Renovate, read the corresponding YAML for the full expected configuration:
- CI: `~/.claude/infra/blueprints/ci.yml`
- Renovate: `~/.claude/infra/blueprints/renovate.yml`

The user may optionally specify an area to audit: `$ARGUMENTS`

If `$ARGUMENTS` is empty or "all", audit all applicable areas. Otherwise audit only the specified area(s).

---

## Phase 1: Detection

Scan the project root for key files to determine which infrastructure areas exist. Use Glob to check for:

| Area | Detection files |
|------|----------------|
| git | `.git/` directory exists |
| ruff | `pyproject.toml` containing `[tool.ruff]`, or `ruff.toml` |
| pyright | `pyrightconfig.json` |
| pre-commit | `.pre-commit-config.yaml` |
| ci | `.github/workflows/*.yml` or `.gitlab-ci.yml` or `.circleci/config.yml` |
| pyproject | `pyproject.toml` |
| uv | `uv.lock` in root or subdirectories |
| docker | `Dockerfile*` or `compose.yml` or `docker-compose.yml` |
| makefile | `Makefile` |
| alembic | `alembic.ini` |
| renovate | `renovate.json`, `.renovaterc`, `.renovaterc.json`, or `.github/renovate.json` |
| venv | `.venv/bin/python` exists and is executable |
| env | Config pattern — detect which config mechanism the project uses. Check for `.env`, `config.json`, `config.yaml`, `config.toml`, `settings.json`, `settings.yaml`, `.env.*` variants. Then check `.gitignore` for matching patterns and look for a corresponding example/template file (e.g. `example.env`, `config.example.json`, `config.json.example`). |
| tests | `tests/` directory, or `test_*.py` / `*_test.py` files anywhere in the project. Also check for coverage config: `pytest-cov` in `pyproject.toml` dependencies, `[tool.coverage]` or `[tool.pytest.ini_options]` with `--cov` in `pyproject.toml`, or `.coveragerc` |
| claude-md | `CLAUDE.md` in project root, `.claude/CLAUDE.md`, or `CLAUDE.md` files in subdirectories |

Print a styled detection summary using checkmarks and crosses. Split across two rows for readability:
```
━━━ DETECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [x] ruff        [x] pyright     [ ] pre-commit  [x] CI          [x] pyproject
  [x] uv          [ ] docker      [x] makefile    [x] alembic     [x] env
  [x] tests       [x] claude-md
```
Use `[x]` for detected and `[ ]` for not found.

**venv probing** — when a `.venv` is detected, use Bash to inventory installed dev tools. Run each command and record the version or "missing":
```bash
.venv/bin/python --version
.venv/bin/ruff --version
.venv/bin/pytest --version
.venv/bin/pre-commit --version
```
For pyright, check `npx pyright --version` (node-based) OR `.venv/bin/pyright --version` (pip-based) — either is acceptable.

Also verify the venv's Python version matches `requires-python` from `pyproject.toml`.

Skip areas that are not detected AND not explicitly requested. If the user requests a specific area that isn't detected, report it as a CRITICAL finding (missing entirely).

---

## Phase 1b: Local CI Verification

If a `.venv` is detected, actually **run** the detected tools and record pass/fail. This catches the case where config looks correct but the tools themselves fail — meaning CI will reject the code. Each tool run should capture both exit code and stderr summary.

Run these checks sequentially via Bash (they're fast and have no side effects):

**1. Ruff lint** (when ruff detected):
```bash
.venv/bin/ruff check . 2>&1; echo "EXIT:$?"
```

**2. Ruff format** (when ruff detected):
```bash
.venv/bin/ruff format --check . 2>&1; echo "EXIT:$?"
```

**3. Pyright** (when pyright detected):
```bash
npx pyright 2>&1; echo "EXIT:$?"
# OR: .venv/bin/pyright 2>&1; echo "EXIT:$?"
```

**4. Pre-commit** (when `.pre-commit-config.yaml` detected and pre-commit installed):
```bash
.venv/bin/pre-commit run --all-files 2>&1; echo "EXIT:$?"
```

**5. Test collection** (when tests detected — collection only, no execution):
```bash
.venv/bin/pytest --collect-only -q 2>&1; echo "EXIT:$?"
```

For each tool, record:
- **pass**: exit code 0
- **fail**: exit code non-zero — capture the first 10 lines of output as context for the finding

Also check for **version mismatches** that cause silent drift:
- Compare ruff version in `.venv/bin/ruff --version` against the version pinned in `.pre-commit-config.yaml` (under `repo: https://github.com/astral-sh/ruff-pre-commit`, `rev:` field)
- Compare ruff version against what CI installs (if CI pins a specific version)
- If pre-commit is installed, check that hooks are actually registered: run `git config --get core.hooksPath` or check `.git/hooks/pre-commit` exists

### Local CI verification triggers

**CRITICAL:**
- `ruff check .` fails locally (CI will reject this code)
- `ruff format --check .` fails locally (CI will reject unformatted code)
- `pre-commit run --all-files` fails locally (CI runs the same hooks)
- `pytest --collect-only` fails (test collection broken — CI can't even discover tests)

**WARNING:**
- Pyright fails locally (type errors CI may catch)
- ruff version in `.venv` differs from version pinned in `.pre-commit-config.yaml` (silent behavior differences between local dev and hooks)
- ruff version in `.venv` differs from version used in CI workflow (local passes, CI fails or vice versa)
- Pre-commit hooks not registered in `.git/hooks/` when `.pre-commit-config.yaml` exists (hooks won't run on commit, issues slip through to CI)

---

## Phase 2: Audit

### Parallel execution strategy

After detection, you know which areas to audit. Each area's audit is independent — they read different config files and check different things. Parallelize them:

**If 4+ areas to audit → use an agent team:**

1. Create a team with `TeamCreate` (name: `infra-audit`)
2. For each area, create a task with `TaskCreate` containing:
   - The area name
   - Which files to read and what to check (from the triggers below)
   - The relevant blueprint section for comparison
   - The detection results (which files exist, venv tool versions)
3. Spawn one `Explore` agent per area using the `Task` tool with `team_name` set — these agents are read-only which is what we need
4. Each agent returns its findings as a structured list: `severity | area | short description | current | expected | fix`
5. Collect all findings, tear down the team with `TeamDelete`, proceed to Phase 3

**If 2-3 areas to audit → use parallel sub-agents:**

1. Spawn one `Explore` sub-agent per area via the `Task` tool (no team)
2. Launch all sub-agents in a single message (parallel tool calls)
3. Each returns findings in the same structured format
4. Collect and proceed to Phase 3

**If only 1 area → audit it directly.** No agents needed.

**Sub-agent prompt template** — every agent (team or sub-agent) must receive:
- The area it's responsible for
- The detection context (which files were found, venv tool versions if relevant)
- The project's `requires-python` value (if found)
- The full list of triggers below relevant to its area
- The blueprint standards for its area
- Instruction to return findings as: `severity | area | description | current | expected | fix`
- Instruction that this is READ-ONLY — no file modifications

### Audit criteria

For each applicable area, read the relevant config files and compare against the blueprint standards. Classify each finding:

| Severity | Criteria | Score Impact |
|----------|----------|-------------|
| **CRITICAL** | Security risks, committed secrets, broken CI, completely missing essential config | -2 per finding |
| **WARNING** | Best-practice deviations that may cause issues in practice | -0.5 per finding |
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
- No test files at all (`tests/`, `test_*.py`, `*_test.py`) when Python source files exist — this is CRITICAL even if `pyproject.toml` configures testpaths or CI runs pytest, because that means CI is running against nothing

### WARNING triggers (common issues)
- ruff configured but missing security rules (`S`)
- ruff configured but missing import sorting (`I`)
- ruff configured but missing complexity rules (`C901`, `PLR0913`, `PLR0912`, `PLR0915`) or missing `[tool.ruff.lint.mccabe]` / `[tool.ruff.lint.pylint]` thresholds
- No type checker configured (pyright or mypy)
- pre-commit hooks missing `ruff-format` (lint without format)
- CI exists but doesn't run linting
- CI exists but doesn't run tests
- `pyproject.toml` missing `requires-python`
- Docker images not SHA256-pinned
- Docker using `pip install` instead of lockfile-based install
- Makefile missing `help` target
- Alembic `env.py` missing model imports for autogenerate
- No example/template for the project's config file (e.g. no `example.env` when `.env` is gitignored, no `config.example.json` or `config.json.example` when `config.json` is gitignored). Only flag this for whichever config mechanism the project actually uses — don't require `example.env` if the project uses `config.json` instead
- `.venv` exists but `ruff` not installed (when ruff config is present)
- `.venv` exists but `pytest` not installed (when test files exist)
- `.venv` exists but `pre-commit` not installed (when `.pre-commit-config.yaml` exists)
- `.venv` Python version doesn't match `requires-python` from `pyproject.toml`
- No renovate config when CI exists (no automated dependency updates)
- Renovate config exists but no `.github/workflows/renovate.yml` (self-hosted workflow required)
- Tests exist but no coverage configuration (`pytest-cov` not in dependencies AND no `[tool.coverage]`/`.coveragerc`)
- Coverage configured but no minimum threshold (`fail_under` not set in `[tool.coverage.report]`, `.coveragerc`, or `--cov-fail-under` in pytest args)
- CI runs tests but doesn't collect or report coverage (no `--cov` flag or coverage step in CI workflow)
- CI `python-version` doesn't match local `.venv` Python version (dev/CI divergence — code may use features unavailable in CI's older Python)
- Renovate or CI workflow uses GitHub Actions versions more than 1 major version behind the blueprint (e.g., `actions/checkout@v4` when blueprint has `@v6` — missed security patches)

### INFO triggers (suggestions)
- ruff `line-length` differs from 120 (legitimate preference)
- pyright mode is `off` or not `basic`/`standard`/`strict`
- Different build backend (setuptools vs hatchling vs flit)
- Tests exist but no `asyncio_mode` configured (may not need async)
- Alternative CI provider (GitLab, CircleCI) — just note it
- `docker-compose.yml` instead of `compose.yml` (old naming, still works)
- Pyright not installed locally (may be run via CI only)
- Coverage threshold below 80% (may be intentional for early-stage projects)
- Tests exist but no `conftest.py` (may not need shared fixtures)
- Low test-to-source ratio — count `test_*.py`/`*_test.py` files vs `*.py` source files (excluding `__init__.py`, `conftest.py`); flag if ratio is below 0.5

---

## Phase 2b: CLAUDE.md Audit

This audit is cross-cutting — it validates that the project's CLAUDE.md accurately reflects the actual infrastructure. It runs as its own dedicated team after Phase 2 completes, because it needs both the detection results AND the infra audit findings as context.

**Skip this phase** if `claude-md` was not detected AND not explicitly requested. If the user requested only a specific non-claude-md area, also skip.

### Team strategy — always use a dedicated team

The CLAUDE.md audit always spawns its own team (`claude-md-audit`) with three parallel agents:

1. **Extractor** (`Explore` agent) — Reads all CLAUDE.md files found in the project. Extracts and categorizes every claim:
   - **Commands**: shell commands, make targets, script invocations (e.g., `make lint`, `uv run pytest`, `./scripts/deploy.sh`)
   - **File references**: paths mentioned as important (e.g., "edit `.env`", "see `config.yaml`")
   - **Tool references**: dev tools mentioned (e.g., ruff, pyright, pytest, pre-commit, docker, alembic)
   - **Workflow references**: CI/CD, deployment, or automation mentions
   - **Package references**: Python packages mentioned by name
   - Returns a structured list of all extracted claims by category

2. **Verifier** (`Explore` agent) — Receives the extractor's claims and checks each against the actual project:
   - For commands: check that make targets exist in Makefile, scripts exist on disk, referenced binaries are in `.venv/bin/`
   - For file references: Glob to confirm each path exists
   - For tool references: cross-check against the Phase 1 detection results and venv probe
   - For package references: check against `pyproject.toml` dependencies
   - Returns: list of stale/broken references with `claim | type | status (valid/stale/broken) | details`

3. **Coverage checker** (`Explore` agent) — Receives the Phase 1 detection results and reads CLAUDE.md to find gaps:
   - For each detected infra area, check if CLAUDE.md mentions it or gives relevant guidance
   - Flag detected areas with zero CLAUDE.md coverage (e.g., project has Alembic but CLAUDE.md never mentions migrations)
   - Flag if common developer workflows are undocumented (how to run tests, how to lint, how to set up the project)
   - Returns: list of coverage gaps with `area | covered (yes/no) | details`

### Execution flow

1. Create team `claude-md-audit` with `TeamCreate`
2. Create tasks for all three agents
3. Spawn **Extractor** first — it must complete before the Verifier can start
4. Once Extractor returns, spawn **Verifier** and **Coverage checker** in parallel (Verifier gets the extracted claims; Coverage checker gets detection results)
5. Collect all findings, tear down team with `TeamDelete`
6. Merge findings into the main report alongside Phase 2 results

### CLAUDE.md audit triggers

**WARNING triggers:**
- CLAUDE.md references make targets that don't exist in the Makefile
- CLAUDE.md references commands or scripts that don't exist on disk
- CLAUDE.md mentions tools not installed in `.venv` (when venv exists)
- CLAUDE.md references files or paths that don't exist in the project
- CLAUDE.md mentions packages not found in `pyproject.toml` dependencies
- Detected infrastructure area has zero coverage in CLAUDE.md (e.g., Docker setup exists but CLAUDE.md never mentions containers, or Alembic exists but no migration guidance)
- CLAUDE.md describes workflows that contradict actual CI configuration (e.g., says "we use pytest-cov" but CI doesn't run coverage)
- No CLAUDE.md at all when project has 4+ detected infrastructure areas
- CLAUDE.md lists key files but is missing more than a third of the actual source files (stale — files were likely added after CLAUDE.md was written)

**INFO triggers:**
- CLAUDE.md exists but is very short (< 20 lines) for a project with 5+ infra areas
- CLAUDE.md doesn't describe how to set up the development environment
- CLAUDE.md doesn't describe how to run tests

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
- Project name: derived from `pyproject.toml` `[project] name` or the directory name
- Date: use today's date
- Group findings by severity, then by area within each severity
- Each finding must include a concrete, copy-pasteable fix (command, config snippet, or file to create)
- If a CRITICAL finding has a one-liner fix, include the exact command

---

## Phase 4: Save audit history

After outputting the report, persist the results so future sessions have context on what was audited and when.

**History location:** `~/.claude/infra/history/`

### Filename with path hash

Compute a unique filename to avoid collisions between repos with the same name in different directories:

```bash
SANITIZED="{project-name}"   # same sanitized name from Phase 3
PATH_HASH=$(echo -n "$(pwd)" | sha256sum | cut -c1-8)
HISTORY_FILE="$HOME/.claude/infra/history/${SANITIZED}-${PATH_HASH}.json"
LEGACY_FILE="$HOME/.claude/infra/history/${SANITIZED}.json"
```

### Read existing history

1. If `$HISTORY_FILE` exists, read it (via Read tool) and extract the `runs` array
2. Else if `$LEGACY_FILE` exists, read it instead — this is a v1 migration
3. If the file has no `runs` array (v1 schema), seed the array with one entry from the existing top-level fields:
   ```json
   {"date": "{last_audit}", "type": "audit", "score": {score}, "critical": {critical}, "warnings": {warnings}, "info": {info}}
   ```
   If the file also has a `last_fix` field, add a second seed entry:
   ```json
   {"date": "{last_fix}", "type": "fix", "score": {score}, "critical": {critical}, "warnings": {warnings}, "info": {info}}
   ```
   Sort the seeded entries by date.
4. If no history file exists at all, start with an empty `runs` array

### Append current run

Add a new entry to the `runs` array:
```json
{"date": "{today}", "type": "audit", "score": {score}, "critical": {critical}, "warnings": {warnings}, "info": {info}}
```

If `runs` has more than 50 entries after appending, drop the oldest entries to keep only the last 50.

### Write schema v2 JSON

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

### Cleanup legacy file

If `$LEGACY_FILE` exists and `$LEGACY_FILE` differs from `$HISTORY_FILE`, remove `$LEGACY_FILE` after writing the new file.

This is silent bookkeeping — do NOT print anything about it to the user.
