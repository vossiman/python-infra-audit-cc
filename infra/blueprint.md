# Python Infrastructure Blueprint

Standards reference for auditing Python project infrastructure.
Values are extracted from a production monorepo. Items marked `[ADAPT]` are version/project-specific and should be adjusted per project.

**Version baselines:** All recommended tool and action versions are maintained in `infra/versions.yml` — the single source of truth. The examples in this document reflect those baselines. Run `/infra:update-versions` to refresh baselines against upstream releases.

---

## 1. Ruff (Linter + Formatter)

**Config location:** `pyproject.toml` under `[tool.ruff]`

### Required settings

```toml
[tool.ruff]
line-length = 120
target-version = "py314"  # [ADAPT] match your requires-python

[tool.ruff.lint]
select = [
    "E",       # pycodestyle errors
    "F",       # Pyflakes
    "W",       # pycodestyle warnings
    "I",       # isort (import sorting)
    "UP",      # pyupgrade
    "B",       # flake8-bugbear
    "C901",    # complexity
    "PLR0913", # too-many-arguments
    "PLR0912", # too-many-branches
    "PLR0915", # too-many-statements
    "S",       # flake8-bandit (security)
    "ANN",     # flake8-annotations
]

[tool.ruff.lint.mccabe]
max-complexity = 15

[tool.ruff.lint.pylint]
max-args = 10
max-branches = 15
max-statements = 60

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = ["S101", "S105", "S106", "S108", "ANN"]
"**/migrations/**/*.py" = ["S608", "ANN"]
```

### Rationale
- **line-length=120**: Wide enough for modern screens, narrow enough to avoid horizontal scrolling in diffs
- **S (bandit)**: Security rules catch hardcoded passwords, SQL injection, unsafe deserialization
- **ANN**: Annotation rules enforce type hints on public APIs
- **Per-file ignores**: Tests need `assert` (S101) and don't need annotations; migrations use dynamic SQL (S608)
- **Complexity thresholds**: Generous but finite — prevents unbounded function growth

### Minimum acceptable rule set
At minimum, a project should have `["E", "F", "W", "I"]`. Security rules (`S`) and bugbear (`B`) are strongly recommended.

---

## 2. Pyright (Type Checker)

**Config location:** `pyrightconfig.json` in project root

### Required settings

```json
{
    "include": ["flows", "models"],
    "exclude": ["**/migrations"],
    "typeCheckingMode": "basic",
    "reportMissingImports": true,
    "reportMissingTypeStubs": false,
    "pythonVersion": "3.14",
    "venvPath": ".",
    "venv": ".venv"
}
```

### Key points
- **`[ADAPT] include`**: Should list the project's source directories (not tests, not migrations)
- **`[ADAPT] pythonVersion`**: Must match `requires-python` in `pyproject.toml`
- **`typeCheckingMode: "basic"`**: Good balance of strictness — catches real bugs without drowning in noise
- **`exclude: ["**/migrations"]`**: Auto-generated migration files produce false positives
- **`reportMissingTypeStubs: false`**: Many third-party packages lack stubs; this avoids noise
- **`venvPath` + `venv`**: Points pyright at the local venv for dependency resolution

### Optional suppressions
Some ORMs (SQLAlchemy, SQLModel) produce false positives. It's acceptable to disable specific rules:
```json
{
    "reportAssignmentType": false,
    "reportGeneralTypeIssues": false
}
```

---

## 3. Pre-commit

**Config location:** `.pre-commit-config.yaml` in project root

### Required configuration

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0  # [ADAPT] use latest stable
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
      - id: check-toml
      - id: check-json
        exclude: '^\.vscode/'   # VS Code settings use JSONC (comments)
      - id: check-merge-conflict
      - id: detect-private-key
        exclude: '^tests/'      # test fixtures with dummy keys
      - id: check-case-conflict

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.6  # [ADAPT] match project ruff version
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

### Optional recommended hooks

```yaml
  - repo: https://github.com/jendrikseipp/vulture
    rev: v2.15  # [ADAPT] match project vulture version
    hooks:
      - id: vulture
```

**Note:** The vulture hook scans the entire project (not just changed files). It reads `[tool.vulture]` from `pyproject.toml` for paths, excludes, and suppression rules. Configure `[tool.vulture]` before adding this hook.

### Rationale
- **9 file-hygiene hooks**: Catch whitespace issues, malformed configs, accidentally committed large files, leftover merge conflict markers, private keys, and case-insensitive filename collisions before they hit the repo
- **ruff + ruff-format**: Lint and format in pre-commit ensures CI will pass — no "forgot to format" failures
- **`--fix` on ruff**: Auto-fixes safe issues (import sorting, unused imports) on commit
- **`exclude` patterns**: `check-json` excludes `.vscode/` (JSONC files with comments fail JSON parsing); `detect-private-key` excludes `tests/` (test fixtures with dummy keys trigger false positives)

### Minimum acceptable hooks
At minimum: `trailing-whitespace`, `end-of-file-fixer`, `detect-private-key`, and the ruff hooks.

---

## 4. CI/CD (GitHub Actions)

**Config location:** `.github/workflows/ci.yml` (or similar)

**Canonical blueprint:** `infra/blueprints/ci.yml` — read this file for the full reference workflow.

### Key points
- **3 blocking jobs**: ruff (lint+format), pyright (types), test (pytest) — all must pass
- **All jobs use `uv sync`** to install dependencies, then run tools from `.venv/bin/`
- **Triggered on PR + push to protected branches**: Catches issues before merge
- **Each job is independent**: Can run in parallel, fail independently
- **`ruff format --check`**: Ensures formatting without modifying files in CI
- **`[ADAPT]`**: `python-version` and branch list are project-specific

