# Python Infrastructure Blueprint

Standards reference for auditing Python project infrastructure.
Values are extracted from a production monorepo. Items marked `[ADAPT]` are version/project-specific and should be adjusted per project.

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
    rev: v4.6.0  # [ADAPT] use latest stable
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
      - id: check-toml
      - id: check-json

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.14.13  # [ADAPT] match project ruff version
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

### Rationale
- **6 file-hygiene hooks**: Catch whitespace issues, malformed configs, and accidentally committed large files before they hit the repo
- **ruff + ruff-format**: Lint and format in pre-commit ensures CI will pass — no "forgot to format" failures
- **`--fix` on ruff**: Auto-fixes safe issues (import sorting, unused imports) on commit

### Minimum acceptable hooks
At minimum: `trailing-whitespace`, `end-of-file-fixer`, and the ruff hooks.

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

### Minimum acceptable config
A `renovate.json` with sensible defaults and a CI workflow to run it. Projects without Renovate rely on manual dependency updates, which tend to drift.

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
    "ruff>=0.14.11",        # [ADAPT] use latest
    "pre-commit>=4.2.0",    # [ADAPT] use latest
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
