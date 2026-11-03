# PayGuard (synthetic-data vertical slice)

Diagnoses an incomplete or financially overstated construction payment application using deterministic, explainable calculations. **Synthetic demo only.** All parties are fictional, and all rules are illustrative contract configuration, not law. This is not production-ready and not a verified demo.

Current state: architecture foundation. The engine is an unimplemented boundary stub, and there is no UI, CI or deployment. See [`docs/architecture/`](docs/architecture/README.md).

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
