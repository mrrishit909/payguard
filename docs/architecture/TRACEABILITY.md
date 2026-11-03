# Requirement → owner / path / test / threat boundary

Source: `docs/specs/PAYGUARD-VERTICAL-SLICE.md` v1.0. Owners: **A01** architecture, **A02** engine, **A03** fixtures/reference tests, **A04** independent review, **FE** future frontend assignment, **REL** future release engineer, **CX** Codex.
Paths: `E` = `packages/payguard-engine/`, `C` = `packages/contracts/`, `F` = `fixtures/payguard/`, `R` = `tests/payguard-reference/`, `APP` = `apps/payguard/`.
Status column describes the state of *this commit*: **DONE** = implemented and tested here; **CONTRACT** = shape/constant fixed, behaviour not implemented; **PLANNED** = nothing yet.

## Scope and canonical data
| Req | Requirement | Owner | Path | Test | TB | Status |
|---|---|---|---|---|---|---|
| S-1 | Load seeded synthetic project | A03 data, A02 `validateProjectBundle`, FE load | F/`pg-syn-001.project.json`, E | R bundle-valid; FE E2E | TB-7 | CONTRACT |
| S-2 | Import JSON and documented CSV | A02 | E import-json/csv | E unit; R JSON≡CSV | TB-1 | CONTRACT (format in ADR-0004) |
| S-3 | Export JSON + spreadsheet-safe CSV | A02 | E report/export-csv | E unit; R round-trip/injection | TB-4 | CONTRACT (ADR-0006) |
| S-4 | Public demo + independent audit before VERIFIED_DEMO | REL, A04, CX | — | Live browser check | TB-5/6 | PLANNED |
| D-1 | Immutable IDs for all 11 entity types | A01 contract, A02 validate | C `ID_PATTERN`, types.js | C test grammar; R duplicates | TB-1 | CONTRACT |
| D-2 | USD only; currency mismatch rejected | A02 | E validate | R currency case | TB-1 | CONTRACT |
| D-3 | Integer cents; strict decimal parse (no overflow/exp/NaN/Inf/>2dp/separators/negatives) | A02 (A01 grammar) | C `DECIMAL_AMOUNT_PATTERN`, `MONEY_LIMITS`; E money | C grammar test (DONE); E unit; R malformed | TB-1/2 | CONTRACT |
| D-4 | External money as cents with unit or decimal strings | A02 | E report | R round-trip | TB-4 | CONTRACT |
| D-5 | Per-line half-up retainage in bps; sum of rounded lines | A02 | E money/reconcile | R rounding cases | TB-2 | CONTRACT (ADR-0003) |
| D-6 | Cumulative vs current labels | A01 | C types.js naming | A04 review | TB-3 | CONTRACT |
| D-7 | Prior certified informational, never subtracted | A02 | E reconcile | R double-subtraction trap | TB-2 | CONTRACT |
| D-8 | Revised cap = original + approved COs only | A02 | E reconcile | R pending exclusion | TB-2 | CONTRACT |
| D-9/10 | Gross = completed + stored; over-cap flagged, not clipped | A02 | E reconcile/findings | R $50,000.01 case | TB-2 | CONTRACT |
| D-11 | Net, due; negative due → overpayment finding, never floored | A02 | E reconcile | R overpayment | TB-2 | CONTRACT |
| D-12 | Claimed vs calculated, zero tolerance | A02 | E findings | R mismatch | TB-2 | CONTRACT |
| D-13 | Invalid input yields no success totals | A01 Result contract, A02 | C types `Result`; E | R malformed → `ok:false` without `value` | TB-1 | CONTRACT |
| D-14 | Finding fields (code, severity, refs, observed/expected, rule version, rationale, remediation) | A01 shape, A02 | C `Finding` | R finding shape | TB-3 | CONTRACT |
| D-15 | Preserve original values and provenance | A02 | E import | R raw values | TB-1 | CONTRACT |

