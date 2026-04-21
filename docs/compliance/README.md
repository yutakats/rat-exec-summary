# Compliance Notes

## Intended Use

Internal Oracle usage for replay summary analysis support.

## Controls To Maintain

- Deterministic parser remains source of truth.
- Optional LLM output must not invent facts.
- Inputs remain local unless explicitly sent through approved services.
- No production customer report data committed to source control.

## Operational Requirements

- Maintain auditability for scoring/rule changes.
- Keep architecture and runbooks updated with each material change.
