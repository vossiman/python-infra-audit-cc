---
name: infra-fix
description: Use when fixing infrastructure audit findings — dispatches parallel agents
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
argument-hint: "[severity] (all|critical|warnings)"
---

You are an infrastructure fixer. Your job is to resolve findings from an `infra-audit` run by applying the fixes described in the blueprint. You WRITE files — this is not a read-only operation.

**Reference files** — read these at the start of Phase 1 using Bash `cat` (they live outside the project tree; avoid the Read tool):
- Blueprint standards: `~/.claude/infra/blueprint.md`
- Version baselines: `~/.claude/infra/versions.yml`
- CI workflow template: `~/.claude/infra/blueprints/ci.yml` (needed when fixing CI)
- Renovate config template: `~/.claude/infra/blueprints/renovate.yml` (needed when fixing Renovate)

The user may optionally limit scope: `$ARGUMENTS`
- `all` or empty: fix all CRITICAL and WARNING findings
- `critical`: fix only CRITICAL findings
- `warnings`: fix only WARNING findings

---

## Phase 1: Load or Run Audit

First, read the reference files (single Bash call):

**Bash call 1 — read reference files:**
```bash
cat ~/.claude/infra/blueprint.md
cat ~/.claude/infra/versions.yml
cat ~/.claude/infra/blueprints/ci.yml
cat ~/.claude/infra/blueprints/renovate.yml
```
This is silent bookkeeping — parse and retain the standards, do not echo to the user.

**Check for existing audit data:**

```bash
if [ -f .infra-audit/findings.json ] && [ -f .infra-audit/detect.json ]; then
  echo "AUDIT_EXISTS"
  cat .infra-audit/findings.json
  cat .infra-audit/detect.json
else
  echo "NO_AUDIT"
fi
```

Ensure `.infra-audit/` is gitignored (idempotent — safe to run even if entry already exists):
```bash
grep -qxF ".infra-audit/" .gitignore 2>/dev/null || echo ".infra-audit/" >> .gitignore
```

**If `AUDIT_EXISTS`:** Parse the findings and detection JSON. These were saved by a previous `/infra-audit` or `/infra-fix` run. Skip detection and verification — use the persisted data directly:

1. Parse `findings.json` — filter to findings with `"status": "open"` only. Skip any already marked `"fixed"`.
2. Parse `detect.json` — retain the detection context for sub-agents and fix recipes.
3. Note the audit date from `findings.json` for the summary.

If only one of the two files exists (e.g., `findings.json` without `detect.json`), treat the data as incomplete and fall through to the `NO_AUDIT` branch to re-detect from scratch.

**If `NO_AUDIT`:** Run detection and verification from scratch:

```bash
AUDIT_TMPDIR=".infra-audit"
mkdir -p "$AUDIT_TMPDIR"
DETECT_JSON="$AUDIT_TMPDIR/detect.json"
bash ~/.claude/infra/scripts/detect.sh > "$DETECT_JSON"
```

**If detect.sh exits non-zero or the output file is empty/missing, stop immediately** with an error message: "Detection failed — cannot proceed with fix." Do not continue to verification or fix phases.

Parse the detection JSON (read via `cat .infra-audit/detect.json` — silent bookkeeping), then run CI verification:
```bash
AUDIT_TMPDIR=".infra-audit"
DETECT_JSON="$AUDIT_TMPDIR/detect.json"
VERIFY_JSON="$AUDIT_TMPDIR/verify.json"
bash ~/.claude/infra/scripts/verify.sh "$DETECT_JSON" > "$VERIFY_JSON" && echo "verify.sh complete"
```

Read the verification results via `cat .infra-audit/verify.json` (silent bookkeeping).

Using the detection context and verification results, compare against the blueprint to collect all findings with their severity, area, and fix instructions. Follow the same audit triggers and severity rules as `infra-audit`.

Save findings locally using the same `findings.json` schema as defined in `infra-audit` Phase 3 — all findings with `"status": "open"`. Write using Bash heredoc (silent bookkeeping).

**Both branches converge here.** Do NOT output the full audit report. Instead, collect the findings into a structured list you'll use in Phase 2.

Print a brief summary (for both reused and fresh audit data):
```
━━━ INFRA FIX ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Found: {n} critical, {n} warnings, {n} info
  Fixing: {describe scope based on $ARGUMENTS}
```
If reusing existing audit data, add a line: `  Using audit from {date}` (from findings.json `date` field).

If 0 open/fixable findings remain, print "Nothing to fix — project scores 10/10." and stop.

---

## Phase 2: Plan fix waves

