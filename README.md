# python-infra-audit-cc

Audit Python project infrastructure against a known-good blueprint — as a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) slash command.

Checks ruff, pyright, pre-commit, CI/CD, pyproject.toml, uv, Docker, Makefile, Alembic, and environment/secrets configuration against production-tested standards.

## Install

```bash
npx python-infra-audit-cc
```

This installs globally to `~/.claude/`. For a project-local install:

```bash
npx python-infra-audit-cc --local
```

## Usage

In Claude Code:

```
/infra:audit           # Audit all detected areas
/infra:audit ruff      # Audit only ruff config
/infra:audit ci docker # Audit CI and Docker
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

## Output

Produces a scored report (0-10) with findings classified as:

- **CRITICAL** (-2 pts): Security risks, missing essential config
- **WARNING** (-0.5 pts): Best-practice deviations
- **INFO** (0 pts): Suggestions, legitimate alternatives

## Update

```
/infra:update
```

Or directly:

```bash
npx python-infra-audit-cc@latest
```

## Uninstall

```bash
npx python-infra-audit-cc --global --uninstall
```

## How it works

The installer copies skill files into your `~/.claude/` directory:

- `commands/infra/audit.md` — The slash command prompt
- `commands/infra/update.md` — Self-update command
- `infra/blueprint.md` — The standards reference document
- `hooks/infra-check-update.js` — Background update checker (runs on session start)

It additively merges its hook into `settings.json` alongside any existing hooks (e.g., GSD).

## Local modifications

If you customize any installed files, the installer detects changes on update and backs them up to `infra-audit-local-patches/` before overwriting.

## Development

### Local dev setup

The installer uses `__dirname` to find source files, so running it directly from the repo always installs your working copy:

```bash
node bin/install.js --global
```

After editing any source files, re-run the same command to update `~/.claude/`.

### Publishing a new version

1. Bump version in `package.json`
2. Update `CHANGELOG.md`
3. Commit and tag:
   ```bash
   git add -A && git commit -m "Release vX.Y.Z"
   git tag vX.Y.Z
   ```
4. Publish to npm (requires a [granular access token](https://www.npmjs.com/settings/tokens) with publish permissions):
   ```bash
   npm publish
   ```
5. Push:
   ```bash
   git push && git push --tags
   ```

## License

MIT
