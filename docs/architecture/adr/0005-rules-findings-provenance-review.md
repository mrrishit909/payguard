# ADR-0005: Rule versions, findings, provenance and review events

Status: ACCEPTED for foundation (pending Codex review). Date: 2026-11-03.

## Rule versioning without a universal engine
- **Calculation rules** (`CALCULATION_RULES`, PG-CALC-01..04 v1) are code. Each financial finding cites its `ruleId@ruleVersion`. Any change to their output requires bumping the version and `ENGINE_CONTRACT_VERSION`.
- **Configured rules** are data in the project bundle. v1 supports exactly one kind, `REQUIRED_SIGNED_DOCUMENT`, with fixed matching semantics. It is not a DSL, has no expressions and no jurisdictions. `illustrative: true` is mandatory, and `sourceClause` (e.g. "Demo Exhibit B §3") is shown verbatim as fictional contract configuration, **not law**.
- `(ruleId, ruleVersion)` is immutable. Duplicate pairs fail validation, and reports list every rule version applied.

## REQUIRED_SIGNED_DOCUMENT matching (PG-REQ-01 v1 semantics)
A document satisfies the rule only if **all** of the following hold: `projectId` = bundle project, `documentType` = rule type, `periodStart`/`periodEnd` exactly equal the application period, and `signed === true`. Each non-matching document *of the same type or same project* is reported as a `RejectedCandidate` with every applicable reason (`WRONG_PROJECT`, `WRONG_DOCUMENT_TYPE`, `WRONG_PERIOD`, `UNSIGNED`; sorted) and a plain explanation.

| Evidence case (spec test 6) | RuleEvaluation.outcome | Finding |
|---|---|---|
| Correct project+period, signed | SATISFIED | none |
| Correct period, unsigned | NOT_SATISFIED (UNSIGNED) | MISSING_REQUIRED_SIGNED_WAIVER |
| Signed, wrong period | NOT_SATISFIED (WRONG_PERIOD) | same, candidate cited |
| Wrong project | NOT_SATISFIED (WRONG_PROJECT) | same, candidate cited |
| No documents | NOT_SATISFIED (no candidates) | same |
| Duplicate document IDs | — validation failure, no analysis | — |
| No such rule configured | NOT_CONFIGURED | REQUIREMENT_NOT_CONFIGURED (INFO). Never "compliant". |

Document findings and financial findings are computed independently. Satisfying the document rule cannot remove `CLAIMED_DUE_MISMATCH`.

## Finding contract (`Finding` typedef)
Stable `code`, `severity` (BLOCKING/WARNING/INFO), `category`, `ruleId`/`ruleVersion`, `subject` and sorted `inputRefs` (FieldRefs into provenance), `observed`/`expected` (cents or strings), optional `formula`, `rationale`, `remediation`, optional `source {clause, illustrative:true}` and `rejectedCandidates`. Wording rules: no legal-violation language, no claim of customer rejection, no automatic acceptance, no invented dates. Expected PG-SYN-001 remediation text: "Attach signed October conditional waiver and request review."

`readiness` is `NOT_READY` if any BLOCKING finding exists, otherwise `NO_BLOCKING_FINDINGS`. There is deliberately no "ready/approved/compliant" state.

## Provenance
Each canonical field originating from upload or seed has a `ProvenanceEntry` with its raw string value exactly as received and its location. Findings reference fields by `FieldRef`, so the UI can show "observed 50000.00 from row 1, column claimed_current_due".

## Review events (append-only audit trail)
- Types: `ANALYSIS_RUN` (records each run's semantic hash), `NOTE`, and `DISPOSITION` (ACKNOWLEDGED / CORRECTION_SUBMITTED / NEEDS_FOLLOW_UP).
- **No resolve or dismiss action exists.** `FindingStatus` is *derived*: a finding is `NOT_PRESENT_IN_LATEST_RUN` only when a later `ANALYSIS_RUN` over changed input no longer produces that `findingId`. Original findings remain in prior analyses and history (spec test 7).
- `appendReviewEvent` returns a new frozen array. It rejects non-increasing `sequence`, unknown `findingId` for the referenced analysis, and notes over 2,000 chars. Notes are inert text.
- `occurredAt` is caller-supplied and excluded from semantic hashes. It must match `YYYY-MM-DDThh:mm:ss[.s{1,3}]Z` and be calendar- and clock-valid: real dates including leap days, hours 00–23, minutes and seconds 00–59, no leap seconds and no offsets. Explicit fractional seconds are kept verbatim. `generatedAt` follows the same rule.
- `findingIds` context remains optional in v1. When it is omitted, NOTE/DISPOSITION findingIds are not checked against the analysis. Whether the UI must supply it is an open orchestrator decision.
