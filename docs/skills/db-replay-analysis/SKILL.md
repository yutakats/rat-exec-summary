# DB Replay Analysis

Use this skill when analyzing Oracle Database Replay artifacts and generating an executive summary with deterministic logic and optional LLM narrative.

## Scope

Applies to these report types:

- `DB Replay Report`
- `Compare Period Report`
- `Database Capture Report`
- `AWR Compare Period Report` (optional deep dive)

Use this skill for:

- replay validity checks
- divergence interpretation
- performance bottleneck classification
- executive summary generation
- CLI/API narrative generation troubleshooting

## Required Analysis Order

Always analyze in this order:

1. Replay At-a-Glance
2. Functional Assessment
3. Performance Assessment
4. AWR Detailed Drill-down (only if enabled)

## Deterministic Rules

### Functional Assessment

- Use `Database Capture Report` first (if available).
- Classify divergence using:
  - `< 5%` = Good
  - `5% to 20%` = Moderate
  - `> 20%` = High/problematic
- Treat non-core workload failures (monitoring/background/OEM) as lower-priority caveats.
- If capture report is missing, explicitly say workload representativeness is unknown.

### Performance Assessment

- Prioritize `DB Time` as the primary KPI.
- Then evaluate `CPU vs wait/I/O` mode.
- Use Compare Period sections first; treat AWR as optional deeper evidence.
- Reuse ADDM and Top SQL sections if present; do not invent missing metrics.

## AWR Compare Deep-Dive Procedure (Strict)

Use this exact sequence when AWR deep-dive is enabled.

### 1) Workload Comparison (High-Level)

- Compare `DB Time`, `DB CPU`, and `Avg Active Sessions` between `1st` (baseline) and `2nd` (problem/changed).
- Normalize per second and per transaction when data exists.
- State whether workload is heavier/lighter/similar.
- State whether efficiency per transaction improved or worsened.

### 2) Time Model Analysis

- Compare DB CPU share vs non-CPU DB time share in both periods.
- Classify execution mode:
  - CPU-bound
  - Wait-bound
  - Mixed
- Call out major `% DB time` shifts.

### 3) Bottleneck Shift Identification

- Use `Wait Classes` (not foreground wait class).
- Focus on `% DB time Diff`.
- Identify:
  - largest increase
  - major decrease
- Treat the largest increase as the primary regression driver.

### 4) Wait Event Drill-Down

- Use `Wait Events`.
- Rank by:
  - `% DB time` in 2nd period
  - largest `%Diff` increase
- Explain event meaning in context:
  - Commit: `log file sync` / redo latency
  - User I/O: read pressure
  - Concurrency: block/buffer contention
  - Application: lock/contention patterns

### 5) Branch Logic by Dominant Regression

- If Commit dominates:
  - analyze `log file sync` and `log file parallel write`
  - evaluate commit frequency, redo size, avg wait changes
  - decide: excessive commits, slow redo I/O, or both
- If User I/O dominates:
  - analyze read events and SQL by I/O
- If Concurrency dominates:
  - analyze row lock, buffer busy, ITL/hot block signals
- If CPU dominates:
  - analyze SQL by CPU

### 6) SQL-Level Comparison (Critical)

- Use `Top SQL Comparison by ...` sections.
- Focus on:
  - elapsed time
  - CPU time
  - I/O time
  - executions
- Identify:
  - SQL with biggest `% DB time` increase
  - SQL with large execution increase
  - SQL newly present in 2nd period
- Classify each as:
  - high-frequency (chatty)
  - expensive per execution
  - contention-causing

### 7) Cross-Section Correlation

- Correlate waits/events with SQL shifts.
- Correlate load profile with execution pattern changes.
- Ensure root-cause hypothesis is consistent across sections.

### 8) AWR Output Format

Always produce:

- Executive Summary (what changed and why)
- Key Differences (1st vs 2nd)
- Primary Bottleneck in 2nd period
- Evidence (`% DB time`, wait events, SQL IDs)
- Root Cause Hypotheses (facts vs inference clearly separated)
- Validation Steps
- Prioritized Recommended Actions

### 9) AWR Guardrails

- Do not assume problem type before evidence.
- Prefer Diff columns over absolute values.
- Mark missing/insufficient sections explicitly.
- Do not fabricate unavailable metrics.

## Report-Detection Rules

Do not rely only on filename. Detect by content signatures when needed:

- DB Replay Report: title/signatures include replay options/divergence section
- Compare Period Report: title/signatures include main performance section or AWR-missing stub text
- Database Capture Report: title/signatures include captured workload statistics
- AWR Compare Report: title/signatures include AWR compare/workload repository markers

## LLM Narrative Rules

- LLM is optional and gated by `--use-llm` (CLI) or the UI checkbox.
- Without LLM: use deterministic output only and consume no tokens.
- With LLM:
  1. build deterministic summary first
  2. create structured payload from deterministic output
  3. request narrative rewrite
  4. merge only narrative sections back
  5. keep deterministic metrics/verdict anchors unchanged

## Output Contract

Every final summary should include:

- concise executive summary
- functional status (`Valid`, `Usable with caveats`, or `Invalid`)
- performance status (`Good`, `Mixed`, or `Degraded`)
- explicit evidence bullets (metrics/events/SQL IDs where available)
- clear next validation steps

When data is missing:

- state `Insufficient data` explicitly
- do not infer unavailable values

## Validation Checklist

Before finalizing:

1. Confirm all available report files were detected.
2. Confirm capture-report presence/absence is reported correctly.
3. Confirm DB Time/CPU values are shown only when present.
4. Confirm divergence wording follows threshold logic.
5. Confirm LLM usage/tokens are shown only when LLM was used.
6. Confirm HTML renders in standalone mode.

## Quick Usage Notes

- Local UI:
  - start API server
  - open `http://127.0.0.1:4567/apps/web/index.html`
- CLI deterministic:
  - `node scripts/replay-summary-cli.js --report-dir <dir> --out <file>`
- CLI with LLM:
  - set `OPENAI_API_KEY`
  - optional: `OPENAI_BASE_URL`, `OPENAI_MODEL`
  - run with `--use-llm`
