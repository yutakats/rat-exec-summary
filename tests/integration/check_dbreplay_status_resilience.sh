#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$ROOT/tests/fixtures/dbrep_reports/11/DB Replay Report.html"
PARSER="$ROOT/packages/core-parser/replay-summary-core.js"

if [[ ! -f "$FIXTURE" ]]; then
  echo "Missing fixture: $FIXTURE" >&2
  exit 1
fi

if [[ ! -f "$PARSER" ]]; then
  echo "Missing parser file: $PARSER" >&2
  exit 1
fi

echo "Checking DB Replay status resilience fixture..."

# This Replay 11 sample contains wrapped summary attributes like:
# summary="database head\n er"
if rg -Uq 'summary="database\s+head\s+er"' "$FIXTURE"; then
  echo "  [OK] Wrapped summary attribute pattern exists (database header split across whitespace)"
else
  echo "  [FAIL] Wrapped summary attribute pattern not found in Replay 11 fixture" >&2
  exit 1
fi

if rg -q 'Replay Status' "$FIXTURE" && rg -q '>COMPLETED<' "$FIXTURE"; then
  echo "  [OK] Fixture contains Replay Status with COMPLETED value"
else
  echo "  [FAIL] Fixture does not contain expected Replay Status COMPLETED content" >&2
  exit 1
fi

echo "Checking parser normalization logic..."

if rg -q 'replace\(/\\s\+\/g, ""\)' "$PARSER" && rg -q 'includes\(normalizedNeedle\)' "$PARSER"; then
  echo "  [OK] findTableBySummary uses whitespace-insensitive matching"
else
  echo "  [FAIL] Parser no longer appears to normalize summary whitespace" >&2
  exit 1
fi

echo "DB Replay status resilience check passed."
