# Security Policy

## Scope

This project processes Oracle Enterprise Manager replay report content and may generate optional LLM-written narrative sections from structured metrics.

## Data Handling

- Treat report HTML as sensitive operational data.
- Do not commit customer or production report data to this repository.
- Use sanitized fixtures only under `tests/fixtures`.
- Keep report retention minimal and purpose-bound.

## Secrets

- Never hardcode API keys.
- Use environment variables (`OPENAI_API_KEY`, `OPENAI_MODEL`, `REPORTS_ROOT`).
- Rotate keys immediately if exposure is suspected.

## Logging and Redaction

- Do not log full report contents.
- Prefer summary-level diagnostics in server logs.
- Redact tokens, credentials, and account identifiers from tickets or docs.

## Vulnerability Reporting

Report security concerns privately through your internal Oracle security workflow. Include repro steps, impacted components, and severity context.