Group findings into **waves** — sets of fixes that can be applied in parallel because they touch independent files. Fixes within the same wave MUST NOT touch overlapping files.

Use this wave ordering (skip waves that have no findings):

| Wave | Areas | Why first |
|------|-------|-----------|
| 1 — Foundation | git, .gitignore, pyproject.toml | Everything else depends on these |
| 2 — Config files | ruff config, pyright config, pre-commit config, CI workflows, renovate config, Makefile, alembic, example.env | Independent config files — safe to parallelize |
| 3 — Environment | venv creation, tool installation (`uv sync`) | Depends on pyproject.toml having correct dev deps |
| 4 — Validation | Re-run audit | Verify all fixes landed correctly |

Print the plan:
```
  Wave 1 — Foundation (2 fixes)
    - Initialize git repo
    - Add .gitignore

  Wave 2 — Config files (4 fixes, parallel)
    - Add .pre-commit-config.yaml
    - Add CI workflow
    - Add renovate config
    - Add pyrightconfig.json

  Wave 3 — Environment (1 fix)
    - Create venv and install dev tools

  Wave 4 — Validation
    - Re-run audit to verify
```

---

## Phase 3: Execute fixes

### Strategy selection

**If 2+ fixes in a wave → use parallel sub-agents:**

1. For each fix, spawn a `general-purpose` sub-agent via the `Task` tool
2. Run all sub-agents for the wave in a single message (parallel tool calls)
3. Collect results and proceed to the next wave

**If only 1 fix in a wave → just do it directly.** No agents needed.

### Running Python tools and commands

**IMPORTANT:** Never use bare `python`, `ruff`, `pytest`, `pre-commit`, or any other Python tool directly. Always use the project's local environment:

**Priority order for running commands:**

1. **Local venv exists (`.venv/bin/`)** — use it directly:
   ```bash
   .venv/bin/python ...
   .venv/bin/ruff check .
   .venv/bin/pytest tests/
   .venv/bin/pre-commit install
   ```

2. **No venv but `uv` is available** — use `uv run` which auto-resolves the environment:
   ```bash
   uv run python ...
   uv run ruff check .
   uv run pytest tests/
   uv run pre-commit install
   ```

3. **Neither** — create the venv first (see venv recipe below), then use option 1.

At the start of Phase 3, detect which mode to use:
```bash
# Check for local venv
test -x .venv/bin/python && echo "venv" || echo "no-venv"
# Check for uv
command -v uv && echo "uv" || echo "no-uv"
```

Store the result and use it consistently for ALL Bash commands throughout the fix session. Pass this context to every sub-agent/teammate so they use the same execution mode.

### Fix execution rules

Each fix must:
1. **Read before writing** — always read the target file first if it exists, to preserve existing content
2. **Use the blueprint as the source of truth** — copy config snippets from the blueprint, adapting `[ADAPT]` values to match the project
3. **Adapt to the project** — detect Python version from `requires-python`, detect source directories from the file tree, detect the project name from `pyproject.toml`
4. **Be atomic** — each fix should result in a valid, working config file. No partial writes.
5. **Never delete user content** — when adding to existing files (like adding ruff rules to `pyproject.toml`), merge with existing config, don't replace it
6. **Use the project's local Python environment** — see "Running Python tools and commands" above. Never use globally installed tools.

### Post-wave verification

After each wave completes (all fixes in the wave applied), re-run **both** detection and verification. Detection must be re-run because fixes may have added new infrastructure (e.g., a new `.pre-commit-config.yaml`), and verify.sh reads detect.json to decide what to check — stale detection data would cause it to skip verification of newly-added areas.

```bash
AUDIT_TMPDIR=".infra-audit"
DETECT_JSON="$AUDIT_TMPDIR/detect.json"
VERIFY_JSON="$AUDIT_TMPDIR/verify.json"
bash ~/.claude/infra/scripts/detect.sh > "$DETECT_JSON"
bash ~/.claude/infra/scripts/verify.sh "$DETECT_JSON" > "$VERIFY_JSON" && echo "verify.sh complete"
```

Read the updated detection and verification results (`cat .infra-audit/detect.json` and `cat .infra-audit/verify.json` — silent bookkeeping). For each finding that is now resolved, update its `status` to `"fixed"` in the in-memory findings list.

**Update `.infra-audit/findings.json`** after each wave (silent bookkeeping — use Bash heredoc). Write the full findings array with updated statuses. This ensures progress is persisted even if the session is interrupted between waves.

### Specific fix recipes

**git init:**
```bash
git init
```

