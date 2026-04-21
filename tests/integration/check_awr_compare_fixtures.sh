#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_DIR="$ROOT/tests/fixtures/awr_regression"

if [[ ! -d "$FIXTURE_DIR" ]]; then
  echo "Missing fixture directory: $FIXTURE_DIR" >&2
  exit 1
fi

required_patterns=(
  "Load Profile"
  "Time Model Statistics"
  "Wait Classes"
  "Wait Events"
  "Top SQL Comparison by Elapsed Time"
  "Top SQL Comparison by CPU Time"
  "Top SQL Comparison by I/O Time"
  "Top SQL Comparison by Executions"
)

status=0

for file in "$FIXTURE_DIR"/*.html; do
  if [[ ! -f "$file" ]]; then
    echo "No HTML fixtures found in $FIXTURE_DIR" >&2
    exit 1
  fi

  echo "Checking $(basename "$file")"
  for pattern in "${required_patterns[@]}"; do
    if ! rg -q "$pattern" "$file"; then
      echo "  [FAIL] Missing section: $pattern" >&2
      status=1
    else
      echo "  [OK] $pattern"
    fi
  done

  # Wait Events table-level signal for compare reports
  if ! rg -q "This table displays comparisons of wait events statistics" "$file"; then
    echo "  [FAIL] Missing compare wait-events table summary" >&2
    status=1
  else
    echo "  [OK] wait-events compare table"
  fi

done

if [[ "$status" -ne 0 ]]; then
  echo "AWR fixture regression check failed." >&2
  exit 1
fi

echo "AWR fixture regression check passed."
