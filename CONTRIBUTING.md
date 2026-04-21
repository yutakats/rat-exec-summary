# Contributing

## Branch and PR Expectations

- Use focused feature branches.
- Keep pull requests small and reviewable.
- Link changes to tracked work items.

## Code Standards

- Keep parser and UI concerns separated.
- Preserve deterministic parser behavior when changing narrative text logic.
- Add tests for parser regressions and edge cases.

## Commit Guidelines

- Use clear, imperative commit messages.
- Include risk notes for parsing logic changes.
- Document API or schema contract changes in `docs/`.

## Review Checklist

- No secrets committed.
- Fixture data is sanitized.
- Error paths are user-readable.
- LLM path failure does not block deterministic summary output.