**venv + tool installation:**
```bash
uv venv                       # creates .venv with correct Python
uv sync --all-extras          # installs all deps including dev
```
If `uv` is not the package manager, fall back to:
```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
```
After venv is created, all subsequent commands MUST use `.venv/bin/` prefix.

**pre-commit setup** (after creating config file and installing in venv):
```bash
.venv/bin/pre-commit install
```

**inline-snapshot setup** (when tests exist but inline-snapshot not in dependencies):
1. Add `inline-snapshot` (and `dirty-equals` if not present) to `[project.optional-dependencies] dev` in `pyproject.toml`
2. Run `uv sync --all-extras` (or `.venv/bin/pip install -e ".[dev]"`) to install
3. If test files contain hand-written assertions against Pydantic `.model_dump()` / `.dict()` output (e.g. `assert result.model_dump() == {"field": "value", ...}`), refactor them to use `snapshot()`:
   ```python
   from inline_snapshot import snapshot
   # Before: assert user.model_dump() == {"id": 1, "name": "test"}
   # After:
   assert user.model_dump() == snapshot({"id": 1, "name": "test"})
   ```
   For dynamic values (timestamps, auto-generated IDs), combine with `dirty-equals`:
   ```python
   from dirty_equals import IsInt, IsNow
   assert user.model_dump() == snapshot({"id": IsInt(), "created_at": IsNow(), "name": "test"})
   ```
4. Verify with: `.venv/bin/pytest --inline-snapshot=short-report` — should pass without snapshot updates needed

**Verifying a fix worked** — always validate using the local environment:
```bash
.venv/bin/ruff check . --preview    # or: uv run ruff check .
.venv/bin/ruff format --check .     # or: uv run ruff format --check .
```

**vulture setup** (full install — when vulture not configured):
1. Add `vulture>=2.15` to `[project.optional-dependencies] dev` in `pyproject.toml`
2. Run `uv sync --all-extras` (or `.venv/bin/pip install -e ".[dev]"`) to install
3. Add `[tool.vulture]` config to `pyproject.toml` with `paths`, `min_confidence = 80`, and `exclude` list
4. **Framework-specific `ignore_decorators`**: inspect detection JSON `frameworks` field, add only relevant decorators:
   - Flask: `@app.route`
   - FastAPI: `@app.get`, `@app.post`, `@app.put`, `@app.delete`, `@router.get`, `@router.post`, `@router.put`, `@router.delete`
   - Pydantic: `@validator`, `@field_validator`, `@model_validator`, `@computed_field`
   - Celery: `@celery.task`, `@shared_task`
   - Click: `@click.command`, `@click.group`
   - Django: `@receiver`, `@admin.register`
   - Always add `@pytest.fixture` when tests exist
5. Add vulture pre-commit hook to `.pre-commit-config.yaml`:
   ```yaml
     - repo: https://github.com/jendrikseipp/vulture
       rev: v2.15  # [ADAPT] match installed vulture version — see versions.yml for baseline
       hooks:
         - id: vulture
   ```
6. Optionally bootstrap whitelist: `.venv/bin/vulture --make-whitelist > vulture_whitelist_candidates.py` — offer for review, do NOT auto-commit
7. Verify: `.venv/bin/vulture` (reads pyproject.toml config)

**vulture pre-commit hook** (standalone — vulture installed but no hook):
1. Ensure `[tool.vulture]` exists in `pyproject.toml` first (add it if missing — see vulture config recipe)
2. Append vulture hook to `.pre-commit-config.yaml`
3. Run `.venv/bin/pre-commit install`

**vulture config** (standalone — vulture installed but no `[tool.vulture]`):
1. Add `[tool.vulture]` config block to `pyproject.toml` with `paths`, `min_confidence = 80`, and `exclude` list
2. Add framework-appropriate `ignore_decorators` based on detection JSON `frameworks` field (see list above)
3. Verify: `.venv/bin/vulture` (should read the new config)

**dead code cleanup** (when vulture findings exist):
- Do NOT auto-delete — dead code removal requires human judgment
- List findings for user review
- Common safe removals: unused imports (already caught by ruff F401), unused local variables
- Caution: unused functions/classes may be invoked dynamically or via external entry points

**renovate config** (when renovate config is missing or incomplete):
1. Create `renovate.json` (or update existing) using the recommended config from the blueprint's "Recommended `renovate.json`" section
2. Key settings to ensure are present:
   - `"extends": ["config:best-practices", ":maintainLockFilesMonthly"]` — full best-practices baseline with monthly lock file maintenance
   - `"baseBranchPatterns"` — should target `develop`/`test`, not `main` directly. **`[ADAPT]`** to the project's actual branch names
   - `rangeStrategy: "bump"` in a `packageRules` entry matching `pep621` manager — ensures `>=` floors get bumped
   - `automerge: false` for `github-actions` and `pre-commit` managers — these should be reviewed
   - `prHourlyLimit: 0` when using a monthly schedule — prevents updates from being drip-fed across months
   - `osvVulnerabilityAlerts: true` — free PyPI vulnerability scanning
   - `minimumReleaseAge: "3 days"` for `pypi` datasource — stability gate against broken/malicious releases
