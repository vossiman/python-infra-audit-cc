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

# PaaS deploy target files (strong application signal)
HAS_PAAS_FILE=false
for f in Procfile fly.toml railway.toml render.yaml app.yaml vercel.json netlify.toml; do
  [ -f "$f" ] && HAS_PAAS_FILE=true && break
done

# TypeScript / Node
HAS_PACKAGE_JSON=false; [ -f package.json ] && HAS_PACKAGE_JSON=true
HAS_TSCONFIG=false;     [ -f tsconfig.json ] && HAS_TSCONFIG=true
HAS_BIOME=false;        { [ -f biome.json ] || [ -f biome.jsonc ]; } && HAS_BIOME=true
HAS_ESLINT=false
for f in .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yaml .eslintrc.yml eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts; do
  [ -f "$f" ] && HAS_ESLINT=true && break
done
HAS_PRETTIER=false
for f in .prettierrc .prettierrc.json .prettierrc.yaml .prettierrc.yml .prettierrc.js .prettierrc.cjs prettier.config.js prettier.config.cjs prettier.config.mjs; do
  [ -f "$f" ] && HAS_PRETTIER=true && break
done
HAS_VITEST_CONFIG=false
for f in vitest.config.ts vitest.config.js vitest.config.mjs vitest.config.cjs; do
  [ -f "$f" ] && HAS_VITEST_CONFIG=true && break
done
HAS_PLAYWRIGHT_CONFIG=false
for f in playwright.config.ts playwright.config.js playwright.config.mjs; do
  [ -f "$f" ] && HAS_PLAYWRIGHT_CONFIG=true && break
done
HAS_PNPM_LOCK=false;  [ -f pnpm-lock.yaml ] && HAS_PNPM_LOCK=true
HAS_NPM_LOCK=false;   [ -f package-lock.json ] && HAS_NPM_LOCK=true
HAS_YARN_LOCK=false;  [ -f yarn.lock ] && HAS_YARN_LOCK=true
HAS_BUN_LOCK=false;   { [ -f bun.lock ] || [ -f bun.lockb ]; } && HAS_BUN_LOCK=true
HAS_NVMRC=false;      [ -f .nvmrc ] && HAS_NVMRC=true
NVMRC_VERSION=""
[ "$HAS_NVMRC" = true ] && NVMRC_VERSION=$(tr -d '[:space:]v' < .nvmrc 2>/dev/null | head -c 20) || true

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

PYTHON_VERSION="" RUFF_VERSION="" PYTEST_VERSION="" PRECOMMIT_VERSION="" PYRIGHT_VERSION="" VULTURE_VERSION=""
if [ "$HAS_VENV" = true ]; then
  PYTHON_VERSION=$(.venv/bin/python --version 2>/dev/null | awk '{print $2}') || true
  RUFF_VERSION=$(.venv/bin/ruff --version 2>/dev/null | awk '{print $2}') || true
  PYTEST_VERSION=$(.venv/bin/pytest --version 2>/dev/null | awk '{print $2}') || true
  PRECOMMIT_VERSION=$(.venv/bin/pre-commit --version 2>/dev/null | awk '{print $NF}') || true
  PYRIGHT_VERSION=$(.venv/bin/pyright --version 2>/dev/null | awk '{print $NF}') || true
  VULTURE_VERSION=$(.venv/bin/vulture --version 2>/dev/null | awk '{print $2}') || true
  if [ -z "$PYRIGHT_VERSION" ] && [ -x node_modules/.bin/pyright ]; then
    PYRIGHT_VERSION=$(node_modules/.bin/pyright --version 2>/dev/null | awk '{print $NF}') || true
  fi
fi

# ── Python3 block: TOML parsing + JSON assembly ──────────

