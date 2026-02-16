#!/usr/bin/env bash
set -uo pipefail

# infra:audit Phase 1 — Detection
# Scans the project root and outputs structured JSON to stdout.
# Dependencies: bash, python3 (3.11+ for tomllib)

# ── Fast file/directory existence checks ──────────────────

HAS_GIT=false;        [ -d .git ] && HAS_GIT=true
HAS_PYPROJECT=false;  [ -f pyproject.toml ] && HAS_PYPROJECT=true
HAS_RUFF_TOML=false;  [ -f ruff.toml ] && HAS_RUFF_TOML=true
HAS_PYRIGHT=false;    [ -f pyrightconfig.json ] && HAS_PYRIGHT=true
HAS_PRECOMMIT=false;  [ -f .pre-commit-config.yaml ] && HAS_PRECOMMIT=true
HAS_MAKEFILE=false;   [ -f Makefile ] && HAS_MAKEFILE=true
HAS_ALEMBIC=false;    [ -f alembic.ini ] && HAS_ALEMBIC=true
HAS_VENV=false;       [ -x .venv/bin/python ] && HAS_VENV=true
HAS_GITIGNORE=false;  [ -f .gitignore ] && HAS_GITIGNORE=true

# CI workflow files
CI_FILES=""
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] && CI_FILES="${CI_FILES:+$CI_FILES,}$f"
done
[ -f .gitlab-ci.yml ]      && CI_FILES="${CI_FILES:+$CI_FILES,}.gitlab-ci.yml"
[ -f .circleci/config.yml ] && CI_FILES="${CI_FILES:+$CI_FILES,}.circleci/config.yml"

# Docker
HAS_DOCKER=false
for f in Dockerfile*; do [ -f "$f" ] && HAS_DOCKER=true && break; done
[ -f compose.yml ] && HAS_DOCKER=true
[ -f docker-compose.yml ] && HAS_DOCKER=true

# UV lock (root + one level deep)
HAS_UV=false
if [ -f uv.lock ]; then
  HAS_UV=true
else
  for f in */uv.lock; do [ -f "$f" ] && HAS_UV=true && break; done
fi

# Renovate
HAS_RENOVATE=false
[ -f renovate.json ]         && HAS_RENOVATE=true
[ -f .renovaterc ]           && HAS_RENOVATE=true
[ -f .renovaterc.json ]      && HAS_RENOVATE=true
[ -f .github/renovate.json ] && HAS_RENOVATE=true

