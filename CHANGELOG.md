# Changelog

## 1.1.0 (2025-02-16)

### New commands

- `/infra:fix` — Auto-fix audit findings using wave-based parallel agents (critical, warnings, or all)
- `/infra:status` — Dashboard showing score, trend, run history, and staleness warnings

### New audit areas

- **Dead code** — Vulture-based detection of unused functions, classes, variables, and imports
- **CLAUDE.md** — Validates presence, project description, tech stack, and dev workflow coverage
- **Tests** — Detects test files, pytest-cov config, coverage thresholds, and inline-snapshot usage
- **Renovate** — Checks for config and matching CI workflow

### Detection & verification scripts

- `infra/scripts/detect.sh` — Project detection (frameworks, tools, config files, venv, Python version)
- `infra/scripts/verify.sh` — Local CI verification (ruff, pyright, pytest, format checks)

### Blueprint enhancements

- Added canonical CI workflow template (`infra/blueprints/ci.yml`)
- Added canonical Renovate config template (`infra/blueprints/renovate.yml`)
- Expanded blueprint with Vulture, inline-snapshot, Renovate, and CLAUDE.md standards

### Audit improvements

- Phase 1b: Local CI verification — runs linting, formatting, type checking, and test collection locally
- Test execution with coverage checks and threshold validation
- Inline-snapshot detection for Pydantic projects (warns when `.model_dump()` assertions lack `snapshot()`)
- Config file detection expanded to cover more patterns and file types
- Secrets management checks clarified
- Renovate workflow presence check when Renovate config exists
- CI Python version consistency checks
- Unified history file handling with path-hashed filenames (v2 schema, supports multi-repo)

### Fix command features

- Wave-based execution: foundation → config files → environment → validation
- Parallel sub-agents for independent fixes within a wave
- Vulture setup recipe (config, pre-commit hook, framework-specific `ignore_decorators`)
- Inline-snapshot setup recipe (install, assertion refactoring, dirty-equals for dynamic values)
- Before/after score comparison with color-coded results
- Audit history updated after fix runs (`"type": "fix"` entries)

### Installer

- Installs `fix.md`, `status.md`, detection scripts, blueprint YAMLs, and `VERSION` file
- Installer post-install message lists all available commands

### Housekeeping

- Moved dev/publishing docs to `RELEASING.md`

## 1.0.0 (2025-02-15)

Initial release.

- `/infra:audit` — Audit Python project infrastructure against blueprint
- `/infra:update` — Self-update command
- Background update checker (SessionStart hook)
- Selective file install (preserves other files in `commands/infra/`)
- Additive `settings.json` merge (coexists with GSD and other skills)
- Local patch backup on update
- SHA256 file manifest for modification detection
- `--global` (default) and `--local` install modes
- `--uninstall` for clean removal
