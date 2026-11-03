# PayGuard slice architecture

Status: foundation only. No financial reconciliation is implemented, and the engine is a signature stub. Spec: [`../specs/PAYGUARD-VERTICAL-SLICE.md`](../specs/PAYGUARD-VERTICAL-SLICE.md).

```
apps/payguard (future UI, browser-only) ──calls──► packages/payguard-engine (pure, sync + WebCrypto hash)
        │                                                  │ imports
        │ text-only rendering, local state                 ▼
        └──────────────────────────────────────► packages/contracts (constants + JSDoc types)
fixtures/payguard ──► tests/payguard-reference ──► engine public index.js only
```

| Document | Decision |
|---|---|
| [ADR-0001](adr/0001-runtime-and-tooling.md) | Dependency-free ESM + JSDoc + node:test; TS/Vite/Vitest deferred until approved |
| [ADR-0002](adr/0002-pure-engine-boundary.md) | Single pure engine entry point, Result failures, no clock/I/O |
| [ADR-0003](adr/0003-money-dates-determinism.md) | Safe-integer cents, half-up per-line retainage, string dates, canonical hashing |
| [ADR-0004](adr/0004-input-schema-and-import.md) | Strict JSON/CSV application schema, atomic import, unknown fields rejected |
| [ADR-0005](adr/0005-rules-findings-provenance-review.md) | Versioned rules (one configurable kind), findings, provenance, append-only review events |
| [ADR-0006](adr/0006-export-schema.md) | Report JSON round-trip and formula-safe CSV |
| [ADR-0007](adr/0007-persistence-and-demo-isolation.md) | Browser-only state; no Worker/D1; synthetic-only isolation |
| [THREAT-MODEL](THREAT-MODEL.md) | Boundaries TB-1..TB-7 |
| [TRACEABILITY](TRACEABILITY.md) | Every spec requirement → owner/path/test/boundary/status |
| [FILE-OWNERSHIP](FILE-OWNERSHIP.md) | Writer per path, A02/A03 isolation |
| [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) | Ordered, gated steps |

No infrastructure is required for the slice. CI and hosting are deferred behind their gates (see ADR-0007 and PROJECT-STATUS gates).