export HAS_GIT HAS_PYPROJECT HAS_RUFF_TOML HAS_PYRIGHT HAS_PRECOMMIT HAS_MAKEFILE
export HAS_ALEMBIC HAS_VENV HAS_GITIGNORE HAS_DOCKER HAS_UV HAS_RENOVATE HAS_TESTS
export CI_FILES ENV_FILES
export PYTHON_VERSION RUFF_VERSION PYTEST_VERSION PRECOMMIT_VERSION PYRIGHT_VERSION VULTURE_VERSION
export HAS_PACKAGE_JSON HAS_TSCONFIG HAS_BIOME HAS_ESLINT HAS_PRETTIER
export HAS_VITEST_CONFIG HAS_PLAYWRIGHT_CONFIG
export HAS_PNPM_LOCK HAS_NPM_LOCK HAS_YARN_LOCK HAS_BUN_LOCK HAS_NVMRC NVMRC_VERSION
export HAS_PAAS_FILE

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
has_vulture_config = False
has_vulture_dep = False
has_flask = False
has_fastapi = False
has_django = False
has_celery = False
has_click = False
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
            has_vulture_dep = "vulture" in dep_names
            has_flask = "flask" in dep_names
            has_fastapi = "fastapi" in dep_names
            has_django = "django" in dep_names
            has_celery = "celery" in dep_names
            has_click = "click" in dep_names

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

            # Vulture config
            has_vulture_config = "vulture" in pyproject.get("tool", {})
        except Exception:
            pass

# Library detection (Python side): classifiers include "Development Status" → published library
pyproject_is_library = False
if areas["pyproject"] and pyproject:
    classifiers = pyproject.get("project", {}).get("classifiers", []) or []
    if any("Development Status" in c for c in classifiers if isinstance(c, str)):
        pyproject_is_library = True

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

# ── Vulture pre-commit hook ──
has_vulture_precommit = False
if areas["pre_commit"] and os.path.isfile(".pre-commit-config.yaml"):
    try:
        with open(".pre-commit-config.yaml") as fh:
            if "jendrikseipp/vulture" in fh.read():
                has_vulture_precommit = True
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

# ── TypeScript / Node detection ──
ts_has_package_json = env("HAS_PACKAGE_JSON")
ts_has_tsconfig = env("HAS_TSCONFIG")
ts_has_biome = env("HAS_BIOME")
ts_has_eslint = env("HAS_ESLINT")
ts_has_prettier = env("HAS_PRETTIER")
ts_has_vitest_config = env("HAS_VITEST_CONFIG")
ts_has_playwright_config = env("HAS_PLAYWRIGHT_CONFIG")
ts_has_pnpm_lock = env("HAS_PNPM_LOCK")
ts_has_npm_lock = env("HAS_NPM_LOCK")
ts_has_yarn_lock = env("HAS_YARN_LOCK")
ts_has_bun_lock = env("HAS_BUN_LOCK")
ts_has_nvmrc = env("HAS_NVMRC")
ts_nvmrc_version = os.environ.get("NVMRC_VERSION") or None

ts_package_manager = None
ts_packagemanager_field = None
ts_engines_node = None
ts_ts_version_range = None
ts_biome_version_range = None
ts_vitest_version_range = None
ts_playwright_version_range = None
ts_has_type_module = False
ts_has_build_script = False
ts_has_lint_script = False
ts_has_typecheck_script = False
ts_has_test_script = False
ts_tsconfig_strict = None
ts_tsconfig_no_unchecked_indexed_access = None
ts_tsconfig_target = None
ts_tsconfig_verbatim_module_syntax = None
ts_tsconfig_no_emit = None
ts_has_ts_test_files = False
ts_private = None
ts_has_main_or_exports = False

