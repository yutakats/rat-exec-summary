#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CAPTURE_FIXTURE="$ROOT/tests/fixtures/dbrep_reports/Replay 4/workload_capture_report.html"
PARSER="$ROOT/packages/core-parser/replay-summary-core.js"
SERVER="$ROOT/apps/api/server.rb"
WEB_UI="$ROOT/apps/web/index.html"

echo "Checking capture-report fixture and parser wiring..."

if [[ ! -f "$CAPTURE_FIXTURE" ]]; then
  echo "  [FAIL] Missing capture fixture: $CAPTURE_FIXTURE" >&2
  exit 1
fi

required_fixture_sections=(
  "Captured Workload Statistics"
  "Top SQL Captured"
  "Top Sessions Captured"
  "Workload Not Captured - Contains Unreplayable Calls"
  "Workload Not Captured - DB Scheduler Jobs and Background Activity"
  "Workload Filters"
)

for section in "${required_fixture_sections[@]}"; do
  if rg -q "$section" "$CAPTURE_FIXTURE"; then
    echo "  [OK] Capture fixture contains: $section"
  else
    echo "  [FAIL] Capture fixture missing: $section" >&2
    exit 1
  fi
done

if rg -q "function parseCaptureReport" "$PARSER"; then
  echo "  [OK] Parser includes parseCaptureReport()"
else
  echo "  [FAIL] Parser missing parseCaptureReport()" >&2
  exit 1
fi

if rg -q "capture_html" "$SERVER"; then
  echo "  [OK] API returns optional capture_html"
else
  echo "  [FAIL] API does not expose capture_html" >&2
  exit 1
fi

if rg -q "useAwrDeepDive" "$WEB_UI"; then
  echo "  [OK] UI includes AWR deep-dive toggle"
else
  echo "  [FAIL] UI missing AWR deep-dive toggle" >&2
  exit 1
fi

echo "Capture-report support check passed."