# Tests
HAS_TESTS=false
[ -d tests ] && HAS_TESTS=true
if [ "$HAS_TESTS" = false ]; then
  for pattern in test_*.py *_test.py */test_*.py */*_test.py; do
    for f in $pattern; do [ -f "$f" ] && HAS_TESTS=true && break 2; done
  done
fi

# Env config files
ENV_FILES=""
for f in .env config.json config.yaml config.toml settings.json settings.yaml; do
  [ -f "$f" ] && ENV_FILES="${ENV_FILES:+$ENV_FILES,}$f"
done
for f in .env.*; do
  [ -f "$f" ] && ENV_FILES="${ENV_FILES:+$ENV_FILES,}$f"
done

# ── Venv tool versions ───────────────────────────────────

PYTHON_VERSION="" RUFF_VERSION="" PYTEST_VERSION="" PRECOMMIT_VERSION="" PYRIGHT_VERSION=""
if [ "$HAS_VENV" = true ]; then
  PYTHON_VERSION=$(.venv/bin/python --version 2>/dev/null | awk '{print $2}') || true
  RUFF_VERSION=$(.venv/bin/ruff --version 2>/dev/null | awk '{print $2}') || true
  PYTEST_VERSION=$(.venv/bin/pytest --version 2>/dev/null | awk '{print $2}') || true
  PRECOMMIT_VERSION=$(.venv/bin/pre-commit --version 2>/dev/null | awk '{print $NF}') || true
  PYRIGHT_VERSION=$(.venv/bin/pyright --version 2>/dev/null | awk '{print $NF}') || true
  if [ -z "$PYRIGHT_VERSION" ] && [ -x node_modules/.bin/pyright ]; then
    PYRIGHT_VERSION=$(node_modules/.bin/pyright --version 2>/dev/null | awk '{print $NF}') || true
  fi
fi

# ── Python3 block: TOML parsing + JSON assembly ──────────

export HAS_GIT HAS_PYPROJECT HAS_RUFF_TOML HAS_PYRIGHT HAS_PRECOMMIT HAS_MAKEFILE
export HAS_ALEMBIC HAS_VENV HAS_GITIGNORE HAS_DOCKER HAS_UV HAS_RENOVATE HAS_TESTS
export CI_FILES ENV_FILES
export PYTHON_VERSION RUFF_VERSION PYTEST_VERSION PRECOMMIT_VERSION PYRIGHT_VERSION

exec python3 -c '
import json, os, sys, glob as G

def env(k):
    return os.environ.get(k, "") == "true"

areas = {
    "git": env("HAS_GIT"), "pyproject": env("HAS_PYPROJECT"),
    "venv": env("HAS_VENV"), "makefile": env("HAS_MAKEFILE"),
    "alembic": env("HAS_ALEMBIC"), "pyright": env("HAS_PYRIGHT"),
    "pre_commit": env("HAS_PRECOMMIT"), "docker": env("HAS_DOCKER"),
    "uv": env("HAS_UV"), "renovate": env("HAS_RENOVATE"),
    "tests": env("HAS_TESTS"), "gitignore": env("HAS_GITIGNORE"),
}

# ── Parse pyproject.toml ──
project_name = None
requires_python = None
has_ruff_config = env("HAS_RUFF_TOML")
has_coverage_config = False
cov_in_addopts = False
has_inline_snapshot = False
has_dirty_equals = False
has_pydantic = False
has_pytest_cov = False
pyproject = {}

if areas["pyproject"]:
    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib
        except ImportError:
            tomllib = None

    if tomllib:
        try:
            with open("pyproject.toml", "rb") as f:
                pyproject = tomllib.load(f)

            project_name = pyproject.get("project", {}).get("name")
            requires_python = pyproject.get("project", {}).get("requires-python")

            if "tool" in pyproject and "ruff" in pyproject["tool"]:
                has_ruff_config = True

            # Gather ALL dependency names
            all_deps = list(pyproject.get("project", {}).get("dependencies", []))
            for group in pyproject.get("project", {}).get("optional-dependencies", {}).values():
                all_deps.extend(group)
            for group in pyproject.get("dependency-groups", {}).values():
                for item in group:
                    if isinstance(item, str):
                        all_deps.append(item)

            dep_names = set()
            for d in all_deps:
                name = d.split("[")[0].split(">")[0].split("<")[0].split("=")[0].split("!")[0].split("~")[0].split(";")[0].strip().lower()
                if name:
                    dep_names.add(name)

            has_inline_snapshot = "inline-snapshot" in dep_names
            has_dirty_equals = "dirty-equals" in dep_names
            has_pydantic = "pydantic" in dep_names
            has_pytest_cov = "pytest-cov" in dep_names

            # Coverage config
            tool = pyproject.get("tool", {})
            if "coverage" in tool:
                has_coverage_config = True
            addopts = tool.get("pytest", {}).get("ini_options", {}).get("addopts", "")
            if "--cov" in addopts:
                cov_in_addopts = True
                has_coverage_config = True
            if has_pytest_cov:
                has_coverage_config = True
        except Exception:
            pass

if not project_name:
    project_name = os.path.basename(os.getcwd())

if not has_coverage_config and os.path.isfile(".coveragerc"):
    has_coverage_config = True

areas["ruff"] = has_ruff_config

# CI files
ci_files = [f for f in os.environ.get("CI_FILES", "").split(",") if f]
areas["ci"] = len(ci_files) > 0

# ── Env detection ──
env_file_list = [f for f in os.environ.get("ENV_FILES", "").split(",") if f]
env_gitignored = False
env_has_example = False
if env_file_list and os.path.isfile(".gitignore"):
    with open(".gitignore") as gf:
        gi = gf.read()
    for ef in env_file_list:
        if ef in gi or os.path.basename(ef) in gi:
            env_gitignored = True
            break
if env_file_list:
    for ef in env_file_list:
        base = os.path.basename(ef)
        bare = base.lstrip(".")
        candidates = [f"example.{bare}", f"{base}.example", f"{bare}.example"]
        if any(os.path.isfile(c) for c in candidates):
            env_has_example = True
            break
areas["env"] = len(env_file_list) > 0

# ── Inline-snapshot usage in test files ──
uses_inline_snapshot = False
if areas["tests"]:
    test_files = (G.glob("tests/**/test_*.py", recursive=True)
                + G.glob("tests/**/*_test.py", recursive=True)
                + G.glob("test_*.py") + G.glob("*_test.py"))
    for tf in test_files:
        try:
            with open(tf) as fh:
                if "from inline_snapshot import snapshot" in fh.read():
                    uses_inline_snapshot = True
                    break
        except Exception:
            pass

# ── CLAUDE.md files ──
claude_md_files = []
if os.path.isfile("CLAUDE.md"):
    claude_md_files.append("CLAUDE.md")
if os.path.isfile(".claude/CLAUDE.md"):
    claude_md_files.append(".claude/CLAUDE.md")
for entry in sorted(os.listdir(".")):
    if os.path.isdir(entry) and entry not in (".git", ".venv", "node_modules", "__pycache__", ".tox"):
        candidate = os.path.join(entry, "CLAUDE.md")
        if os.path.isfile(candidate):
            claude_md_files.append(candidate)
areas["claude_md"] = len(claude_md_files) > 0

# ── Assemble output ──
def ver(k):
    v = os.environ.get(k, "")
    return v if v else None

result = {
    "areas": areas,
    "venv_tools": {
        "python": ver("PYTHON_VERSION"),
        "ruff": ver("RUFF_VERSION"),
        "pytest": ver("PYTEST_VERSION"),
        "pre_commit": ver("PRECOMMIT_VERSION"),
        "pyright": ver("PYRIGHT_VERSION"),
    },
    "requires_python": requires_python,
    "project_name": project_name,
    "ci_files": ci_files,
    "claude_md_files": claude_md_files,
    "env": {
        "config_files": env_file_list,
        "gitignored": env_gitignored,
        "has_example": env_has_example,
    },
    "tests": {
        "has_tests": areas["tests"],
        "has_coverage_config": has_coverage_config,
        "cov_in_addopts": cov_in_addopts,
        "has_inline_snapshot": has_inline_snapshot,
        "has_dirty_equals": has_dirty_equals,
        "has_pydantic": has_pydantic,
        "has_pytest_cov": has_pytest_cov,
        "uses_inline_snapshot": uses_inline_snapshot,
    },
}
print(json.dumps(result, indent=2))
'
