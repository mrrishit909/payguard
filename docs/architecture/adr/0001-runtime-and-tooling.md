# ADR-0001: Dependency-free ESM JavaScript + JSDoc + node:test

Status: ACCEPTED for foundation (pending Codex review). Date: 2026-11-03.

## Context
The assignment brief prefers React/TypeScript/Vite/Vitest. The concrete execution context for this run says: Node 24 only, **no dependency installation authorized**, prefer dependency-free ESM with JSDoc and `node:test`, and code must run in both Node and browsers. SECURITY-REGISTER SEC-02/SEC-05 and COST-LEDGER make every new dependency a reviewed decision.

## Decision
- Engine and contracts are plain ES2023 modules (`.js`, `"type": "module"`), relative imports with explicit `.js` extensions, and no `node:*` imports. They load unchanged in Node 24 and in any evergreen browser via `<script type="module">`.
- Types are JSDoc typedefs in `packages/contracts/src/types.js`. **Type checking is not machine-verified yet** because `tsc` isn't installed. The real enforcement is the engine's runtime validation, plus `tests/architecture/boundaries.test.js`.
- Tests use `node:test` + `node:assert/strict`. Tests may use `node:*` APIs; pure sources may not.
- No bundler and no package linking. Cross-package imports use relative paths.

## Deviation from preferred stack and how to reverse it
| Preferred | Now | Migration trigger and step |
|---|---|---|
| TypeScript | JSDoc in `.js` | When `typescript` is security-approved, add it as a devDependency and run `tsc --noEmit --checkJs --strict`. No source rewrite needed. |
| Vitest | `node:test` | Optional. `node:test` covers unit and reference needs. |
| React + Vite | Not started | The frontend assignment adds them under `apps/payguard/` only, after dependency approval and the website-playbook skill. The engine stays framework-free. |
| Playwright + axe | Not available | Spec test 10 stays NOT VERIFIED until they're approved. |

## Consequences
- Zero supply-chain surface for the engine, and the same bytes are tested in Node and shipped to browsers.
- No compile-time type safety until `tsc` is approved. This is a recorded limitation (see TRACEABILITY "Typecheck").
- The architecture test rejects any `dependencies`/`devDependencies` key until a security record exists. Adding one means updating that test, which is a deliberate act Codex can see.
