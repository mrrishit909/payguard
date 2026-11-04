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

## Browser QA (implementer validation, not the independent review)
`node scripts/build.js`, then `PLAYWRIGHT_MODULE=<path to an existing playwright package> node --test tests/e2e/browser-qa.mjs`. The script installs nothing and serves `dist/` on 127.0.0.1 itself. It drives headless Chromium through these checks:
- the landing proof slots and both failure fallbacks;
- reduced motion and the skip control;
- the keyboard reviewer journey (buttons and form submits use focus plus Enter; native selects are set programmatically), including filters, focus moving to the evidence panel, the USD evidence labels and an inert HTML note;
- correcting the claim to 45000 with the corrected waiver, then rerunning to zero blocking findings;
- run 1 history, and the contents of the JSON and CSV downloads;
- invalid, impossible-date and oversize uploads;
- the skip link, both before and after load;
- the 390px layout.

Zero console errors are required. No axe, Lighthouse or cross-browser run was done. `tests/e2e/payguard.e2e.spec.mjs` targets `@playwright/test` and was not run.

## Website rubric (website-playbook, eight criteria)
Rows marked "Chromium" were checked by the implementer in headless Chromium (`tests/e2e/browser-qa.mjs` plus 390px/320px screenshots of the proof sheet and evidence panel). None of this replaces the independent review, so no row is Strong.

| Criterion | Intended outcome | Implementation decision | Evidence inspected | Status | Remaining correction |
|---|---|---|---|---|---|
| Point of view | Construction document desk on both pages | Ivory sheet, ink rules, rust registration marks on the proof document and wordmark | Source only | UNVERIFIED | Screenshot review of both pages (desktop and 390px) |
| Typography | Condensed plan-title headings, readable UI text, tabular numbers only on amounts and IDs | System stacks: Avenir Next Condensed / Arial Narrow; system-ui; ui-monospace for `.num` | Source only. Font fallback differs by OS | UNVERIFIED | Check heading breaks and fallback rendering on macOS, Windows and Android |
| Colour | Five roles with measured contrast | Palette from the brief. Slate and rust used only at ≥14px on ivory or white. `--rule` used only for decoration | Atlas palette ratios (computed, not rendered) | UNVERIFIED | Rendered contrast of hover, focus, disabled and error states |
| Hierarchy | Summary, then calculation, then evidence; one primary action | One rust primary per region; difference figure largest | Source only | UNVERIFIED | Squint test on screenshots |
| Imagery | Original document fragment, no stock or remote media | HTML/CSS document plus two inline SVG marks | Chromium screenshots of the sheet at 390px and 320px: all four columns inside the sheet after removing the figure's default 40px margins | Chromium | Desktop and other-browser crops |
| Motion | One skippable alignment sequence; 160ms feedback; reduced motion shows the final state | Transform-only keyframes (700ms slip, 420ms mark), content visible throughout, live `matchMedia` change handler, global reduced-motion override | Chromium: skip control shows, hides on click and focuses the title; under reduced motion there is no skip control and no animation class (fixed: `.btn` display overrode `[hidden]`) | Chromium | Watch it live; toggle reduced motion mid-sequence |
| Mobile | Single column; ledger scrolls in a labelled region | 960px and 560px breakpoints, sticky first ledger column, 44px targets, fluid proof-table type below 560px | Chromium at 390x844: no page overflow on either page, and no proof element past the sheet edge; 320px screenshot fits | Chromium | Real devices; 44px target audit |
| Invisible quality | Semantic HTML, keyboard, CSP, no console errors, honest states | Native controls, live status region, `role=alert` errors, strict CSP without inline code, 404 page | Node tests: build contents, headers, traversal, no HTML sinks. Chromium: keyboard journey, skip link before and after load (fixed an early popstate crash), zero console errors, fallback text without raw exceptions | Mixed | axe, Lighthouse, screen reader: UNVERIFIED |