### Minimum acceptable CI
At minimum: a lint job and a test job, triggered on PRs.

---

## 4b. Renovate (Automated Dependency Updates)

**Config location:** `.github/workflows/renovate.yml` + `renovate.json` in project root

**Canonical blueprint:** `infra/blueprints/renovate.yml` — read this file for the full reference workflow.

### Key points
- **Scheduled monthly**: First Monday of each month at 2:00 AM UTC — avoids noise while staying current
- **Manual trigger**: `workflow_dispatch` allows on-demand runs
- **Token-based auth**: Uses `secrets.RENOVATE_TOKEN` — never hardcode
- **Post-upgrade commands**: `make sync-locks` regenerates per-project lock files after dependency bumps
- **`[ADAPT]`**: Action versions (`renovatebot/github-action`, `astral-sh/setup-uv`) should track latest stable

### Required PAT permissions for `RENOVATE_TOKEN`

Create a fine-grained personal access token with the following permissions (repository-scoped):

| Permission | Level |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Workflows | Read and write |
| Metadata | Read-only (auto-granted) |
| Issues | Read and write |
| Commit statuses | Read and write |
| Dependabot alerts | Read-only |

> **Note:** Contents, Pull requests, and Workflows are the obvious ones. Issues, Commit statuses, and Dependabot alerts are easy to miss but required for Renovate to function correctly.

### Repository prerequisites for automerge

`platformAutomerge: true` is a request to GitHub's native auto-merge feature — and GitHub only *engages* auto-merge when the PR has **at least one unmet merge requirement** (typically a required status check). Without that, the API call Renovate makes to enable auto-merge fails, Renovate logs it, and moves on. Every PR ends up with `autoMergeRequest: null` and nothing ever auto-merges. **All three items below are mandatory, not optional, for the automerge rules in this blueprint to actually fire:**

1. **Settings → General → Pull Requests → Allow auto-merge** — must be **checked**. Without this, `platformAutomerge: true` is silently ignored.
2. **Branch protection on `develop`** (or whichever branch Renovate targets) with **at least one required status check**. This is the gate that makes auto-merge engage. Missing this is the #1 reason "automerge is configured but nothing merges."
3. **Settings → General → Pull Requests → Automatically delete head branches** — strongly recommended. Keeps the branch list clean after automerges complete; without it you accumulate stale `renovate/*` branches.

### Minimal branch protection for a solo developer

Solo devs often skip branch protection because "there's no one to review." That's a mistake once automerge is in play — branch protection isn't about reviews, it's the trigger that makes auto-merge work at all. Minimal config:

- **Require status checks to pass before merging:** enabled, **strict** (branches must be up to date before merging). Pick your real CI job names (e.g. `ruff`, `pyright`, `test`) as the required checks — not a meta-check like `ci / all`, since those often can't be selected until they've run once.
- **Require a pull request before merging:** enabled, **0 required reviewers**. You're solo; you don't need to approve your own PRs, you just need the PR envelope so CI has something to check against.
- **Do not enforce for admins:** unchecked (i.e. admins *can* bypass). Keeps the hotfix escape hatch open.
- **Allow force pushes / deletions:** your choice — neither affects automerge.

This single change fixes two problems at once: auto-merge actually engages, and broken code stops being mergeable. The audit will flag projects that have `platformAutomerge: true` configured but it cannot verify branch protection rules from the filesystem — always **manually verify** the three items above when the audit recommends automerge.

### Branch strategy

Renovate should target a **`develop`** or **`test`** branch rather than `main`. This keeps dependency update churn out of your release branch and gives you a staging area to validate updates before promoting them.

**Recommended setup:**
- Maintain a `develop` or `test` branch as the default Renovate target
- Renovate opens PRs against those branches — CI runs there, you review and merge
- Promote `develop`/`test` → `main` via a deliberate PR or release cycle when ready
- Set `"baseBranchPatterns": ["develop", "test"]` in `renovate.json` — Renovate will target whichever branches exist. **`[ADAPT]`** if your branch is named differently

**Why not target `main` directly?**
- In multi-project / monorepo setups, a bad transitive dependency can cascade — `develop` limits the blast radius
- Batching dependency updates before promoting to `main` gives you a clean integration checkpoint
- Trunk-based teams that release via tags on `main` _can_ set `"baseBranches": ["main"]`, but should be aware that every Renovate merge lands directly on the release branch

