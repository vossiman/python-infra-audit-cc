#!/usr/bin/env bash
set -uo pipefail

# infra:audit Phase 1b — Local CI Verification
# Runs detected tools IN PARALLEL and outputs structured JSON to stdout.
# Arg 1: path to detection JSON from detect.sh
# Dependencies: bash, python3
#
# READ-ONLY GUARANTEE: wraps all tool execution in git stash/restore so that
# tools like pre-commit (which auto-fix files) leave zero modifications.

DETECT_JSON="${1:?Usage: verify.sh <detect-json-path>}"

if [ ! -f "$DETECT_JSON" ]; then
  echo '{"error": "Detection JSON not found: '"$DETECT_JSON"'"}' >&2
  exit 1
fi

# ── Parse detection JSON into shell flags ─────────────────

eval "$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
a = d['areas']
vt = d['venv_tools']
t = d['tests']
print(f'HAS_VENV={\"true\" if a.get(\"venv\") else \"false\"}')
print(f'HAS_RUFF={\"true\" if a.get(\"ruff\") else \"false\"}')
print(f'HAS_PYRIGHT={\"true\" if a.get(\"pyright\") else \"false\"}')
print(f'HAS_PRECOMMIT={\"true\" if a.get(\"pre_commit\") else \"false\"}')
print(f'HAS_TESTS={\"true\" if a.get(\"tests\") else \"false\"}')
print(f'HAS_GIT={\"true\" if a.get(\"git\") else \"false\"}')
print(f'RUFF_IN_VENV={\"true\" if vt.get(\"ruff\") else \"false\"}')
print(f'PYTEST_IN_VENV={\"true\" if vt.get(\"pytest\") else \"false\"}')
print(f'PRECOMMIT_IN_VENV={\"true\" if vt.get(\"pre_commit\") else \"false\"}')
print(f'PYRIGHT_IN_VENV={\"true\" if vt.get(\"pyright\") else \"false\"}')
print(f'LOCAL_RUFF_VER={vt.get(\"ruff\") or \"\"}')
print(f'HAS_PYTEST_COV={\"true\" if t.get(\"has_pytest_cov\") else \"false\"}')
print(f'COV_IN_ADDOPTS={\"true\" if t.get(\"cov_in_addopts\") else \"false\"}')
" "$DETECT_JSON")"

# If no venv, nothing to verify — output minimal JSON and exit
if [ "$HAS_VENV" = false ]; then
  echo '{"skipped": true, "reason": "no venv detected"}'
  exit 0
fi

# ── Git stash/restore guard ───────────────────────────────

STASH_CREATED=false
NEEDS_STASH=false

if [ "$HAS_GIT" = true ]; then
  git diff --quiet 2>/dev/null || NEEDS_STASH=true
  git diff --cached --quiet 2>/dev/null || NEEDS_STASH=true
  [ -n "$(git ls-files --others --exclude-standard 2>/dev/null | head -1)" ] && NEEDS_STASH=true

  if [ "$NEEDS_STASH" = true ]; then
    git stash push -q --include-untracked -m "infra-audit-verify-$$" 2>/dev/null && STASH_CREATED=true
  fi
fi

RESULTS_DIR=$(mktemp -d)

