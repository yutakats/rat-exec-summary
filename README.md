# Enterprise Manager Executive Summaries

This repository is organized for enterprise development and governance. It currently includes:

- a Database Replay executive summary flow
- a SQL Performance Analyzer (SPA) executive summary flow

The replay flow generates an executive summary from three Oracle Enterprise Manager report HTML inputs:

- `DB Replay Report`
- `Compare Period Report`
- `AWR Compare Period Report`

## Repository Layout

- `/Users/yutaka/Documents/codex-1/apps/web`
  Browser UIs for Replay and SPA summary generation.
- `/Users/yutaka/Documents/codex-1/apps/api`
  Local Ruby proxy for report loading and optional LLM narrative rewrite.
- `/Users/yutaka/Documents/codex-1/apps/userscript`
  Enterprise Manager userscript integration.
- `/Users/yutaka/Documents/codex-1/packages/core-parser`
  Shared parser/scoring logic (`replay-summary-core.js`, `spa-summary-core.js`).
- `/Users/yutaka/Documents/codex-1/packages/report-models`
  Shared schema/model assets for summary payloads.
- `/Users/yutaka/Documents/codex-1/tests`
  Unit/integration scaffolding and replay report fixtures.
- `/Users/yutaka/Documents/codex-1/docs`
  Architecture, compliance notes, and runbooks.

## Quick Start

1. Set your API key:
   - `export OPENAI_API_KEY=...`
2. Optional model override:
   - `export OPENAI_MODEL=gpt-4.1`
3. Start the local service for the Replay app:
   - `ruby /Users/yutaka/Documents/codex-1/apps/api/server.rb`
4. Open the Replay app:
   - `http://127.0.0.1:4567/apps/web/index.html`
5. Open the SPA app:
   - `http://127.0.0.1:4567/apps/web/spa.html`

## Command-Line Wrapper (No UI)

You can generate Replay executive summary HTML directly from the command line.

1. Install Node dependency once:
   - `npm install`
2. Run wrapper:
   - `node /Users/yutaka/Documents/codex-1/scripts/replay-summary-cli.js --replay-id 22 --out /tmp/replay-22-summary.html`
   - `node /Users/yutaka/Documents/codex-1/scripts/replay-summary-cli.js --report-dir /path/to/replay22 --out /tmp/replay-22-summary.html`
3. Optional LLM narrative from CLI:
   - `OPENAI_API_KEY=... node /Users/yutaka/Documents/codex-1/scripts/replay-summary-cli.js --replay-id 22 --use-llm --openai-model gpt-4.1 --out /tmp/replay-22-summary-llm.html`

Optional flags:
- `--reports-root <dir>` override report root (defaults to `/Users/yutaka/Documents/codex-1/tests/fixtures/dbrep_reports` or `REPORTS_ROOT` env var)
- `--report-dir <dir>` read report HTML files directly from a local folder (alternative to `--replay-id`)
- `--include-awr-deep-dive` include the AWR drill-down section
- `--use-llm` apply optional LLM narrative rewrite in CLI mode
- `--openai-model <model>` override LLM model (defaults to `OPENAI_MODEL` or `gpt-4.1`)

You can also open `/Users/yutaka/Documents/codex-1/apps/web/spa.html` directly in a browser and upload SPA HTML reports locally. The SPA flow does not require the Ruby service because it reads the selected files in-browser.

## Runtime Behavior

- Browser UI calls `/api/replay-reports` for Replay ID fixture retrieval.
- Shared parser computes deterministic findings and verdict.
- Optional `/api/llm-summary` rewrites narrative sections only.
- If LLM is unavailable, deterministic output remains usable.
- SPA UI accepts multiple HTML reports from a single SPA task, dedupes repeated metrics, reconciles execution-pair differences, and produces a business-vs-monitoring executive summary entirely in the browser.

## Data and Security Defaults

- Report fixtures are read from:
  - `/Users/yutaka/Documents/codex-1/tests/fixtures/dbrep_reports`
- Replay IDs are validated with a strict allowlist regex.
- API is bound to `127.0.0.1` for local use.
- LLM path requires `OPENAI_API_KEY` and can be disabled.

## Additional Documentation

- Architecture: [/Users/yutaka/Documents/codex-1/docs/architecture/ARCHITECTURE.md](/Users/yutaka/Documents/codex-1/docs/architecture/ARCHITECTURE.md)
- Security policy: [/Users/yutaka/Documents/codex-1/SECURITY.md](/Users/yutaka/Documents/codex-1/SECURITY.md)
- Contribution guide: [/Users/yutaka/Documents/codex-1/CONTRIBUTING.md](/Users/yutaka/Documents/codex-1/CONTRIBUTING.md)
- Compliance notes: [/Users/yutaka/Documents/codex-1/docs/compliance/README.md](/Users/yutaka/Documents/codex-1/docs/compliance/README.md)