### Recommended `renovate.json`

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:best-practices", ":maintainLockFilesMonthly"],
  "baseBranchPatterns": ["develop", "test"],  // [ADAPT] match your branch names
  "labels": ["dependencies"],
  "configMigration": true,
  "prHourlyLimit": 0,
  "prConcurrentLimit": 10,
  "rebaseWhen": "behind-base-branch",
  "platformAutomerge": true,
  "automergeStrategy": "squash",
  "osvVulnerabilityAlerts": true,
  "vulnerabilityAlerts": {
    "labels": ["security"],
    "automerge": true,
    "minimumReleaseAge": null
  },
  "lockFileMaintenance": {
    "enabled": true,
    "automerge": true
  },
  "postUpgradeTasks": {                          // [ADAPT] only needed for monorepos with per-project lock files
    "commands": ["make sync-locks"],
    "fileFilters": ["**/uv.lock", "**/pyproject.toml"],
    "executionMode": "branch"
  },
  "packageRules": [
    {
      "description": "Automerge all patch + digest + pin updates regardless of manager",
      "matchUpdateTypes": ["patch", "pin", "digest"],
      "automerge": true
    },
    {
      "description": "Automerge minor updates for npm dev dependencies",
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor"],
      "automerge": true
    },
    {
      "description": "Group and automerge TypeScript type definitions",
      "matchPackageNames": ["@types/**"],
      "groupName": "type definitions",
      "automerge": true
    },
    {
      "description": "Group linters and formatters",
      "matchPackageNames": ["ruff", "pyright", "@biomejs/biome", "eslint*", "prettier*"],
      "groupName": "linters and formatters"
    },
    {
      "description": "Group test tooling",
      "matchPackageNames": ["pytest*", "vitest", "@vitest/**", "playwright", "@playwright/**", "jsdom"],
      "groupName": "test tooling"
    },
    {
      "description": "GitHub Actions: no automerge for major/minor bumps (review them)",
      "matchManagers": ["github-actions"],
      "matchUpdateTypes": ["major", "minor"],
      "automerge": false
    },
    {
      "description": "Pre-commit hooks: no automerge for major/minor bumps (review them)",
      "matchManagers": ["pre-commit"],
      "matchUpdateTypes": ["major", "minor"],
      "automerge": false
    },
    {
      "description": "App mode: pin exact Python versions. [ADAPT] use 'bump' instead if this is a library.",
      "matchManagers": ["pep621"],
      "rangeStrategy": "pin"
    },
    {
      "description": "App mode: pin exact npm versions. [ADAPT] use 'bump' instead if this is a library.",
      "matchManagers": ["npm"],
      "rangeStrategy": "pin"
    },
    {
      "description": "PyPI: 3-day stability gate against broken/malicious releases",
      "matchDatasources": ["pypi"],
      "minimumReleaseAge": "3 days"
    },
    {
      "description": "npm: 3-day stability gate against broken/malicious releases",
      "matchDatasources": ["npm"],
      "minimumReleaseAge": "3 days"
    }
  ]
}
```

> **Note on the missing `schedule` field:** earlier versions of this blueprint set `"schedule": ["before 5am on the first day of the month"]` inside `renovate.json`. The current reference drops it because the outer GitHub Actions workflow cron (`infra/blueprints/renovate.yml`, scheduled for the first Monday of each month) is already the throttle. Renovate's internal schedule was belt-and-suspenders. With the schedule removed, Renovate runs whenever the workflow is triggered (monthly cron + `workflow_dispatch`), which is the behavior you actually want.

> **Note:** Use `renovate.json5` (JSONC) if you want inline comments. Renovate supports both formats.

### Why `rangeStrategy` depends on project type

This is the single most important Renovate setting and the right value depends on whether your project is an **application** or a **library**. Renovate's own [Dependency Pinning](https://docs.renovatebot.com/dependency-pinning/) docs make the same distinction. The infra-audit skill detects project type automatically (see "Detected project type" below) and flags mismatches.

**Applications (deployed, not published to a registry):**

Use `rangeStrategy: "pin"`. The rule is:

```jsonc
{
  "matchManagers": ["pep621", "npm"],
  "rangeStrategy": "pin"
}
```

Renovate converts ranges like `^1.2.3` / `>=1.2.3` into exact pins (`1.2.3`) directly in `package.json` / `pyproject.toml`. PR diffs show exactly what version changed, CI builds exactly what you deployed, and you do not rely on the lockfile alone for reproducibility. The lockfile and the manifest agree, and any reviewer reading the diff sees the exact delta without cross-referencing.

**Libraries (published to PyPI / npm / a private registry):**

Use `rangeStrategy: "bump"`. The rule is:

```jsonc
{
  "matchManagers": ["pep621", "npm"],
  "rangeStrategy": "bump"
}
```

Renovate keeps range operators (`^1.2.3`, `>=1.2.3`) but bumps the lower bound when a new version exists. This lets downstream consumers of your library dedupe: if two libraries depend on `requests>=2.31`, the consumer installs one version, not two. Pinning exact versions in a library forces consumers into version conflicts for no benefit.

**Why not `"auto"` (the Renovate default)?**

`"auto"` is silently different per manager. For `pep621` it means "only update the lockfile, leave `pyproject.toml` untouched" — so `>=` version floors silently go stale and over time your declared minimum versions diverge from reality. For `npm` it sometimes pins, sometimes widens, depending on the existing range. Neither behavior is what you want; always choose `pin` or `bump` explicitly based on project type.

### Detected project type

The infra-audit skill's detection script (`detect.sh`) labels each project as one of:

- **`application`** — any of these signals present: a `Dockerfile` / `compose.yml`, `alembic.ini`, a web framework in runtime dependencies (`fastapi` / `flask` / `django` / `celery`), a PaaS deploy file (`Procfile`, `fly.toml`, `railway.toml`, `render.yaml`, `app.yaml`, `vercel.json`, `netlify.toml`), or `"private": true` in `package.json`.
- **`library`** — no application signals, **and** one of: `[project].classifiers` in `pyproject.toml` includes a `Development Status ::` entry, or `package.json` is not private and has `main` / `exports` / `bin` fields (i.e. shaped like a publishable package).
- **`unknown`** — neither set of signals matched. The audit emits an **INFO** asking you to set `rangeStrategy` explicitly rather than guessing on your behalf. App signals always win over library signals (a library that ships a Dockerfile for its own test suite is still an application from the perspective of its *own* dependency policy).

The audit WARNs when the detected type and the configured `rangeStrategy` disagree:

- Detected as **application** but `rangeStrategy` is `"bump"` or `"auto"` / unset → "apps should pin for reproducible deploys"
- Detected as **library** but `rangeStrategy` is `"pin"` → "libraries should use `bump` so downstream consumers can dedupe"
- Detected as **unknown** with no explicit `rangeStrategy` → INFO: "could not determine project type; set `rangeStrategy` explicitly to `pin` (app) or `bump` (library)"

### Why `pinDigests` for GitHub Actions

Without digest pinning, action refs like `actions/checkout@v6` use a mutable Git tag. A compromised tag can be force-pushed to point at malicious code. With digest pinning, Renovate converts refs to SHA-pinned form (`actions/checkout@<sha> # v6`) and keeps them updated automatically. This is the [GitHub-recommended supply-chain security practice](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions).

