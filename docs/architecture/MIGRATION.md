# Structure Migration (Oracle Internal)

## Summary

This repository was migrated from a single-folder prototype into an enterprise-oriented layout with explicit app/package boundaries and governance documentation.

## Key Moves

- `index.html` -> `apps/web/index.html`
- `server.rb` -> `apps/api/server.rb`
- `enterprise-manager-replay-summary.user.js` -> `apps/userscript/enterprise-manager-replay-summary.user.js`
- `replay-summary.js` -> `packages/core-parser/replay-summary-core.js`
- `ARCHITECTURE.md` -> `docs/architecture/ARCHITECTURE.md`
- `dbrep_reports/` -> `tests/fixtures/dbrep_reports/`

## Backward Compatibility

- Root `index.html` now redirects to `/apps/web/index.html`.
- API server document root is repository root so web and package assets remain reachable.

## Follow-Up Work

- Add parser unit tests and replay fixture regression tests.
- Move userscript parsing logic to consume shared parser package when feasible.
- Add dependency and license scanning jobs as dependencies are introduced.
