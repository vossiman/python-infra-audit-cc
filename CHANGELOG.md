# Changelog

## 1.2.0 (2026-04-03)

### Breaking changes

- Skill files moved from `commands/infra/*.md` to `skills/infra-*/SKILL.md` — existing installs are auto-migrated on update

### New features

- **Persistent `.infra-audit/` directory** — audit state (detect/verify JSON, findings, history) now lives in project-local `.infra-audit/` instead of `/tmp`, eliminating permission prompts and surviving across sessions
- `/infra-fix` reuses existing audit data when present (skips redundant re-detection)
- Findings tracked as fixed/open across fix waves

### Blueprint enhancements

- Renovate: `config:best-practices` preset, `osvVulnerabilityAlerts`, `minimumReleaseAge`, `lockFileMaintenance`, `rangeStrategy: bump`, `pinDigests`
- Pre-commit: added `check-merge-conflict`, `detect-private-key`, `check-case-conflict` to required hooks; rev baseline enforcement
- CI workflow: `postUpgradeTasks` example for monorepo sync-locks pattern
- Renovate blueprint: `rebaseWhen: "conflicted"`

### Audit improvements

- New warnings: outdated pre-commit revs, missing `config:best-practices`, missing `osvVulnerabilityAlerts`/`minimumReleaseAge`, missing `detect-private-key`, missing `rangeStrategy`/`pinDigests`
- Dedicated Renovate config fix recipe in `/infra-fix`

### Performance & compatibility

- Initial message size reduced from ~1200 to ~420 lines (blueprint loaded at runtime instead of compile-time)
- OpenCode permission prompts eliminated (Read tool replaced with Bash reads for out-of-worktree paths)
- Audit history moved from `~/.claude/infra/history/` to per-project `.infra-audit/history.json`

### Dependency baselines

- renovatebot/github-action: v46.0.2 → v46.1.7
- ruff-pre-commit: v0.15.2 → v0.15.6
- vulture: v2.14 → v2.15
- ruff floor: >=0.15.6, pre-commit floor: >=4.5.1, vulture floor: >=2.15

### Housekeeping

- Tracked `package-lock.json` for reproducible installs
- Installer auto-cleans legacy `commands/` layout on upgrade

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
- `--global` and `--local` scope flags
- `--uninstall` for clean removal