**Note:** `config:best-practices` includes `helpers:pinGitHubActionDigests` which handles this automatically — no manual `pinDigests: true` rule needed. Digest pinning is only practical when Renovate is running — otherwise you'd be stuck maintaining SHAs by hand.

### Why `prHourlyLimit: 0`

Renovate defaults to `prHourlyLimit: 2` — at most 2 PRs created per clock hour. This protects against CI flooding when Renovate runs continuously (default: hourly) against a repo with a large backlog. For repos where the **outer** trigger is infrequent (e.g. a monthly GitHub Actions cron running the workflow in `infra/blueprints/renovate.yml`), this is counterproductive: Renovate only runs for a few minutes, creates 2-4 PRs, then the workflow exits. The remaining updates wait another month. You end up manually re-triggering `workflow_dispatch` runs to drain the queue.

With an infrequent outer trigger, the workflow cadence itself is the throttle. Set `prHourlyLimit: 0` (no limit) so Renovate delivers the full batch in one run. `prConcurrentLimit: 10` still caps the number of simultaneously open PRs as a safety net — with `rebaseWhen: "behind-base-branch"` + `platformAutomerge`, the queue drains fast enough that 10 is plenty.

| Outer trigger cadence | Recommended `prHourlyLimit` |
|---|---|
| Hourly / daily (Renovate self-hosted polling) | `2` (default) — catches up across frequent runs |
| Weekly (GH Actions cron) | `2` is fine |
| Monthly (GH Actions cron) | `0` — otherwise updates drip-feed across months |

### Why `rebaseWhen: "behind-base-branch"`

Renovate's default is `"auto"` and the older "save CI" advice was `"conflicted"` — but both fall apart the moment you're running with `platformAutomerge: true` and a monthly batch of 10+ PRs. With `"conflicted"`, Renovate waits for an *actual* merge conflict before rebasing, which means the second-most-recent PR sits "behind base" with stale CI results and GitHub's auto-merge refuses to land it (strict branch protection requires the branch to be up-to-date). You end up merging one PR per `develop` push, then manually poking the rest.

`"behind-base-branch"` rebases every open PR the moment `develop` moves forward, so the whole batch stays up-to-date and drains through auto-merge as CI finishes. Yes, this burns more CI minutes; that's the price of automerge actually working. If CI cost is a real concern, reduce the schedule frequency, not this setting.

### Why `platformAutomerge` + `automergeStrategy: "squash"`

`platformAutomerge: true` hands merging off to GitHub's native auto-merge feature. Renovate flags the PR with "auto-merge when ready," GitHub waits for required status checks (from branch protection) to turn green, then merges. Renovate doesn't poll, doesn't re-check, doesn't need a long-running process — the merge happens via GitHub's own infrastructure.

`automergeStrategy: "squash"` keeps history linear: every merged renovate PR becomes a single commit on `develop` with the PR title as the commit subject. Matches a clean review workflow and makes `git log` on `develop` readable as a sequence of intentional changes rather than a forest of "update X.y.z" merge commits.

**Prerequisite:** GitHub's native auto-merge only engages when the PR has at least one unmet merge requirement — see [Repository prerequisites for automerge](#repository-prerequisites-for-automerge). Without branch protection, `platformAutomerge: true` is silently a no-op.

### Why automerge `patch` / `pin` / `digest` updates

These update types are near-zero semver risk:
- **`patch`**: semver contract says no breaking changes, no new features — just bug fixes
- **`pin`**: converts `^1.2.3` → `1.2.3` (or bumps the existing pin). Cannot change runtime behavior.
- **`digest`**: refreshes an immutable SHA pin for the *same* tag. Pure supply-chain hygiene.

Reviewing these manually is pure toil — there's nothing to judge. Automerging them is why `config:best-practices` ships `helpers:pinGitHubActionDigests` in the first place: so you *can* automate the refresh. CI still runs and blocks the merge if a patch accidentally broke something, so the safety net is intact.

### Why automerge dev-dependency minor updates

