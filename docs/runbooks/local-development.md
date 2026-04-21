# Local Development Runbook

## Start

1. `export OPENAI_API_KEY=...`
2. Optional: `export OPENAI_MODEL=gpt-4.1`
3. `ruby /Users/yutaka/Documents/codex-1/apps/api/server.rb`
4. Open `http://127.0.0.1:4567/apps/web/index.html`

## Troubleshooting

- If `/api/replay-reports` fails, verify fixture path:
  - `/Users/yutaka/Documents/codex-1/tests/fixtures/dbrep_reports`
- If LLM rewrite fails, verify key/model env vars and restart server.
- If popup is blank, allow browser popups and retry.
