# apps/payguard: static overview and review workspace (synthetic demo)

There is no framework and no dependencies. Plain ES modules run in the browser and call only `packages/payguard-engine/src/index.js`. All money values, findings, statuses and exports come from the engine. The UI only formats engine decimal strings with thousands separators (`groupDigits`).

| Path | Role |
|---|---|
| `src/index.html`, `src/assets/landing.js` | Overview page. Its document fragment is filled from a real engine run on the sample files. |
| `src/app/index.html`, `src/assets/app.js` | Review workspace: import, ledger, findings, evidence, correction and rerun, review, export, method |
| `src/assets/workflow.js` | DOM-free workflow state. The engine and clock are injected. Covered by `tests/payguard-app/workflow.test.js`. |
| `src/assets/dom.js` | Text-only element builder. There is no HTML parsing path. |
| `src/assets/fixtures.js` | Loads the same-origin sample files and creates the workflow |
| `src/assets/styles.css` | Construction document desk tokens and layout |

Run it: `node scripts/build.js && node scripts/serve.js dist 4173`, then open `http://127.0.0.1:4173/` (overview) and `/app/` (workspace).

## Behaviour notes
- State lives in memory only. Reload or **Reset demo** clears it. URL `?run=N&finding=ID` works with browser history inside a session, but a fresh link cannot restore state. Loading the sample re-selects the linked finding.
- Imports are atomic. The size is checked before the file is read, and on failure the error panel says which prior run is unchanged.
- Corrections are staged and then applied by **Rerun analysis**. A claim correction goes back through `parseApplicationJson` with the source name "Reviewer correction (claimed current due)". There is no resolve or dismiss button. A finding clears only when a later run stops producing it, and "No longer produced by this run" links back to the run where it was last seen.
- Review entries refer to the run being viewed, and they pass that run's `findingIds` to `appendReviewEvent`. Notes render as text with `pre-wrap`.
- Exports cover the run being viewed, with earlier runs as `priorAnalyses` and the full review history.

## Website rubric (website-playbook, eight criteria)
This run had no browser. Nothing below was inspected as a rendered result, so no row is Strong.

| Criterion | Intended outcome | Implementation decision | Evidence inspected | Status | Remaining correction |
|---|---|---|---|---|---|
| Point of view | Construction document desk on both pages | Ivory sheet, ink rules, rust registration marks on the proof document and wordmark | Source only | UNVERIFIED | Screenshot review of both pages (desktop and 390px) |
| Typography | Condensed plan-title headings, readable UI text, tabular numbers only on amounts and IDs | System stacks: Avenir Next Condensed / Arial Narrow; system-ui; ui-monospace for `.num` | Source only. Font fallback differs by OS | UNVERIFIED | Check heading breaks and fallback rendering on macOS, Windows and Android |
| Colour | Five roles with measured contrast | Palette from the brief. Slate and rust used only at ≥14px on ivory or white. `--rule` used only for decoration | Atlas palette ratios (computed, not rendered) | UNVERIFIED | Rendered contrast of hover, focus, disabled and error states |
| Hierarchy | Summary, then calculation, then evidence; one primary action | One rust primary per region; difference figure largest | Source only | UNVERIFIED | Squint test on screenshots |
| Imagery | Original document fragment, no stock or remote media | HTML/CSS document plus two inline SVG marks | Source only | UNVERIFIED | Visual check of the sheet crop at 390px |
| Motion | One skippable alignment sequence; 160ms feedback; reduced motion shows the final state | Transform-only keyframes (700ms slip, 420ms mark), content visible throughout, live `matchMedia` change handler, global reduced-motion override | Source only | UNVERIFIED | Watch it live; toggle reduced motion mid-sequence |
| Mobile | Single column; ledger scrolls in a labelled region | 960px and 560px breakpoints, sticky first ledger column, 44px targets | Source only | UNVERIFIED | 390x844 screenshots; overflow check (e2e scenario written) |
| Invisible quality | Semantic HTML, keyboard, CSP, no console errors, honest states | Native controls, live status region, `role=alert` errors, strict CSP without inline code, 404 page | Node tests: build contents, headers, traversal, no HTML sinks | Mixed | axe, keyboard pass, console, Lighthouse: all UNVERIFIED |