Minor bumps of dev dependencies (biome, vitest, playwright, @types/*, etc.) cannot break production at runtime — they only run in CI and local dev. Worst case: a test tool ships a bug, CI goes red, you see it immediately and roll back the PR. That's the same signal you'd have with manual review, but without you being in the loop. Runtime dependencies (everything in the main `dependencies` block) still require human review for minors because their failure mode is "prod crashes," not "CI goes red."

**Important caveat for Python projects:** the rule is `matchDepTypes: ["devDependencies"]`, which only matches the `devDependencies` block in `package.json` (Renovate's `npm` manager). Renovate's `pep621` manager tags Python dev tools with different `depType` values — `optional-dependencies/dev`, `dependency-groups/dev`, etc. — so **this rule does not automerge Python dev dependencies.** Python dev deps still get the patch/pin/digest automerge rule (which matches on update type, not depType), but minor bumps of Python dev tools flow through normal review. That's intentional: the Python dev-dep ecosystem is smaller and minor bumps are easier to triage by hand than the npm dev-dep flood. If your project specifically wants minor-automerge for Python dev deps too, add a second rule with `matchManagers: ["pep621"]` + `matchDepTypes: ["dependency-groups/dev", "optional-dependencies/dev"]` (adjust to match your `pyproject.toml` layout).

### Why group (but not automerge) linters and test tooling

Linters and test runners are dev dependencies, which the rule above would otherwise automerge. We explicitly override that with a group rule because:

- **Linters (ruff, biome, eslint, prettier):** a minor bump routinely adds new rules. Those rules fire on your existing codebase and create a wall of errors. Automerging that leaves CI red on every unrelated PR until someone manually runs the autofixer or disables the rule. Grouping all linter bumps into one PR means you triage them together, once, intentionally.
- **Test tooling (pytest, vitest, playwright, jsdom):** test framework minors frequently change assertion behavior, snapshot formats, or runner semantics. When they break tests, bisecting a group of 6 tool bumps is way easier than bisecting 6 separately-merged PRs.

The group rule has no `automerge: true`, which overrides the dev-dep rule above. You review one PR per tooling category per month.

### Why `vulnerabilityAlerts.automerge` + `minimumReleaseAge: null`

Security fixes should not wait on the normal 3-day stability gate — by the time a CVE is public, the fix is more valuable than the risk of a bad release. The `vulnerabilityAlerts` block overrides both policies at once:

- `automerge: true` — security PRs bypass the linter/test-tooling grouping rules (they're not tooling, they're fixes) and merge themselves as soon as CI passes
- `minimumReleaseAge: null` — bypasses the 3-day PyPI/npm stability gate for security releases specifically

The `labels: ["security"]` entry ensures these PRs are visually distinct in the GitHub UI so you can still review the history after the fact.

### Why `lockFileMaintenance.automerge`

`:maintainLockFilesMonthly` tells Renovate to open a monthly PR that refreshes your lockfile against current transitive dependencies *without* bumping any direct deps. It's a transitive refresh, and transitive drift is one of the most common sources of "works on my machine" bugs. The PR touches lockfiles only (`uv.lock`, `pnpm-lock.yaml`, etc.) — low review value, high automation value. Automerging it is the same risk calculus as patch updates.

### Why `configMigration`

Renovate deprecates config options regularly (e.g. `baseBranches` → `baseBranchPatterns`). `configMigration: true` makes Renovate open a PR whenever your config uses deprecated syntax, with the migrated version ready to merge. Zero ongoing effort to stay current with Renovate itself — set once and forget.

### Why `postUpgradeTasks`

Monorepos with per-project lock files (e.g. `worker/uv.lock`, `api/uv.lock`) need those locks regenerated after Renovate bumps a dependency in the root `pyproject.toml`. Without `postUpgradeTasks`, Renovate updates the root but leaves per-project locks stale — Docker builds using `uv sync --frozen` will fail.

- `commands`: runs `make sync-locks` (or equivalent) after each dependency bump
- `fileFilters`: limits which files Renovate commits from the task output (safety net)
- `executionMode: "branch"`: runs once per branch, not once per package update

**Note:** Requires `RENOVATE_ALLOWED_POST_UPGRADE_COMMANDS` in the workflow (see `infra/blueprints/renovate.yml`). Skip this block entirely for single-package projects.

### Why `config:best-practices` over `config:recommended`

`config:best-practices` is a strict superset of `config:recommended`. It adds:
- **Config migration** — auto-PRs when `renovate.json` uses deprecated syntax
- **Abandonment detection** — flags packages that are no longer maintained
- **Docker digest pinning** — SHA-pins Docker base images (if project uses Docker)
- **GitHub Action digest pinning** — SHA-pins action refs (overlaps with manual `pinDigests` rule, so we drop the manual one)
- **Lock file maintenance** — periodically regenerates lock files to pick up transitive dep updates

The JS-specific additions (`:pinDevDependencies`, `security:minimumReleaseAgeNpm`) are harmless for Python — they simply won't match anything.

### Why `osvVulnerabilityAlerts`

Queries the [OSV.dev](https://osv.dev/) database to flag known vulnerabilities in dependencies. Works with PyPI. Free, no GitHub Advisory Database dependency. Renovate raises priority PRs for vulnerable packages. Zero config beyond enabling it.

### Why `minimumReleaseAge` for PyPI

Delays PR creation until a PyPI package has been published for at least 3 days. This guards against:
- **Malicious releases** — supply chain attacks that get yanked within hours
- **Broken releases** — packages with critical bugs that get patched quickly

`config:best-practices` includes this for npm (`security:minimumReleaseAgeNpm`) but not for PyPI, so we add our own via `packageRules`.

### Minimum acceptable config
A `renovate.json` extending `config:best-practices`, with `rangeStrategy: "bump"` for Python deps, `prHourlyLimit: 0` for monthly schedules, `osvVulnerabilityAlerts`, `platformAutomerge` + automerge rules for patch/pin/digest updates (unless the team has an explicit reason to review every PR), and a CI workflow to run it. Projects without Renovate rely on manual dependency updates, which tend to drift. Projects _with_ Renovate but default `rangeStrategy` will still have stale version floors. Projects with automerge configured but no branch protection on the target branch will end up with `autoMergeRequest: null` on every PR and nothing will ever merge — see [Repository prerequisites for automerge](#repository-prerequisites-for-automerge).

---

## 4c. TypeScript / Node Toolchain

**Applies to:** projects with a `package.json` at the root. Pure-Python projects should skip this section entirely — the audit will not flag anything here.

**Config locations:**
- `package.json` + `pnpm-lock.yaml` (or equivalent lockfile) in project root
- `tsconfig.json` for TypeScript compile settings
- `biome.json` or `biome.jsonc` for linting + formatting
- `vitest.config.ts` for test runner config (if tests exist)

**Canonical blueprints:**
- `infra/blueprints/package.json` — scripts, devDependencies floors, engines, packageManager
- `infra/blueprints/tsconfig.json` — strict TypeScript baseline
- `infra/blueprints/biome.jsonc` — linter + formatter + import sort

### Package manager: pnpm

Prefer **pnpm** over npm / yarn / bun:

- Content-addressable store → dramatically smaller `node_modules` on machines running multiple projects (each dep exists once on disk, regardless of how many projects use it)
- Strict by default: no phantom dependencies — you cannot import a transitive dep you did not declare, which prevents silent breakage when an indirect dep drops a package
- First-class workspace support for monorepos (`pnpm-workspace.yaml`)
- Mature Renovate + GitHub Actions support via `pnpm/action-setup@v4`

**Pin the exact version** via the `packageManager` field (Corepack reads this automatically):

```json
"packageManager": "pnpm@9.12.0"
```

Renovate will bump this automatically. Set `engines.node` as a **floor** (`">=20"`), not an exact pin — that lets CI and dev machines move forward independently as long as they stay above the minimum.

### TypeScript: strict mode is non-negotiable

Strict mode is the only reason TypeScript buys you anything over JSDoc with inference. Enable these settings in `tsconfig.json` → `compilerOptions`:

- `strict: true` — the umbrella flag that enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, and friends
- `noUncheckedIndexedAccess: true` — catches `arr[0]` returning `T | undefined` instead of `T`. One of the highest-ROI flags: it forces you to handle the "array index out of bounds" case that JavaScript normally hides
- `noImplicitOverride: true` — catches accidental method shadowing in class hierarchies
- `verbatimModuleSyntax: true` — forces explicit `import type` for type-only imports, which prevents compile-time imports from accidentally leaking into runtime bundles
- `isolatedModules: true` — required if anything in the toolchain (Vitest, esbuild, swc, tsup) compiles files individually instead of as a project

`noEmit: true` by default. Most modern stacks use a separate bundler (Vite, esbuild, tsup, Vercel, Next.js) and TypeScript is *only* a type checker — not a code generator. Flip to `false` only when you publish compiled JS as an npm package or ship the output of `tsc` directly.

### Biome: one tool for lint + format + import-sort

Biome replaces ESLint + Prettier + `eslint-plugin-import` with a single Rust binary. The benefits mirror `ruff` on the Python side:

- One config file, not three
- One Renovate PR stream, not three (and no plugin-compatibility matrix)
- 10-100× faster than the ESLint equivalent
- Opinionated defaults that match the community 90% of the time

**ESLint + Prettier projects are valid** — the audit does *not* flag them. Rewriting a working ESLint setup to Biome is a judgment call about migration cost, not an infrastructure defect. But **new** projects should pick Biome unless they have a specific ESLint plugin they cannot do without. Migration path: `biome migrate eslint` and `biome migrate prettier` read existing configs and translate them.

### Vitest for tests

Vitest is the de-facto test runner for TypeScript projects on Vite or native ESM. Jest is fine for legacy projects, but Vitest:

- Runs native ESM without a Babel transform layer
- Shares config with Vite (if the project already uses Vite)
- Has a Jest-compatible API, so migration is mostly a `find / replace`
- Is significantly faster in watch mode (sub-second reruns on incremental changes)

For E2E and browser tests, Playwright is the standard. The audit treats `@playwright/test` as a test tooling package for grouping purposes (same as Vitest).

### Required package.json scripts

The audit expects these scripts to exist in `package.json` so CI can invoke them uniformly:

- **`lint`** — runs the configured linter (e.g. `biome check .`)
- **`typecheck`** — runs `tsc -b --noEmit` or equivalent (not covered by `build` alone if `build` emits JS)
- **`test`** — runs the test suite (e.g. `vitest run` — the non-watch variant for CI)
- **`build`** — optional but standard; runs the bundler or `tsc -b` if shipping compiled output

Without these script names, CI workflows need custom per-project commands and `renovate` / audit tooling cannot provide uniform recommendations.

### Lockfile hygiene

- **Always commit the lockfile** — `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `bun.lock(b)`. Without it, `pnpm install` resolves versions anew on every machine and you lose reproducibility (the JS analogue of committing `uv.lock`).
- **Exactly one lockfile**. If both `pnpm-lock.yaml` and `package-lock.json` exist, one of them is stale and installs will disagree across machines. Pick one package manager, delete the other lockfile.
- **`packageManager` field + lockfile must agree.** If `packageManager: "pnpm@..."` is set, `pnpm-lock.yaml` must exist (and no other lockfile). Corepack will refuse to install otherwise.

### `.nvmrc` and `engines.node`

If both exist, they must agree. Common pattern: `engines.node = ">=20"` (a range) and `.nvmrc = "20"` (an exact major). That's consistent. Inconsistent: `engines.node = ">=20"` but `.nvmrc = "18"` — means your dev environment runs a Node version your own package rejects.

You do not need both. `.nvmrc` is for `nvm` / `fnm` / `volta` users to auto-switch Node versions; `engines.node` is what Corepack and `npm install` enforce. Pick one or keep them in sync.

### Minimum acceptable config

A `package.json` with: `packageManager` field, `engines.node`, `typescript` + lint + test scripts, and **one of** Biome or ESLint+Prettier configured. A `tsconfig.json` with `strict: true`. A single committed lockfile matching the declared package manager. Projects without `tsconfig.json` but with TypeScript source files run TypeScript in default non-strict mode, which defeats the point of using TypeScript at all.

---

## 5. pyproject.toml

**Config location:** `pyproject.toml` in project root

### Required structure

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "project-name"       # [ADAPT]
version = "1.0.0"           # [ADAPT]
requires-python = ">=3.14"  # [ADAPT]
dependencies = []

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "ruff>=0.15.6",         # [ADAPT] use latest
    "pre-commit>=4.5.1",    # [ADAPT] use latest
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"       # if using async tests

# All tool configs consolidated here (ruff, pytest, etc.)
```

### Key points
- **hatchling build backend**: Modern, fast, well-supported
- **`requires-python`**: Enforces minimum Python version — must match ruff `target-version` and pyright `pythonVersion`
- **Consolidated tool config**: All tool settings (`[tool.ruff]`, `[tool.pytest]`, etc.) in `pyproject.toml` — avoids scattering config across `setup.cfg`, `tox.ini`, `.flake8`, etc.
- **Dev dependencies in optional-dependencies**: Keeps production installs lean

---

## 6. uv Workspace & Lock Files

**Config location:** `pyproject.toml` `[tool.uv.workspace]`, per-project `uv.lock` files

### Workspace config (monorepo)

```toml
[tool.uv.workspace]
members = ["worker", "prefect-manager", "eval-api", "streamlit"]  # [ADAPT]
```

### Lock file rules
1. **Lock files are version-controlled** — committed to git for reproducibility
2. **Per-project locks for Docker**: Each sub-project has its own `uv.lock` for isolated Docker builds
3. **`--frozen` in Docker**: `uv sync --frozen` ensures Docker builds use exact committed versions
4. **Locks are NOT regenerated during deploy** — only when dependencies change

### Makefile target for lock sync

```makefile
sync-locks:
	@for project in worker prefect-manager eval-api streamlit; do \
		rm -rf /tmp/_$${project}_lock && mkdir /tmp/_$${project}_lock; \
		cp $${project}/pyproject.toml /tmp/_$${project}_lock/; \
		(cd /tmp/_$${project}_lock && uv lock); \
		cp /tmp/_$${project}_lock/uv.lock $${project}/uv.lock; \
	done
```

### Key anti-patterns
- Lock files in `.gitignore` (breaks reproducibility)
- Regenerating locks at Docker build time (non-deterministic builds)
- Regenerating locks during deploy

---

## 7. Docker

**Config location:** `Dockerfile.*`, `compose.yml`, `.dockerignore`

### Dockerfile patterns

```dockerfile
# SHA256-pinned base image [ADAPT]
FROM python:3.14-slim@sha256:486b809...

# uv sidecar copy (avoids pip entirely) [ADAPT version]
COPY --from=ghcr.io/astral-sh/uv:0.10.0@sha256:78a7ff9... /uv /uvx /bin/

# Frozen install from lockfile
COPY pyproject.toml uv.lock /app/
RUN uv sync --frozen --no-dev --no-install-project

# Activate venv
ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy source last (layer caching)
COPY src/ /app/src/
```

### Key points
- **SHA256 pinned images**: Both base and uv sidecar are pinned by digest, not just tag
- **`uv sync --frozen`**: Uses committed lockfile exactly — no resolution at build time
- **`--no-dev`**: Production images don't include dev dependencies
- **Layer ordering**: Dependencies first, source last — maximizes cache hits
- **Whitelist `.dockerignore`**: Start with `**` (ignore all), then `!` whitelist needed files

### .dockerignore pattern

```
# Ignore everything by default
**

# Whitelist only what's needed
!worker/pyproject.toml
!worker/uv.lock
!flows/**
!models/**
```

### compose.yml patterns
- **SHA256-pinned images** for all services
- **Health checks** on databases and key services
- **Environment variables via `${VAR}`** — no hardcoded secrets
- **`restart: unless-stopped`** on services
- **Named networks** for service isolation

---

## 8. Makefile

**Config location:** `Makefile` in project root

### Standard targets

| Target | Purpose |
|--------|---------|
| `help` | Print available targets |
| `env` | Show current configuration |
| `test` | Run pytest |
| `deploy` | Deploy flows/services |
| `up` / `down` | Start/stop Docker services |
| `rebuild` | Full rebuild cycle |
| `migrate` | Run database migrations |
| `sync-locks` | Regenerate per-project lock files |
| `cleanup` | Prune Docker resources |

### Key patterns
- **`-include .env` + `export`**: Load environment from `.env` without failing if absent
- **Environment-aware targets**: `up`/`down`/`deploy` behave differently for dev/test/prod
- **`.PHONY` declaration**: All targets declared phony to avoid stale file conflicts
- **Default variable overrides**: `ENVIRONMENT_NAME ?= dev` with `make deploy ENVIRONMENT_NAME=prod`

---

## 9. Alembic (Database Migrations)

**Config location:** `alembic.ini`, `migrations/env.py`

### alembic.ini key settings

```ini
[alembic]
script_location = migrations
file_template = %%(year)d%%(month).2d%%(day).2d_%%(hour).2d%%(minute).2d_%%(rev)s_%%(slug)s

# CRITICAL: sqlalchemy.url must be blank — built dynamically from env vars
sqlalchemy.url =
```

### migrations/env.py key patterns

```python
# Load .env from project root
from dotenv import load_dotenv
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

# Import ALL models for autogenerate detection
from models.tables import *  # noqa: F401, F403

# Use SQLModel.metadata (or Base.metadata) as target
target_metadata = SQLModel.metadata

# Build URL from environment variables
def get_url() -> str:
    host = os.getenv("POSTGRES_HOST", "localhost")
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "password")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "postgres")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"
```

### Critical checks
- **`sqlalchemy.url` is blank**: URL must come from env vars, not hardcoded in config
- **Model imports in env.py**: Without this, autogenerate won't detect model changes
- **`include_schemas=True`**: Detects changes across multiple schemas
- **`compare_type=True`**: Detects column type changes (not just additions/removals)
- **No hardcoded credentials** in `alembic.ini`

---

## 10. Environment & Secrets

**Config location:** `.env`, `example.env`, `.gitignore`

### Required patterns

1. **`.env` in `.gitignore`**: Never commit actual secrets
2. **`example.env` template**: Checked into git with placeholder values — documents all required variables
3. **No hardcoded secrets anywhere**: Database URLs, API keys, passwords all come from env vars
4. **Separate example.env per context**: Root `example.env` for Docker services, `worker/example.env` for flow secrets

### example.env structure

```env
# Database credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB=postgres

# API keys (placeholder values)
API_KEY=your_key_here
SECRET_TOKEN=change-me

# Environment
ENVIRONMENT_NAME=dev
```

### .gitignore must include

```
.env
.env-*
__pycache__/
.venv/
*.pyc
```

### Critical checks
- `.env` must NOT be tracked by git (`git ls-files .env` returns empty)
- `example.env` should exist if `.env` is in `.gitignore`
- No actual API keys or passwords in any tracked file

---

## 11. Dead Code Detection (Vulture)

**Tool:** [vulture](https://github.com/jendrikseipp/vulture)

### Dependency setup

```toml
[project.optional-dependencies]
dev = [
    "vulture>=2.15",     # [ADAPT] use latest stable
]
```

### pyproject.toml configuration (preferred)

`[tool.vulture]` is the preferred config method — ensures consistency across CLI, pre-commit hook, and CI.

```toml
[tool.vulture]
paths = ["src", "app"]            # [ADAPT] list source directories
min_confidence = 80
exclude = [
    ".venv/",
    "tests/",
    "migrations/",
    "node_modules/",
    "__pycache__/",
]
```

### Framework-specific `ignore_decorators`

Add only decorators relevant to the project's actual frameworks. These suppress false positives from callbacks, routes, and fixtures that vulture cannot trace statically.

```toml
# Flask
ignore_decorators = ["@app.route"]

# FastAPI
ignore_decorators = [
    "@app.get", "@app.post", "@app.put", "@app.delete",
    "@router.get", "@router.post", "@router.put", "@router.delete",
]

# Pydantic
ignore_decorators = [
    "@validator", "@field_validator", "@model_validator", "@computed_field",
]

# Celery
ignore_decorators = ["@celery.task", "@shared_task"]

# Click
ignore_decorators = ["@click.command", "@click.group"]

# Django
ignore_decorators = ["@receiver", "@admin.register"]

# pytest (always add when tests exist)
ignore_decorators = ["@pytest.fixture"]
```

Combine decorators from all detected frameworks into a single `ignore_decorators` list.

### Pattern-based suppression with `ignore_names`

For names that follow a convention but are invoked dynamically:

```toml
ignore_names = [
    "test_*",       # test functions (if scanning test dirs)
    "visit_*",      # AST visitor pattern
    "handle_*",     # event handler pattern
]
```

### Whitelist file

For persistent false positives that can't be suppressed by decorators or patterns:

1. **Bootstrap**: `.venv/bin/vulture --make-whitelist > vulture_whitelist_candidates.py`
2. **Review** the generated file — remove entries that are actual dead code
3. **Rename** to `vulture_whitelist.py` and commit
4. Vulture automatically picks up `vulture_whitelist.py` when listed in `paths` or passed as argument

### Pre-commit hook

```yaml
  - repo: https://github.com/jendrikseipp/vulture
    rev: v2.15  # [ADAPT] match project vulture version
    hooks:
      - id: vulture
```

The hook is **blocking** (same as ruff). It reads `[tool.vulture]` from `pyproject.toml` — configure that section before adding the hook.

### Fallback CLI invocation (no pyproject.toml config)

```bash
vulture . --min-confidence 80 --exclude ".venv,tests,migrations,node_modules,__pycache__"
```

### Key points
- **`min_confidence = 80`**: Filters low-confidence false positives from framework magic. Raise to 90 for fewer results, lower to 60 for stricter checking.
- **Exclude tests**: Tests reference code that appears "unused" from static analysis perspective
- **Exclude migrations**: Auto-generated Alembic files contain framework-invoked code
- **`[tool.vulture]` is authoritative**: When present, both CLI and pre-commit hook read it — no need to pass args manually

### Minimum acceptable
Optional quality check. 0-10 findings is good. >10 findings warrants review.
