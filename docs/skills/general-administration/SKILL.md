# General Administration

Use this skill for operational tasks around report generation and environment setup.

## Scope

- start/stop local services
- CLI invocation support
- environment variable setup
- API/auth/proxy troubleshooting
- file packaging and path validation

## Standard Procedure

1. Confirm runtime context:
   - OS and shell
   - project root path
   - input report directory exists
2. Confirm tool mode:
   - UI (`apps/web/index.html` + Ruby API)
   - CLI (`scripts/replay-summary-cli.js`)
3. Validate required inputs:
   - DB Replay Report
   - Compare Period Report
4. Validate optional inputs:
   - Database Capture Report
   - AWR Compare Period Report
5. Validate environment:
   - `OPENAI_API_KEY` only if LLM enabled
   - optional `OPENAI_BASE_URL`, `OPENAI_MODEL`
   - proxy env vars if corporate network requires them

## Operational Guardrails

- Do not claim reports are missing until content-based detection is checked.
- If UI output looks stale, regenerate report and restart Ruby API server.
- If LLM is disabled, confirm no token usage is expected.
- If LLM fails, fall back to deterministic report and capture error details.

## Quick Commands

- Start API:
  - `ruby apps/api/server.rb`
- CLI deterministic:
  - `node scripts/replay-summary-cli.js --report-dir <dir> --out <file>`
- CLI with LLM:
  - `node scripts/replay-summary-cli.js --report-dir <dir> --use-llm --out <file>`