3. Ensure `.github/workflows/renovate.yml` exists (use the blueprint workflow as reference)
4. Verify JSON: `python3 -c "import json; json.load(open('renovate.json')); print('valid')"`

**pre-commit hook revs** (when hook revs are behind baselines):
- If Renovate is configured with `pre-commit` manager: trigger a Renovate run (`workflow_dispatch`) or wait for next scheduled run — Renovate will propose rev bump PRs
- If no Renovate: run `pre-commit autoupdate` to bump all hooks, or `pre-commit autoupdate --repo <url>` for a specific hook
- After updating: run `pre-commit run --all-files` to verify no hooks break with the new versions

For all other areas (ruff, pyright, CI, renovate, etc.), create/update the config file using the blueprint as reference.

---

## Phase 4: Validation

After all waves complete, re-run the audit logic and print a before/after summary:

```
━━━ RESULTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Before:  5.5 / 10.0  (2 critical, 3 warnings)
  After:   9.5 / 10.0  (0 critical, 1 warning)

  Fixed:
    [x] Added .pre-commit-config.yaml
    [x] Added CI workflow
    [x] Added ruff security rules
    [x] Created venv with dev tools

  Remaining:
    -- [INFO] ruff line-length is 88 (preference)
```

**Color coding:**
- Before score in **red** or **yellow** (depending on severity)
- After score in **green** (if improved to >= 9.0), **yellow** (5.0–8.9), or **red** (< 5.0)
- `[x]` fixed items in **green**
- Remaining items keep their severity color (red/yellow/neutral)

If any fixes failed or the score didn't improve as expected, list what went wrong and suggest manual steps.

### Update local findings

Update `.infra-audit/findings.json` with the final state — all successfully fixed findings marked as `"fixed"`, remaining findings keep `"open"` status. Update the top-level `score`, `critical`, `warnings`, `info` counts to reflect the post-fix state. Update `date` to today.

Write using Bash heredoc (silent bookkeeping).

### Update audit history

After validation, update the audit history file using the same filename and migration logic as `infra-audit` Phase 3.

**Filename with path hash:**
```bash
SANITIZED="{project-name}"   # sanitized project name
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
Parse the JSON output:
- If the file has no `runs` array (v1 schema), seed the array from top-level fields (same logic as `infra-audit` Phase 3)
- If no file exists (empty JSON from `echo "{}"`), start with an empty `runs` array

**Append current run** — add a new entry with `"type": "fix"`:
```json
{"date": "{today}", "type": "fix", "score": {score}, "critical": {critical}, "warnings": {warnings}, "info": {info}}
```

If `runs` has more than 50 entries after appending, drop the oldest to keep only the last 50.

**Write schema v2 JSON** — same format as `infra-audit` Phase 3, but also set the `last_fix` field:
```json
{
  "schema_version": 2,
  "project": "{project-name}",
  "path": "{absolute-repo-path}",
  "last_audit": "{last_audit from existing history, or today}",
  "last_fix": "{today}",
  "score": {score},
  "critical": {critical},
  "warnings": {warnings},
  "info": {info},
  "findings": [ ... ],
  "runs": [ ... ]
}
```

**Cleanup:** If `$LEGACY_FILE` exists and differs from `$HISTORY_FILE`, remove it after writing.

**Keep `.infra-audit/`:** Do NOT delete the `.infra-audit/` directory — it persists between runs. The updated `findings.json` reflects which findings are fixed and which remain open.

**IMPORTANT:** Use Bash with `mkdir -p` and `cat <<'EOF' > file` (heredoc) to write the JSON — do NOT use the Write tool, as its output renders the full file contents to the user and clutters the report. This is silent bookkeeping — do not print anything about it to the user.

---

## Rules

- Never modify files that aren't related to the audit findings
- Never commit changes — leave that to the user
- If a fix requires user input (e.g., choosing source directories for pyright `include`), use `AskUserQuestion` to ask
- If a file already exists and is partially correct, edit it to add missing parts — don't overwrite the whole file
- Always adapt `[ADAPT]` values from the blueprint to match the actual project (Python version, project name, source dirs, etc.)
- INFO findings are never auto-fixed — they represent legitimate preferences
