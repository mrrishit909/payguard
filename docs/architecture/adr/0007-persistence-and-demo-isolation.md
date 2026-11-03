# ADR-0007: Local/browser persistence (no Worker/D1) and synthetic demo isolation

Status: ACCEPTED for the vertical slice (pending Codex review). Date: 2026-11-03.

## Decision
The slice uses **no server persistence**. State (imported application, analyses, review events) lives in browser memory, optionally mirrored to the visitor's own `sessionStorage`/`IndexedDB` under a versioned key. A "Reset demo" action clears only that browser's state and reloads the read-only seed. Hosting, when it is approved later, is static files only.

## Why not Cloudflare Worker + D1 now
| Factor | Assessment |
|---|---|
| Functional need | None. The engine is pure and runs client-side. Single-user demo, no cross-device sync. |
| Threat model | Server storage of uploads would create a multi-visitor data store needing tenant isolation tests (SEC-04) and retention rules. A per-browser store has no cross-visitor path. |
| Cost gate | `PROJECT-STATUS.json` has `cloudflare: AUTHENTICATION_UNVERIFIED`, and the free-tier plan is unverified. Charter: no paid resources. |
| Spec | "No server persistence unless justified by threat model and cost gate." Neither justifies it. |

**Revisit trigger:** real multi-user accounts, shared review across devices, or a server-side audit log requirement. Any of these requires a new ADR, SEC-04 isolation tests, a verified free quota and Codex approval *before* provisioning.

## Synthetic/demo isolation
- `dataClassification` must be the literal `"SYNTHETIC"` in bundles, uploads and reports. Nothing else is accepted (there is no "REAL" mode in v1).
- Seed and fixture data use fictional parties and `PG-`-prefixed IDs, and the files say "synthetic" in their top-level fields. No secrets, emails, addresses or real company names (A03 responsibility, Codex check).
- Every export carries `syntheticLabel`, and the UI must show it persistently (FE requirement).
- The engine makes no network calls, so a public demo cannot leak one visitor's data to another. A reset affects only the local browser.
- No analytics or third-party scripts in the slice without a separate review.
