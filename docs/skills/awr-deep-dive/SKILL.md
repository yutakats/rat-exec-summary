# AWR Deep-Dive Analysis (Optional)

Use this skill only when AWR deep-dive is explicitly enabled.

## Strict Procedure

### 1) Workload Comparison (High-Level)

- Compare `DB Time`, `DB CPU`, and `Avg Active Sessions` across `1st` vs `2nd`.
- Normalize per second / per transaction where available.
- State workload change and efficiency change.

### 2) Time Model Analysis

- Compare DB CPU share vs non-CPU share.
- Classify mode:
  - CPU-bound
  - Wait-bound
  - Mixed

### 3) Bottleneck Shift

- Use `Wait Classes` Diff of `% DB time`.
- Identify biggest increase and biggest decrease.
- Treat top increase as primary regression signal.

### 4) Wait Event Drill-Down

- Use `Wait Events`.
- Rank by `% DB time` in 2nd period and `%Diff` increase.
- Map context:
  - Commit: `log file sync`, `log file parallel write`
  - User I/O: read/write pressure
  - Concurrency: contention/hot blocks/ITL
  - Application: locking and app-level waits

### 5) Branch by Dominant Regression

- Commit dominated: analyze commit frequency, redo size, avg wait changes.
- User I/O dominated: analyze read/write events and SQL I/O contributors.
- Concurrency dominated: analyze lock and buffer contention.
- CPU dominated: analyze SQL by CPU and execution growth.

### 6) SQL-Level Comparison (Critical)

- Use Top SQL comparisons by elapsed/CPU/I/O/executions.
- Identify:
  - biggest `% DB time` increase
  - major execution-count growth
  - newly appearing SQL in 2nd period
- Classify each SQL:
  - high-frequency (chatty)
  - expensive per execution
  - contention-causing

### 7) Correlate Across Sections

- Cross-check waits/events against SQL changes.
- Cross-check load profile against execution patterns.
- Ensure root-cause hypothesis is consistent across evidence.

### 8) Required AWR Output

Provide:

- Executive Summary
- Key Differences (1st vs 2nd)
- Primary Bottleneck in 2nd period
- Evidence (`% DB time`, wait events, SQL IDs)
- Root Cause Hypotheses (facts vs inference clearly separated)
- Validation Steps
- Prioritized Recommended Actions

## Guardrails

- Focus on Diff columns, not only absolute values.
- Do not assume problem type before evidence.
- Clearly mark missing sections as insufficient.
- Do not invent metrics.