## Reference fixture PG-SYN-001
| Req | Requirement | Owner | Path | Test | TB | Status |
|---|---|---|---|---|---|---|
| F-1 | Totals: 16000000 / 9500000 / 950000 / 8550000 / 4500000 due / 500000 discrepancy | A03 (literals), A02 | F, R | R golden (literal integers, no engine helpers) | TB-2 | PLANNED |
| F-2 | MISSING_REQUIRED_SIGNED_WAIVER citing both rejected candidates, clause, version, action | A02, A03 | E rules; F docs | R document cases | TB-2/3 | CONTRACT (ADR-0005) |
| F-3 | CLAIMED_DUE_MISMATCH +$5,000 with formula | A02 | E findings | R | TB-2 | CONTRACT |
| F-4 | Pending CO is context only, never an extra discrepancy | A02 | E findings | R | TB-2 | CONTRACT |
| F-5 | No legal-violation, customer-rejection, acceptance or lien-date claims | A02 wording, A04 | E findings | R text assertions; A04 | TB-3 | CONTRACT |

## Acceptance tests 1–10
| # | Area | Owner | Path | Test | TB | Status |
|---|---|---|---|---|---|---|
| 1 | Golden arithmetic + export round-trip | A03 | R, F | R golden + round-trip | TB-2/4 | PLANNED |
| 2 | Rounding ($0.05→$0.01 ×2 = $0.02; $0.04→$0.00; no -0) | A03, A02 | R, E | R rounding | TB-2 | PLANNED |
| 3 | Prior amounts ($500 posted → $44,500; unposted/void ignored; dup payment IDs fail; overpayment) | A03, A02 | R, E | R prior | TB-1/2 | PLANNED |
| 4 | Change orders (approved only; unknown status fails; missing line fails; 1¢ over cap; dup CO IDs) | A03, A02 | R, E | R change orders | TB-1/2 | PLANNED |
| 5 | Input validation (JSON≡CSV, headers, dates, UTF-8, enums, atomic, row/field errors, unknown columns rejected) | A03, A02 | R, F malformed | R input | TB-1 | PLANNED |
| 6 | Missing-document variants, rule absence ≠ compliant, evidence as data | A03, A02 | R, F | R documents (ADR-0005 table) | TB-2/3 | PLANNED |
| 7 | Reviewer journey, rerun-only resolution, traceable history, keyboard | FE, A02 review API | APP, E review | E review unit; FE E2E | TB-3/5 | PLANNED (UI not started) |
| 8 | Export injection, inert HTML, no file/URL reads, size/row/string limits, no real data, isolation | A02, A03, FE | E, R, APP | R injection/limits; FE render test | TB-1/3/4/5/7 | PLANNED |
| 9 | Determinism (row order, timezone, idempotent reimport, snapshot immutability) | A02, A03 | E canonical, R | R invariance (run with `TZ` varied) | TB-2 | PLANNED (static guard DONE) |
| 10 | Playwright, axe, reduced motion, mobile, CI evidence, live URL | FE, REL | APP, `.github/workflows/` | E2E | TB-5/6 | BLOCKED: Playwright/axe not approved; Actions gate unverified |

## Release and cross-cutting
| Req | Requirement | Owner | Path | Test | Status |
|---|---|---|---|---|---|
| X-1 | Pure engine tests before UI polish | CX sequencing | docs/architecture/IMPLEMENTATION-PLAN.md | — | DONE (plan) |
| X-2 | Rule versioning + audit events, no universal framework | A01 | ADR-0005, C | C rule tests | CONTRACT |
| X-3 | Engine purity / browser-runnable / zero deps | A01 | `tests/architecture/boundaries.test.js` | node --test | DONE |
| X-4 | Typecheck | A01 | jsconfig absent; tsc not approved | — | NOT VERIFIED (prerequisite: approve `typescript`) |
| X-5 | Backlog explicit (ledger, intake, deadlines, collections, packages) | CX | spec §Release | — | Recorded, not built |
