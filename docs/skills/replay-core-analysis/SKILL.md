# Replay Core Analysis

Use this skill for the default deterministic replay summary flow (without mandatory AWR deep dive).

## Required Report Flow

Always analyze in this order:

1. Replay At-a-Glance
2. Functional Assessment
3. Performance Assessment

## Core Logic

### Functional Assessment

- Prioritize `Database Capture Report` when available.
- Assess representativeness of captured workload.
- Classify divergence:
  - `< 5%` = Good
  - `5% to 20%` = Moderate
  - `> 20%` = High/problematic
- Distinguish localized non-core failures vs widespread core-workload failures.

### Performance Assessment

- Primary KPI is `DB Time`.
- Evaluate `DB CPU` vs wait/I/O profile.
- Reuse Compare Period ADDM and Top SQL sections when available.
- Do not rely on wall-clock duration alone.

## Report-Detection Rules

Do not rely on filename only. Use content signatures where needed:

- DB Replay Report: replay options/divergence sections
- Compare Period Report: main performance stats or AWR-missing stub
- Database Capture Report: captured workload statistics section

## Output Contract

Include:

- concise executive summary
- functional status (`Valid`, `Usable with caveats`, or `Invalid`)
- performance status (`Good`, `Mixed`, or `Degraded`)
- key evidence bullets
- clear validation steps / actions

If data is missing:

- say `Insufficient data`
- do not infer unavailable values

## LLM Usage in Core Flow

- LLM is optional.
- If enabled, deterministic metrics/verdict remain anchors.
- LLM rewrites narrative only; it does not replace rule-based evidence.

