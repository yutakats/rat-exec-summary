# Reports Input Folder

Place replay report files here for local runs.

Supported inputs:

- DB Replay Report
- Compare Period Report
- Database Capture Report (optional, recommended)
- AWR Compare Period Report (optional deep dive)

Typical layouts:

1. By replay folder (for UI/`--replay-id`):
   - `reports/<Replay ID>/...html`
2. Single folder run (for CLI `--report-dir`):
   - any folder path containing report HTML files

Notes:

- File names can vary; content-based detection is used as fallback.
- You can still override root with `REPORTS_ROOT` or `--reports-root`.
