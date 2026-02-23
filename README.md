# python-infra-audit-cc

Audit Python project infrastructure against a known-good blueprint — as a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [OpenCode](https://github.com/opencode-ai/opencode) slash command.

Checks ruff, pyright, pre-commit, CI/CD, pyproject.toml, uv, Docker, Makefile, Alembic, and environment/secrets configuration against production-tested standards.

## Install

Run the installer — it shows a two-step menu to choose your platform (Claude Code / OpenCode / Both) and scope (Global / Local), with the exact destination paths shown:

```bash
npx python-infra-audit-cc
```

### Non-interactive (flags)

Any flag skips the corresponding menu step:

```bash
# Pick platform, still asks global/local
npx python-infra-audit-cc --claude
npx python-infra-audit-cc --opencode
npx python-infra-audit-cc --both

# Fully non-interactive
npx python-infra-audit-cc --claude --global
npx python-infra-audit-cc --claude --local
npx python-infra-audit-cc --opencode --global
npx python-infra-audit-cc --opencode --local
npx python-infra-audit-cc --both --global
```

## Usage

### Claude Code

```
/infra:audit           # Audit all detected areas
/infra:audit ruff      # Audit only ruff config
/infra:audit ci docker # Audit CI and Docker

/infra:fix             # Fix all critical + warning findings
/infra:fix critical    # Fix only critical findings
/infra:fix warnings    # Fix only warnings

/infra:status          # Show last audit/fix score and trend

/infra:update-versions # Refresh blueprint version baselines against upstream releases
```

### OpenCode

```
/infra-audit           # Audit all detected areas
/infra-audit ruff      # Audit only ruff config
/infra-audit ci docker # Audit CI and Docker

/infra-fix             # Fix all critical + warning findings
/infra-fix critical    # Fix only critical findings
/infra-fix warnings    # Fix only warnings

/infra-status          # Show last audit/fix score and trend

/infra-update-versions # Refresh blueprint version baselines against upstream releases
```

## What it checks

| Area | What's audited |
|------|---------------|
| **ruff** | Rule selection, security rules (S), import sorting (I), per-file ignores |
| **pyright** | Type checking mode, Python version match, venv config |
| **pre-commit** | Hook presence, ruff + ruff-format hooks |
| **CI/CD** | Lint job, test job, format check, trigger config |
| **pyproject** | Build backend, requires-python, dev dependencies |
| **uv** | Lock file presence, gitignore status, workspace config |
| **Docker** | SHA256-pinned images, frozen installs, layer ordering |
| **Makefile** | Standard targets (help, test, deploy, etc.) |
| **Alembic** | sqlalchemy.url blank, model imports, env var usage |
| **env** | .env in gitignore, example.env exists, no committed secrets |
| **deadcode** | Unused functions, variables, imports, classes via vulture |
| **tests** | Test structure, coverage config, pytest setup, inline-snapshot usage |
| **renovate** | Renovate config presence, workflow setup, token configuration |
| **claude-md** | CLAUDE.md presence, project context, commands documented |

## Output

Produces a scored report (0-10) with findings classified as:

- **CRITICAL** (-2 pts): Security risks, missing essential config
- **WARNING** (-0.5 pts): Best-practice deviations
- **INFO** (0 pts): Suggestions, legitimate alternatives

## Update

### Update the skill

Pulls the latest published npm release — new audit checks, fixes, and blueprint improvements:

Claude Code:
```
/infra:update
```

OpenCode:
```
/infra-update
```

Or directly:
```bash
npx python-infra-audit-cc@latest
npx python-infra-audit-cc@latest --claude --global
npx python-infra-audit-cc@latest --opencode --global
```

### Refresh version baselines

Updates `versions.yml` — the single source of truth for recommended tool and action versions — against the latest upstream releases. Does not require a skill release. Run this whenever you want to pull in fresher version recommendations without waiting for a new npm publish:

Claude Code:
```
/infra:update-versions
```

OpenCode:
```
/infra-update-versions
```

Launches parallel research agents to fetch latest releases from GitHub and PyPI, shows you a diff, then syncs `versions.yml` and all downstream blueprint files on confirmation.

## Uninstall

Interactive (shows the same two-step menu):
```bash
npx python-infra-audit-cc --uninstall
```

Or explicit:
```bash
npx python-infra-audit-cc --claude --global --uninstall
npx python-infra-audit-cc --opencode --global --uninstall
npx python-infra-audit-cc --both --global --uninstall
```

## How it works

The installer copies skill files into your config directory (`~/.claude/` for Claude Code, `~/.config/opencode/` for OpenCode). For OpenCode, command files are flattened (`commands/infra-audit.md` instead of `commands/infra/audit.md`) and frontmatter is adapted to match OpenCode's format.

Installed files:

- `commands/infra/audit.md` (or `commands/infra-audit.md` for OpenCode) — Audit slash command
- `commands/infra/fix.md` (or `commands/infra-fix.md`) — Auto-fix slash command
- `commands/infra/status.md` (or `commands/infra-status.md`) — Status dashboard slash command
- `commands/infra/update.md` (or `commands/infra-update.md`) — Self-update command
- `commands/infra/update-versions.md` (or `commands/infra-update-versions.md`) — Version baseline refresh command
- `infra/blueprint.md` — The standards reference document
- `infra/versions.yml` — Single source of truth for recommended tool and action versions
- `infra/blueprints/ci.yml` — Canonical CI workflow template
- `infra/blueprints/renovate.yml` — Canonical Renovate config template
- `infra/scripts/detect.sh` — Project detection script (frameworks, tools, config files)
- `infra/scripts/verify.sh` — CI/CD verification script
- `hooks/infra-check-update.js` — Background update checker (Claude Code only)

For Claude Code, it additively merges its hook into `settings.json` alongside any existing hooks. OpenCode does not use hooks.

Audit history is stored per-project in `infra/history/` within the config directory and persists across updates and uninstalls.

## Local modifications

If you customize any installed files, the installer detects changes on update and backs them up to `infra-audit-local-patches/` before overwriting.

## Contributing

See [RELEASING.md](RELEASING.md) for development setup and publishing instructions.

## License

MIT
