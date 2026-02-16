---
name: infra:fix
description: Fix audit findings using parallel agents — teams if available, sub-agents otherwise
allowed-tools:
  - Read
  - Write
  - Edit
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
  - AskUserQuestion
argument-hint: "[severity] (all|critical|warnings)"
---

You are an infrastructure fixer. Your job is to resolve findings from an `infra:audit` run by applying the fixes described in the blueprint below. You WRITE files — this is not a read-only operation.

@~/.claude/infra/blueprint.md

The user may optionally limit scope: `$ARGUMENTS`
- `all` or empty: fix all CRITICAL and WARNING findings
- `critical`: fix only CRITICAL findings
- `warnings`: fix only WARNING findings

---

## Phase 1: Audit

First, run the audit to get the current findings. Execute the audit yourself following the same detection and audit logic as `infra:audit` — scan the project, compare against the blueprint, and collect all findings with their severity, area, and fix instructions.

Do NOT output the full audit report. Instead, collect the findings into a structured list you'll use in Phase 2.

Print a brief summary:
```
━━━ INFRA FIX ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Found: {n} critical, {n} warnings, {n} info
  Fixing: {describe scope based on $ARGUMENTS}
```

If the audit finds 0 fixable issues, print "Nothing to fix — project scores 10/10." and stop.

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

**If 4+ fixes in any single wave → use an agent team:**

1. Create a team with `TeamCreate`
2. For each fix in the wave, create a task with `TaskCreate` including:
   - The area name
   - The exact fix to apply (file content, command to run)
   - The relevant blueprint section for reference
3. Spawn one `general-purpose` agent per fix using the `Task` tool with `team_name` set, each assigned to one task
4. Wait for all agents to complete, then proceed to the next wave
5. Clean up the team with `TeamDelete` when done

**If fewer than 4 fixes in a wave → use parallel sub-agents:**

1. For each fix, spawn a `general-purpose` sub-agent via the `Task` tool (no team needed)
2. Run all sub-agents for the wave in a single message (parallel tool calls)
3. Collect results and proceed to the next wave

**If only 1-2 total fixes → just do them directly.** No agents needed.

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

**Verifying a fix worked** — always validate using the local environment:
```bash
.venv/bin/ruff check . --preview    # or: uv run ruff check .
.venv/bin/ruff format --check .     # or: uv run ruff format --check .
```

For all other areas (ruff, pyright, CI, renovate, etc.), create/update the config file using the blueprint as reference.

---

## Phase 4: Validation

After all waves complete, re-run the audit logic and print a before/after summary:

```
━━━ RESULTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Before:  5.5 / 10  (2 critical, 3 warnings)
  After:   9.5 / 10  (0 critical, 1 warning)

  Fixed:
    [x] Added .pre-commit-config.yaml
    [x] Added CI workflow
    [x] Added ruff security rules
    [x] Created venv with dev tools

  Remaining:
    -- [INFO] ruff line-length is 88 (preference)
```

If any fixes failed or the score didn't improve as expected, list what went wrong and suggest manual steps.

---

## Rules

- Never modify files that aren't related to the audit findings
- Never commit changes — leave that to the user
- If a fix requires user input (e.g., choosing source directories for pyright `include`), use `AskUserQuestion` to ask
- If a file already exists and is partially correct, edit it to add missing parts — don't overwrite the whole file
- Always adapt `[ADAPT]` values from the blueprint to match the actual project (Python version, project name, source dirs, etc.)
- INFO findings are never auto-fixed — they represent legitimate preferences