if ts_has_package_json:
    try:
        with open("package.json") as fh:
            pkg = json.load(fh)
        scripts = pkg.get("scripts", {}) or {}
        dev_deps = pkg.get("devDependencies", {}) or {}
        deps = pkg.get("dependencies", {}) or {}
        ts_has_type_module = pkg.get("type") == "module"
        ts_packagemanager_field = pkg.get("packageManager")
        engines = pkg.get("engines", {}) or {}
        ts_engines_node = engines.get("node")
        ts_has_build_script = "build" in scripts
        ts_has_lint_script = any(k.startswith("lint") for k in scripts.keys())
        ts_has_typecheck_script = any(k in scripts for k in ("typecheck", "type-check", "tsc", "check-types"))
        ts_has_test_script = "test" in scripts
        ts_ts_version_range = dev_deps.get("typescript") or deps.get("typescript")
        ts_biome_version_range = dev_deps.get("@biomejs/biome") or deps.get("@biomejs/biome")
        ts_vitest_version_range = dev_deps.get("vitest") or deps.get("vitest")
        ts_playwright_version_range = (dev_deps.get("@playwright/test")
                                       or deps.get("@playwright/test")
                                       or dev_deps.get("playwright")
                                       or deps.get("playwright"))
        ts_private = pkg.get("private")
        ts_has_main_or_exports = bool(pkg.get("main") or pkg.get("exports") or pkg.get("bin"))
    except Exception:
        pass

    # Infer package manager: packageManager field > lockfile priority
    if ts_packagemanager_field and isinstance(ts_packagemanager_field, str):
        name = ts_packagemanager_field.split("@", 1)[0].strip().lower()
        if name in ("pnpm", "npm", "yarn", "bun"):
            ts_package_manager = name
    if not ts_package_manager:
        if ts_has_pnpm_lock:
            ts_package_manager = "pnpm"
        elif ts_has_npm_lock:
            ts_package_manager = "npm"
        elif ts_has_yarn_lock:
            ts_package_manager = "yarn"
        elif ts_has_bun_lock:
            ts_package_manager = "bun"

if ts_has_tsconfig:
    try:
        import re as _re
        with open("tsconfig.json") as fh:
            raw = fh.read()
        # Strip JSONC comments without disturbing string literals.
        # State machine: track whether we are inside a string (and escape state)
        # so that "//" inside a path like "./src/*" and "/*" in a glob pattern
        # are left alone.
        out = []
        i = 0
        n = len(raw)
        in_string = False
        escape = False
        while i < n:
            ch = raw[i]
            if in_string:
                out.append(ch)
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == chr(34):
                    in_string = False
                i += 1
                continue
            if ch == chr(34):
                in_string = True
                out.append(ch)
                i += 1
                continue
            if ch == "/" and i + 1 < n:
                nxt = raw[i + 1]
                if nxt == "/":
                    # line comment — skip to end of line
                    i += 2
                    while i < n and raw[i] != "\n":
                        i += 1
                    continue
                if nxt == "*":
                    # block comment — skip to closing */
                    i += 2
                    while i + 1 < n and not (raw[i] == "*" and raw[i + 1] == "/"):
                        i += 1
                    i += 2
                    continue
            out.append(ch)
            i += 1
        stripped = "".join(out)
        # Strip trailing commas before } or ]
        stripped = _re.sub(r",(\s*[}\]])", r"\1", stripped)
        tsconfig = json.loads(stripped)
        compiler_options = tsconfig.get("compilerOptions", {}) or {}
        ts_tsconfig_strict = bool(compiler_options.get("strict", False))
        ts_tsconfig_no_unchecked_indexed_access = bool(compiler_options.get("noUncheckedIndexedAccess", False))
        ts_tsconfig_target = compiler_options.get("target")
        ts_tsconfig_verbatim_module_syntax = bool(compiler_options.get("verbatimModuleSyntax", False))
        ts_tsconfig_no_emit = bool(compiler_options.get("noEmit", False))
    except Exception:
        pass

# Detect TS test files (*.test.ts, *.spec.ts, tests/**/*.ts) — only if TS project
if ts_has_package_json:
    for pattern in ("*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx",
                    "src/**/*.test.ts", "src/**/*.spec.ts",
                    "tests/**/*.ts", "__tests__/**/*.ts"):
        matches = G.glob(pattern, recursive=True)
        if matches:
            ts_has_ts_test_files = True
            break

