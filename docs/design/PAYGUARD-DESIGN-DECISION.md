# PayGuard design decision

Date: 2026-11-06. Branch `atlas/foundation`. Synthetic demo; rules illustrative, not law.

## Three alternatives

| | A. Construction document desk (chosen) | B. Chronological collection rail | C. Architectural drawing workspace |
|---|---|---|---|
| Typography | Condensed grotesque titles (Avenir Next Condensed, then Arial Narrow), system UI body, monospace for figures and sheet labels. | Humanist serif dates and headings, system sans body. | Thin geometric sans in caps, mono dimensions. |
| Palette | Ivory #F5F2E8, ink #14252C, rust #A64B30, slate #53676D, tint #ECE7D9. | Warm white, dark teal, one amber. | Blueprint navy ground, pale line work, one signal colour. |
| Composition | Oversized payment document beside a huge title on a faint drawing grid; an ink band shows the three records converging on the check; ledger-row method; numbered notes. | Vertical timeline of submissions, waivers and payments with the claim at the end. | Large pan/zoom drawing sheet with callouts and a side schedule. |
| Domain imagery | Original CSS/SVG sheets, ruled lines, registration marks, live-calculated schedule of values. | Dated document stubs on a rail. | Linework of a building section with dimension strings. |
| Motion | One 700 ms slip alignment (skippable) plus a scroll-linked line draw where supported. | Rail fills as it scrolls. | Zoom/pan between callouts. |
| Mobile | Document stays whole at four columns; documents stack; ledger rows stack. | Natural fit. | Weak: small drawing, hidden detail. |

## Choice: A

The product's one job is to show which figure in which document disagrees by how much. A document is the native object of a payment application, so the proof can be the page rather than a picture of it. B tells the order of events, but the review is about reconciliation, not chronology, and B would hide the dollar difference in a list. C implies a building drawing the product never reads, adds pan/zoom that phones handle badly, and its blueprint palette is the obvious construction cliche. A also reuses the already approved palette, which was contrast checked, and keeps every existing calculation and test hook.

Distinctness from the other nine Atlas sites (concept only, nothing built here): OriginProof is an asymmetric route map; ClaimShield a wide calm validation table; TraceChain a lot-branching flow; HospiceAudit a serif episode timeline; AquaSentinel a schematic topology; ShiftLedger a week matrix; CodeEvidence a split index; DisputeRadar a scenario delta chart; PharmaLedger a horizontal evidence progression. None uses ivory sheets, registration marks or the ink band here.

## What changed (overview route only)

`apps/payguard/src/index.html`, `assets/styles.css`. New: eyebrow labels, "Exhibit 1" caption, drawing-grid hero with a 6.4 rem title, ink band "Three documents, one check" with CSS sheets and an SVG trace, ledger-row method list, numbered method notes, larger closing CTA. Unchanged: `landing.js`, all 17 `data-f` slots, test ids, the live calculation, skip control, CSP, base path (relative URLs). The app route is untouched; it shares the tokens.

## Eight-criterion rubric

Desktop and true 390x844 device-emulated renders have been viewed. Strong is withheld until every criterion is individually inspected at its relevant breakpoints.

| Criterion | Intent | Decision | Evidence | Status |
|---|---|---|---|---|
| Point of view | The page is a construction document, not a SaaS template | Grid ground, sheet, registration marks, ink band | Code read only | Unverified |
| Typography | Condensed display against quiet body | 6.4 rem condensed title, mono labels, system fonts only (CSP `font-src 'none'`) | Code read only; condensed face depends on OS font | Unverified |
| Colour | Ivory, ink, one rust accent | Existing contrast-checked tokens; ink band adds #E0876A on ink | Palette check doc for old pairs; #E0876A on #14252C = 5.89:1 (reported calculation) | Contrast pair passes AA text; rest Unverified |
| Hierarchy | Title, then proof, then CTA | One primary button, quieter jump link | Code read only | Unverified |
| Imagery | Original evidence, no stock | Live sheet, CSS documents, SVG trace; no fabricated numbers in decoration | Code read only | Unverified |
| Motion | Restrained and skippable | Existing 700 ms sequence with skip; scroll-linked draw only under `@supports`; global reduced-motion rule | Code read only | Unverified |
| Mobile | Designed, not squeezed | Compact two-column nav, full-width CTA and wrapping notice; single-column stack and ledger rows | Chrome device emulation at 390x844; document and body widths both 390px; screenshot inspected. Header and notice now fit. | Mixed; desktop/mobile overview inspected, full app route and 768px remain unchecked |
| Invisible quality | Semantics, focus, no overflow, CSP | Decorative SVG `aria-hidden`; no inline style, remote URL or script added | Static reasoning only | Unverified |

## Evidence

Collected: `npm run build` passed after the correction (27 files, 207572 bytes); desktop render and true 390x844 Chrome device-emulated screenshot inspected; contrast of #E0876A on #14252C calculates to 5.89:1. Mobile DOM measured `innerWidth=390`, document/body `scrollWidth=390`; screenshot inspected from top through footer.

Defect found in the first screenshot attempt: the header links and synthetic notice appeared clipped at the right edge. That render used Chrome's 500px CSS viewport and a 390px cropped screenshot, so it was not valid phone evidence; the first correction was then verified using explicit 390px device emulation.

Correction made in `assets/styles.css`: at 560 px and below the masthead becomes a one-column grid, the nav a two-column grid of 44 px links with the CTA full width, `.masthead > *` gets `min-width: 0`, `.synthetic` gets `overflow-wrap: anywhere`; method-note numbering continues N1-N7 across the lists. Status: **header and notice clipping corrected in the inspected 390 px render; no horizontal document overflow measured.**

Also collected: source files read; constraints checked against `tests/payguard-app/site.test.js` and `tests/e2e/browser-qa.mjs` by reading (17 slots, no inline style, no remote URLs, forbidden wording absent).

Not collected: unit and e2e tests (out of scope), keyboard walk, reduced-motion check, frame pacing, scroll-linked animation in motion, Safari or Firefox behavior, or a separate full-app-route/mobile visual review. The measured new ink accent pair passes AA text contrast, but other state contrasts remain unmeasured.
