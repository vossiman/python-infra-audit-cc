# Changelog

## 1.3.1 (2026-04-13)

### Blueprint enhancements

- **New §4 subsection: "Playwright browser caching".** Documents the canonical pattern for caching Playwright browser binaries in CI: `actions/cache@v4` keyed on `~/.cache/ms-playwright` + `hashFiles('pnpm-lock.yaml', 'uv.lock')` with a `playwright-${{ runner.os }}-` restore-keys fallback. Without this cache, every CI run downloads 150-300 MB of Chromium (15-30s per job, plus occasional hangs when Playwright's CDN is flaky). With it, subsequent runs restore in ~2s.
- **Install without `--with-deps`.** The blueprint now explicitly rejects `playwright install --with-deps` in CI: on `ubuntu-latest` the required system libs (libnss3, libxss1, libatk-bridge2.0-0, etc.) are already pre-installed, so `--with-deps` adds ~30s of redundant `apt-get` and requires `sudo` (which some hardened runners reject). Only needed when running Playwright from a bare base image (e.g. Alpine in a custom Dockerfile).
- **Cross-job cache sharing documented.** Projects with both a Python Playwright job (`pytest-playwright`) and a Node Playwright job (`@playwright/test`) should use the same cache key so GitHub Actions' repo-scoped cache gives the second job a ~2s restore from the first job's population.

### Audit improvements

- 4 new CI audit triggers for Playwright: flag `--with-deps` in CI, flag missing `actions/cache` when `playwright install` is invoked, flag cache keys that don't include a lockfile hash (never-invalidating cache), and flag mismatched cache keys between a Python and a Node Playwright job in the same workflow.

## 1.3.0 (2026-04-13)

### New features

- **First-class TypeScript / Node audit area.** `infra-audit` now audits polyglot and TS-only projects alongside Python ones. New `ts` argument (`/infra-audit ts`), new blueprint section, new detection logic, ~17 new WARNING and 5 new INFO triggers.
- New reference blueprints shipped with the skill: `infra/blueprints/package.json`, `infra/blueprints/tsconfig.json`, `infra/blueprints/biome.jsonc`.
- **Automatic project type detection (`application` / `library` / `unknown`).** `detect.sh` now emits a top-level `project_type` field plus a `project_type_signals` breakdown showing which heuristics fired. Signals: Dockerfile/compose, alembic, web framework in runtime deps (fastapi/flask/django/celery), PaaS deploy files (Procfile/fly.toml/railway.toml/render.yaml/app.yaml/vercel.json/netlify.toml), `package.json "private": true` (→ application); `pyproject.toml` classifiers with `Development Status ::`, `package.json` with `main`/`exports`/`bin` and not private (→ library).
- **`rangeStrategy` feature in the renovate blueprint.** Reference `renovate.json` and blueprint §4b §"Why `rangeStrategy` depends on project type" document that:
  - Applications should use `rangeStrategy: "pin"` for both `pep621` and `npm` — reproducible deploys, PR diffs show exact versions changed.
  - Libraries should use `rangeStrategy: "bump"` — keeps range operators so downstream consumers can dedupe.
  - `"auto"` (Renovate default) is wrong for both: for `pep621` it only touches the lockfile and lets `>=` floors go stale; for `npm` it varies per-range.
  - The blueprint ships the app-mode rules by default with `[ADAPT]` comments pointing to the library variant.
- **New audit triggers for `rangeStrategy`:** project detected as `application` but `rangeStrategy` is `"bump"` / `"auto"` / unset → WARNING (should pin for reproducible deploys); project detected as `library` but `rangeStrategy` is `"pin"` → WARNING (should bump so consumers can dedupe); `project_type == "unknown"` with unset `rangeStrategy` → INFO asking the user to choose explicitly (the audit will never silently guess).

### Blueprint enhancements

- **Renovate blueprint: automerge-first strategy.** Reference `renovate.json` and `infra/blueprint.md` §4b upgraded:
  - `rebaseWhen: "behind-base-branch"` (replaces `"conflicted"`) — fixes "overlapping dependency PRs refuse to merge" with `platformAutomerge`.
  - `platformAutomerge: true` + `automergeStrategy: "squash"` — routes merges through GitHub's native auto-merge with a linear history.
  - `configMigration: true` — auto-PRs deprecated Renovate syntax.
  - `vulnerabilityAlerts` block with `automerge: true` + `minimumReleaseAge: null` — security fixes bypass the 3-day PyPI/npm stability gate.
  - `lockFileMaintenance: { automerge: true }` — monthly lockfile refresh merges itself.
  - `packageRules` that automerge all patch/pin/digest updates across every manager, automerge minor npm dev-dependency bumps, group `@types/**` with automerge, and group (without automerging) linters and test tooling for human triage.
  - npm 3-day stability gate mirroring the PyPI one.
  - Polyglot matchers: linters group now includes biome/eslint/prettier; test-tooling group now includes vitest/playwright/jsdom. Harmless no-ops on pure-Python repos.
  - **Dropped the internal `schedule` field.** The outer GitHub Actions workflow cron (`infra/blueprints/renovate.yml`) is now the sole throttle — Renovate's internal schedule was belt-and-suspenders. Rationale for `prHourlyLimit: 0` updated accordingly (it's the *outer* trigger cadence, not Renovate's internal schedule, that motivates lifting the per-hour cap).
  - **Known limitation documented:** the `matchDepTypes: ["devDependencies"]` automerge rule only matches Renovate's `npm` manager. Python dev dependencies (tagged by the `pep621` manager as `dependency-groups/dev` / `optional-dependencies/dev`) are **not** covered by this rule — minor bumps of Python dev tools still flow through normal review. Patch/pin/digest automerge still applies to them via the updateType-based rule.
- **New blueprint subsection: "Repository prerequisites for automerge"** — documents that `platformAutomerge: true` requires GitHub's "Allow auto-merge" setting AND branch protection with at least one required status check. Without branch protection, the auto-merge API call silently fails and every PR ends up with `autoMergeRequest: null`. Includes a minimal branch-protection recipe for solo developers.
- **New blueprint section: `## 4c. TypeScript / Node Toolchain`** — covers pnpm, strict TypeScript (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`), Biome as the one-tool lint+format replacement for ESLint+Prettier, and Vitest.

### Audit improvements

- 8 new renovate WARNING triggers: `rebaseWhen`, `platformAutomerge`, `configMigration`, `vulnerabilityAlerts.automerge`, `lockFileMaintenance.automerge`, missing patch/pin/digest automerge rule, plus a documentation-only "manual verification required" note for repo-side automerge prerequisites.
- 1 new renovate INFO trigger: missing `automergeStrategy` when `platformAutomerge` is set.
- 17 new TS/Node WARNING triggers covering tsconfig strictness, package manager pinning, lockfile hygiene (missing / multiple / mismatched), missing lint/test/typecheck scripts, `.nvmrc` consistency, and version drift against `versions.yml` baselines.
- 5 new TS/Node INFO triggers covering Biome vs ESLint+Prettier, `target: ES5`, missing `verbatimModuleSyntax`, missing `"type": "module"`, and missing `build` script.

### Version baselines

- New `node_tools:` block in `infra/versions.yml` with floors for `typescript`, `@biomejs/biome`, `vitest`, and `@playwright/test`.
- New `node_package_manager:` block baselining `pnpm: "9"`.
- New `node_actions:` block with `pnpm/action-setup: v4`.

### Detection

- `infra/scripts/detect.sh` extended with Node/TS probes: emits `areas.ts` flag and a `ts:` object with 30+ fields covering package.json, tsconfig.json (JSONC-aware parser), lockfile presence, `.nvmrc`, biome/eslint/prettier config files, vitest/playwright config files, package manager inference, script presence, and version ranges pulled from devDependencies. Fully backwards compatible — no existing keys renamed or removed.

### Notes

- **This repo dogfoods library-mode.** `blueprint.md` §4b ships app-mode defaults (`rangeStrategy: "pin"`) because the majority of infra-audit users are building deployed applications. But the skill repo itself is detected as a library (it is distributed as a Claude Code plugin via `npm install`, `package.json` has `main`/`bin` and is not private), so its own `renovate.json` uses `rangeStrategy: "bump"` to match the detected type and keep self-audit output clean. Users adopting the blueprint for their own projects should use whatever matches *their* detected type.

### Known limitations

- The tsconfig.json parser is flat — it does not follow `extends` chains. Projects using `extends: "./tsconfig.base.json"` that inherit `strict: true` from the base will report `tsconfig_strict: null` in detect output and the audit will note "could not verify; please check inherited config" rather than issue a hard warning.

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