areas["ts"] = ts_has_package_json

# ── Project type heuristic: application vs library vs unknown ──
# Drives the rangeStrategy recommendation in the renovate audit:
# - application  -> pin exact versions (reproducible deploys)
# - library      -> use ranges + bump (downstream consumers can dedupe)
# - unknown      -> audit issues an INFO asking the user to set rangeStrategy
#
# Design note: app signals win over library signals. A published package with
# a Dockerfile for its test suite is still shipped as a library for consumers,
# but within the scope of this repo the dependency policy should pin.
app_signals = []
if env("HAS_DOCKER"):
    app_signals.append("docker")
if env("HAS_ALEMBIC"):
    app_signals.append("alembic")
if has_flask or has_fastapi or has_django or has_celery:
    app_signals.append("web-framework")
if env("HAS_PAAS_FILE"):
    app_signals.append("paas-deploy-file")
if ts_private is True:
    app_signals.append("package-json-private")

lib_signals = []
if pyproject_is_library:
    lib_signals.append("pyproject-classifiers-dev-status")
# Node library signal: not private AND has main/exports/bin (publishable shape)
if ts_has_package_json and ts_private is not True and ts_has_main_or_exports:
    lib_signals.append("package-json-publishable")

if app_signals:
    project_type = "application"
elif lib_signals:
    project_type = "library"
else:
    project_type = "unknown"

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
        "vulture": ver("VULTURE_VERSION"),
    },
    "requires_python": requires_python,
    "project_name": project_name,
    "project_type": project_type,
    "project_type_signals": {
        "application": app_signals,
        "library": lib_signals,
    },
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
    "vulture": {
        "has_config": has_vulture_config,
        "has_dep": has_vulture_dep,
        "has_precommit_hook": has_vulture_precommit,
    },
    "frameworks": {
        "flask": has_flask,
        "fastapi": has_fastapi,
        "django": has_django,
        "celery": has_celery,
        "click": has_click,
        "pydantic": has_pydantic,
    },
    "ts": {
        "has_package_json": ts_has_package_json,
        "has_tsconfig": ts_has_tsconfig,
        "has_biome": ts_has_biome,
        "has_eslint": ts_has_eslint,
        "has_prettier": ts_has_prettier,
        "has_vitest_config": ts_has_vitest_config,
        "has_playwright_config": ts_has_playwright_config,
        "has_pnpm_lock": ts_has_pnpm_lock,
        "has_npm_lock": ts_has_npm_lock,
        "has_yarn_lock": ts_has_yarn_lock,
        "has_bun_lock": ts_has_bun_lock,
        "has_nvmrc": ts_has_nvmrc,
        "nvmrc_version": ts_nvmrc_version,
        "package_manager": ts_package_manager,
        "packagemanager_field": ts_packagemanager_field,
        "engines_node": ts_engines_node,
        "ts_version_range": ts_ts_version_range,
        "biome_version_range": ts_biome_version_range,
        "vitest_version_range": ts_vitest_version_range,
        "playwright_version_range": ts_playwright_version_range,
        "has_type_module": ts_has_type_module,
        "has_build_script": ts_has_build_script,
        "has_lint_script": ts_has_lint_script,
        "has_typecheck_script": ts_has_typecheck_script,
        "has_test_script": ts_has_test_script,
        "tsconfig_strict": ts_tsconfig_strict,
        "tsconfig_no_unchecked_indexed_access": ts_tsconfig_no_unchecked_indexed_access,
        "tsconfig_target": ts_tsconfig_target,
        "tsconfig_verbatim_module_syntax": ts_tsconfig_verbatim_module_syntax,
        "tsconfig_no_emit": ts_tsconfig_no_emit,
        "has_ts_test_files": ts_has_ts_test_files,
        "private": ts_private,
        "has_main_or_exports": ts_has_main_or_exports,
    },
}
print(json.dumps(result, indent=2))
'
