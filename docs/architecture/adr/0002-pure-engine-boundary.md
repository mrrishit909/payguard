# ADR-0002: Pure deterministic engine boundary

Status: ACCEPTED for foundation (pending Codex review). Date: 2026-11-03.

## Decision
`packages/payguard-engine/src/index.js` is the **only** entry point for all PayGuard domain behaviour. Its exported names must equal `ENGINE_PUBLIC_API` (enforced by a test). Presentation, storage and file pickers live outside the engine and only call this API.

```
untrusted bytes ──► parseApplicationJson / parseApplicationCsv ──► Result<ImportedApplication>
seed bundle    ──► validateProjectBundle ───────────────────────► Result<ProjectBundle>
                     analyze({bundle, imported}) ──────────────► Result<Analysis>
                     computeSemanticHash(analysis) (async) ────► hex
history + event ──► appendReviewEvent ─────────────────────────► Result<ReviewEvent[]>
                     buildReport({...generatedAt}) ────────────► Report (deep-frozen)
                     serializeReportJson / serializeReportCsv / parseReportJson
```

### Purity rules (enforced heuristically by `tests/architecture/boundaries.test.js`)
- No I/O, network, storage, DOM, `process`, dynamic import, `eval`, or `node:*`.
- No clock (`Date.now`, `new Date()`). Dates are validated strings, and `reviewDate` and `generatedAt` are inputs.
- No randomness. IDs are either supplied or derived from content (SHA-256).
- No `parseFloat`, `toFixed`, `Intl`, `toLocaleString` or `localeCompare`. Ordering uses code-unit comparison of IDs.
- Inputs are never mutated. Outputs are structurally cloned and deep-frozen, so mutating an input after `analyze`/`buildReport` can't change a retained snapshot (spec test 9).
- Async is limited to `computeImportBatchId` and `computeSemanticHash`, both using the WebCrypto `crypto.subtle.digest('SHA-256')` available in Node 24 and browsers.

### Failure semantics
- Invalid user input never throws. It returns `{ok:false, errors}` with code, message, and path or row/column, and never a stack trace. Programmer errors (wrong argument types from the app) may throw.
- A failed `Result` carries **no partial value**, so the UI cannot render totals from an invalid import (spec "no success totals").
- Errors are capped at `MAX_ERRORS_REPORTED` and are sorted deterministically (path/row, then code).

### Internal layout (recommended to A02, not mandated)
`src/money.js` (parse/format/checked add/sub/mul, half-up), `src/dates.js`, `src/csv.js`, `src/import-json.js`, `src/import-csv.js`, `src/validate.js`, `src/reconcile.js`, `src/rules/required-signed-document.js`, `src/findings.js`, `src/canonical.js` (sorted JSON + hash), `src/review.js`, `src/report.js`, `src/export-csv.js`. Only `index.js` is public. Reference tests must never import internals.

## Rejected alternatives
- **Engine inside the React app:** couples correctness to UI tooling that isn't approved yet.
- **Server-side engine (Worker):** adds infrastructure without need (see ADR-0007).
- **General rule DSL/regulatory engine:** explicitly out of scope (see ADR-0005).
