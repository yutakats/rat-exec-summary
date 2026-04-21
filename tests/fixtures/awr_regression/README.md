# AWR Regression Fixtures

These fixtures are canonical samples used by automated regression checks for AWR Compare parsing coverage.

## Files

- `awr_diff_report_10022025.html`
- `awr_scn.html`
- `awr_time.html`

## Required Coverage

Each sample must contain the parser-critical sections:

- Load Profile
- Time Model Statistics
- Wait Classes
- Wait Events
- Top SQL Comparison by Elapsed Time
- Top SQL Comparison by CPU Time
- Top SQL Comparison by I/O Time
- Top SQL Comparison by Executions
