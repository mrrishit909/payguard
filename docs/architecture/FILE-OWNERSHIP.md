# File ownership map

One writer per path at a time. Changes outside your paths need a Codex-issued assignment. Contract changes (A01 paths) need an ADR update accepted by Codex. They must never be made to "fix" a failing test.

| Path | Owner | May read | Notes |
|---|---|---|---|
| `docs/architecture/**` | A01 | all | ADRs, threat model, traceability, plan |
| `packages/contracts/**` | A01 | all | Constants + JSDoc types. Engine and tests import, never edit. |
| `tests/architecture/**` | A01 | all | Purity, dependency and public-API guards |
| `package.json` (root), `README.md` | A01 → CX | all | Script additions via Codex |
| `packages/payguard-engine/src/**` | **A02** | A03, A04 (read-only) | Stub created by A01; ownership transfers on dispatch of 02 |
| `packages/payguard-engine/test/**` | **A02** | all | Implementer's own unit tests. Not independent evidence. |
| `packages/payguard-engine/package.json` | A02 | all | Must keep zero dependencies |
| `fixtures/payguard/**` | **A03** | A02 (read-only, after A03 lands), A04 | Synthetic bundles/uploads; literal expectations |
| `tests/payguard-reference/**` | **A03** | A04 | Imports only `packages/payguard-engine/src/index.js` + fixtures + `node:*`. Never edits engine. |
| `apps/payguard/**` | FE (future) | — | Blocked on dependency approval + website-playbook skill |
| `.github/workflows/**` | REL (future) | — | Blocked on Actions free-quota gate |
| `docs/specs/**`, `docs/assignments/**`, `PROGRAM-CHARTER.md`, `PROJECT-STATUS.json`, `COST-LEDGER.md`, `SECURITY-REGISTER.md`, `AGENTS.md` | CX | all | Coordination inputs; implementers don't edit |

## Isolation rules for A02 / A03
- A03 expected values are literal integers derived by hand from the spec. They are never computed by calling engine helpers such as `parseDecimalToCents` (enforced in part by `tests/architecture` "reference tests use only the engine public entry point". Literal-only expectations are checked by A04/Codex review).
- A02 may write its own fixtures only under `packages/payguard-engine/test/`, and must not copy A03 expectations into the engine.
- On a disagreement, A03 records the failing case and expected/actual values for a separate repair assignment. Nobody changes the other side.