cleanup() {
  if [ "$HAS_GIT" = true ]; then
    git checkout . 2>/dev/null || true
    git clean -fd 2>/dev/null || true
    if [ "$STASH_CREATED" = true ]; then
      git stash pop -q 2>/dev/null || true
    fi
  fi
  rm -rf "$RESULTS_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# ── Helper: run a tool, capture exit code + truncated output ──

run_tool() {
  local name="$1" ; shift
  local out_file="$RESULTS_DIR/${name}.out"
  local exit_file="$RESULTS_DIR/${name}.exit"
  "$@" > "$out_file" 2>&1
  echo $? > "$exit_file"
  # Truncate output to first 30 lines
  if [ "$(wc -l < "$out_file")" -gt 30 ]; then
    head -30 "$out_file" > "$out_file.tmp"
    echo "... (truncated)" >> "$out_file.tmp"
    mv "$out_file.tmp" "$out_file"
  fi
}

# ── Launch tools in parallel ──────────────────────────────

# Group 1: Linting / formatting / type-checking / pre-commit (all independent)
if [ "$HAS_RUFF" = true ] && [ "$RUFF_IN_VENV" = true ]; then
  run_tool ruff_check .venv/bin/ruff check . &
  run_tool ruff_format .venv/bin/ruff format --check . &
fi

if [ "$HAS_PYRIGHT" = true ]; then
  if [ "$PYRIGHT_IN_VENV" = true ]; then
    run_tool pyright .venv/bin/pyright &
  elif [ -x node_modules/.bin/pyright ]; then
    run_tool pyright node_modules/.bin/pyright &
  elif command -v npx >/dev/null 2>&1; then
    run_tool pyright npx --no-install pyright &
  fi
fi

if [ "$HAS_PRECOMMIT" = true ] && [ "$PRECOMMIT_IN_VENV" = true ]; then
  run_tool pre_commit .venv/bin/pre-commit run --all-files &
fi

# Group 2: Tests (collect-only → full run, sequential pair but parallel with group 1)
if [ "$HAS_TESTS" = true ] && [ "$PYTEST_IN_VENV" = true ]; then
  (
    # Step 1: collect
    .venv/bin/pytest --collect-only -q > "$RESULTS_DIR/test_collect.out" 2>&1
    echo $? > "$RESULTS_DIR/test_collect.exit"

    collect_exit=$(cat "$RESULTS_DIR/test_collect.exit")
    if [ "$collect_exit" = "0" ]; then
      # Step 2: run with optional coverage
      if [ "$COV_IN_ADDOPTS" = true ]; then
        timeout 120 .venv/bin/pytest -q --tb=short > "$RESULTS_DIR/pytest.out" 2>&1
        echo ${PIPESTATUS[0]:-$?} > "$RESULTS_DIR/pytest.exit"
      elif [ "$HAS_PYTEST_COV" = true ]; then
        timeout 120 .venv/bin/pytest -q --tb=short --cov > "$RESULTS_DIR/pytest.out" 2>&1
        echo ${PIPESTATUS[0]:-$?} > "$RESULTS_DIR/pytest.exit"
      else
        timeout 120 .venv/bin/pytest -q --tb=short > "$RESULTS_DIR/pytest.out" 2>&1
        echo ${PIPESTATUS[0]:-$?} > "$RESULTS_DIR/pytest.exit"
      fi
      # Truncate
      if [ -f "$RESULTS_DIR/pytest.out" ] && [ "$(wc -l < "$RESULTS_DIR/pytest.out")" -gt 30 ]; then
        tail -30 "$RESULTS_DIR/pytest.out" > "$RESULTS_DIR/pytest.out.tmp"
        mv "$RESULTS_DIR/pytest.out.tmp" "$RESULTS_DIR/pytest.out"
      fi
    fi
  ) &
fi

# Group 3: Version mismatch checks + hooks registration (pure file reads, fast)
(
  # Ruff version in pre-commit config
  PRECOMMIT_RUFF_VER=""
  if [ "$HAS_PRECOMMIT" = true ] && [ -f .pre-commit-config.yaml ]; then
    PRECOMMIT_RUFF_VER=$(python3 -c "
import re
with open('.pre-commit-config.yaml') as f:
    content = f.read()
# Find ruff-pre-commit repo block and extract rev
m = re.search(r'repo:\s*https://github\.com/astral-sh/ruff-pre-commit\s*\n\s*rev:\s*v?([^\s]+)', content)
if m:
    print(m.group(1))
" 2>/dev/null) || true
  fi

  # Ruff version in CI
  CI_RUFF_VER=""
  for cf in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -f "$cf" ] || continue
    ver=$(python3 -c "
import re, sys
with open(sys.argv[1]) as f:
    content = f.read()
# Look for ruff version pin
m = re.search(r'ruff[=@]v?([0-9]+\.[0-9]+\.[0-9]+)', content)
if m:
    print(m.group(1))
" "$cf" 2>/dev/null) || true
    [ -n "$ver" ] && CI_RUFF_VER="$ver" && break
  done

  # Git hooks registration
  HOOKS_REGISTERED="false"
  if [ "$HAS_PRECOMMIT" = true ] && [ "$HAS_GIT" = true ]; then
    hooks_path=$(git config --get core.hooksPath 2>/dev/null) || true
    if [ -n "$hooks_path" ] || [ -f .git/hooks/pre-commit ]; then
      HOOKS_REGISTERED="true"
    fi
  fi

  # Write results
  echo "$PRECOMMIT_RUFF_VER" > "$RESULTS_DIR/precommit_ruff_ver"
  echo "$CI_RUFF_VER" > "$RESULTS_DIR/ci_ruff_ver"
  echo "$HOOKS_REGISTERED" > "$RESULTS_DIR/hooks_registered"
) &

# Wait for all background jobs
wait

# ── Assemble JSON output ──────────────────────────────────

python3 -c "
import json, os, sys

rd = sys.argv[1]
local_ruff = sys.argv[2] or None
detect_json = sys.argv[3]

def read_file(name):
    p = os.path.join(rd, name)
    if os.path.isfile(p):
        with open(p) as f:
            return f.read().strip()
    return ''

def tool_result(name):
    exit_str = read_file(f'{name}.exit')
    output = read_file(f'{name}.out')
    if not exit_str:
        return {'status': 'skip', 'exit_code': None, 'output': ''}
    ec = int(exit_str)
    return {
        'status': 'pass' if ec == 0 else ('timeout' if ec == 124 else 'fail'),
        'exit_code': ec,
        'output': output,
    }

# Tool results
ruff_check = tool_result('ruff_check')
ruff_format = tool_result('ruff_format')
pyright = tool_result('pyright')
pre_commit = tool_result('pre_commit')
test_collect = tool_result('test_collect')
pytest_res = tool_result('pytest')

# Extract coverage percentage from pytest output
coverage_pct = None
if pytest_res['output']:
    for line in pytest_res['output'].split('\n'):
        if 'TOTAL' in line:
            parts = line.split()
            for p in reversed(parts):
                if p.endswith('%'):
                    try:
                        coverage_pct = int(p.rstrip('%'))
                    except ValueError:
                        pass
                    break
            break
pytest_res['coverage_pct'] = coverage_pct

# Version mismatches
precommit_ruff = read_file('precommit_ruff_ver') or None
ci_ruff = read_file('ci_ruff_ver') or None
hooks_reg = read_file('hooks_registered') == 'true'

version_mismatches = []
if local_ruff:
    if precommit_ruff and local_ruff != precommit_ruff:
        version_mismatches.append({
            'tool': 'ruff', 'type': 'venv_vs_precommit',
            'local': local_ruff, 'pinned': precommit_ruff,
        })
    if ci_ruff and local_ruff != ci_ruff:
        version_mismatches.append({
            'tool': 'ruff', 'type': 'venv_vs_ci',
            'local': local_ruff, 'pinned': ci_ruff,
        })

# CI python version vs local
ci_python_ver = None
with open(detect_json) as f:
    detect = json.load(f)
local_python = detect.get('venv_tools', {}).get('python')
for cf in detect.get('ci_files', []):
    try:
        with open(cf) as fh:
            import re
            m = re.search(r'python-version:\s*[\"\\x27]?([0-9]+\.[0-9]+)', fh.read())
            if m:
                ci_python_ver = m.group(1)
                break
    except Exception:
        pass

if local_python and ci_python_ver:
    local_minor = '.'.join(local_python.split('.')[:2])
    if local_minor != ci_python_ver:
        version_mismatches.append({
            'tool': 'python', 'type': 'venv_vs_ci',
            'local': local_minor, 'pinned': ci_python_ver,
        })

result = {
    'skipped': False,
    'ruff_check': ruff_check,
    'ruff_format': ruff_format,
    'pyright': pyright,
    'pre_commit': pre_commit,
    'test_collect': test_collect,
    'pytest': pytest_res,
    'version_mismatches': version_mismatches,
    'hooks_registered': hooks_reg,
}
print(json.dumps(result, indent=2))
" "$RESULTS_DIR" "$LOCAL_RUFF_VER" "$DETECT_JSON"
