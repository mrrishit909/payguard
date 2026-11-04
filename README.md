# PayGuard (synthetic-data vertical slice)

Diagnoses an incomplete or financially overstated construction payment application using deterministic, explainable calculations. **Synthetic demo only.** All parties are fictional, and all rules are illustrative contract configuration, not law. This is not production-ready and not a verified demo.

Current state: architecture foundation. The engine is an unimplemented boundary stub, and there is no UI, CI or deployment. See [`docs/architecture/`](docs/architecture/README.md).

## Data origin and real data
- **PayGuard does not detect or prevent real data.** Do not import real payment applications or personal, financial or confidential information.
- Only the built-in **Load sample** buttons are labelled *bundled synthetic sample*. They read the fictional files shipped in `fixtures/payguard/`.
- A file you choose with **Import JSON or CSV file** is labelled *unverified origin*. This applies whatever its name is and even if it contains `dataClassification: "SYNTHETIC"`. That field is required on import, but it is the file's own claim and proves nothing about where the data came from.
- Files you choose are read in your browser tab and not uploaded. The app requests only its own same-origin pages, assets and sample files. CSP is `connect-src 'self'`.
- Report exports are `payguard.report.v2` (JSON) and `payguard.report-csv.v2` (CSV). Both record `applicationOrigin`, its label and the real-data warning. Older `payguard.report.v1` JSON is still readable, but it is read as *unverified origin* (`UNVERIFIED_LEGACY_REPORT`) because v1 labelled every report synthetic. See [ADR-0006](docs/architecture/adr/0006-export-schema.md).

## Requirements
Node.js ≥ 24. No dependencies and no install step.

## Commands (Node built-ins only)
```sh
node --test                                  # all tests (contracts + architecture guards)
node --test packages/contracts/test/         # contract constants
node --test tests/architecture/              # purity / zero-dependency / public-API guards
```
`npm test` runs the same `node --test`.

## Layout
| Path | Purpose | Owner |
|---|---|---|
| `packages/contracts/` | Schema versions, enums, limits, JSDoc types | architecture |
| `packages/payguard-engine/` | Pure deterministic engine (stub) | engine assignment |
| `fixtures/payguard/`, `tests/payguard-reference/` | Independent synthetic fixtures and reference tests (not yet created) | fixtures assignment |
| `tests/architecture/` | Boundary guards | architecture |
| `apps/payguard/` | Future browser UI (placeholder) | frontend assignment |
| `docs/architecture/` | ADRs, threat model, traceability, ownership | architecture |
