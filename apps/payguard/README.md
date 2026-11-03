# apps/payguard (scaffold placeholder, no UI yet)

This directory is reserved for the browser application, owned by a future frontend (FE) assignment. Nothing here is built.

## Preconditions before any UI code
1. Engine accepted by Codex (steps 2–4 in `docs/architecture/IMPLEMENTATION-PLAN.md`).
2. Frontend dependencies (e.g. React/Vite, Playwright, axe) security-approved, or a documented no-build alternative accepted.
3. The website-playbook skill and its relevant references loaded **before** any design decision. Final styling comes after functional correctness.

## Binding constraints (from ADRs)
- Call only `packages/payguard-engine/src/index.js`. No domain logic or money arithmetic in the UI.
- Render all user and evidence text as text nodes. No `innerHTML`, no HTML in notes.
- Show the `SYNTHETIC_LABEL` persistently. Never display "compliant", "approved" or "accepted".
- Check `File.size` before reading. Pass `Uint8Array` to the importers.
- Supply `generatedAt`/`occurredAt` from the app clock. The engine never reads the clock.
- State lives in the browser only (ADR-0007). Reset clears only local state.
- Spec test 7 journey with full keyboard support and visible focus. Resolution only by rerun.
