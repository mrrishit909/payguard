# Implementation plan (slice only)

Each step is a separate bounded assignment, and Codex accepts each before the next is dispatched.

## Step 1: A01 architecture (this deliverable)
ADRs 0001–0007, contracts package, engine boundary stub, architecture guard tests, ownership and traceability. Exit: `node --test` passes, and Codex accepts the ADRs.

## Step 2: A02 engine (`packages/payguard-engine/`)
Suggested order, each with unit tests under `packages/payguard-engine/test/`:
1. `money.js`: strict decimal parse, `formatCents`, checked add/sub, half-up bps retainage, no -0.
2. `dates.js`: calendar validation and comparison without `Date`.
3. `canonical.js`: sorted-key JSON, ID sorting, deep clone/freeze, SHA-256 hex via `crypto.subtle`.
4. `csv.js` (RFC 4180 subset reader/writer) and `import-json.js` / `import-csv.js`: ADR-0004 pipeline, provenance.
5. `validate.js`: bundle validation and cross-entity checks.
6. `reconcile.js`: PG-CALC-01..04.
7. `rules/required-signed-document.js`: ADR-0005 matching table.
8. `findings.js`: deterministic IDs, wording, ordering, readiness.
9. `review.js`, `report.js`, `export-csv.js`: append-only history, derived statuses, JSON/CSV export.
Exit: spec acceptance totals reproduced, stub `NOT_IMPLEMENTED` gone, `tests/architecture` still green.

## Step 3: A03 fixtures and reference tests
`fixtures/payguard/` (PG-SYN-001 bundle and JSON/CSV uploads, corrected case, malformed and adversarial set) and `tests/payguard-reference/` (acceptance tests 1–6, 8, 9 at engine level). Run 9 with at least `TZ=UTC` and `TZ=Pacific/Kiritimati`. E2E gaps recorded.

## Step 4: A04 independent review + Codex recalculation
Read-only run on an exact commit.

## Step 5 (gated): frontend, CI, deployment
- FE: needs dependency approval (React/Vite or a justified no-build alternative) and the website-playbook skill loaded before design decisions. Functional journey first (spec test 7), styling last.
- REL: `.github/workflows/` only after the Actions free-quota and zero-spend gate. Static hosting only after the provider gate (ADR-0007).
