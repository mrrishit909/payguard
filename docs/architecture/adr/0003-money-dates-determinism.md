# ADR-0003: Money, rounding, dates and determinism

Status: ACCEPTED for foundation (pending Codex review). Date: 2026-11-03.

## Money
- Internal representation: JS `number` holding a **safe integer of USD cents**. BigInt was rejected because it isn't JSON-serializable and doesn't mix with numbers, which would make the UI error-prone. The `MONEY_LIMITS` ceiling makes number-based cents provably safe.
- Input ceiling `MAX_INPUT_AMOUNT_CENTS = 100,000,000,000` ($1,000,000,000.00). Worst cases: line gross 2e11 × 10,000 bps = 2e15, and 5,000-line sums of at most about 1e15. Both are below 2^53 ≈ 9.007e15 (checked in `contracts.test.js`). The engine still asserts `Number.isSafeInteger` after every operation and fails with `ARITHMETIC_OVERFLOW`.
- Parsing: only strings matching `DECIMAL_AMOUNT_PATTERN` (`0` or 1–9 integer digits without a leading zero, optional `.d`/`.dd`). Cents come from digit arithmetic on the string, never from `Number(text) * 100`. The grammar rejects sign, exponent, NaN/Infinity, separators (`45,000.00`), whitespace, more than 2 decimals and non-ASCII digits. JSON numbers for money are rejected.
- Negative inputs are unsupported in v1, so every imported amount is ≥ 0. Computed values (`calculatedCurrentDueCents`, `claimDiscrepancyCents`) may be negative and are never floored.
- No negative zero: results are normalized with `x === 0 ? 0 : x`, and `formatCents(0)` returns `'0.00'`.
- External form: JSON exports integer cents in `...Cents` fields with report-level `moneyUnit: "USD_CENTS"`. CSV exports `amount_usd` as a decimal string (`-?\d+\.\d{2}`).

## Retainage rounding (PG-CALC-02 v1)
For each line: `gross = completedToDate + storedToDate`, then `retainage = floor((gross × bps + 5000) / 10000)`, which is half-up to the cent for gross ≥ 0. Total retainage is the **sum of rounded line retainage**. One rate (`basisPoints`) applies to completed + stored (`RETAINAGE_BASE.COMPLETED_PLUS_STORED`). Split rates are backlog. Examples in cents: 5¢ × 1000 + 5000 = 10000, ÷ 10000 = **1¢**. Two such lines total 2¢. Then 4¢ × 1000 + 5000 = 9000, ÷ 10000 = **0¢**. Integer division is `Math.floor` on a non-negative safe integer, which is exact.

## Reconciliation (PG-CALC-01/03/04 v1)
- Revised cap per line = original + Σ APPROVED change orders for that line. PENDING and REJECTED only feed `pendingChangeOrdersCents` context. Unknown status fails validation.
- `overCapCents = max(0, gross − cap)`. Gross is never clipped. Anything above zero produces `LINE_EARNED_EXCEEDS_REVISED_CAP`.
- Net = gross − retainage. Due = net − Σ POSTED prior payments. Prior certifications are informational only and never subtracted.
- Due < 0 produces `OVERPAYMENT_CREDIT` (BLOCKING).
- Discrepancy = claimed − calculated. Tolerance is exactly 0, so any non-zero discrepancy produces `CLAIMED_DUE_MISMATCH`.
- Pending CO context is emitted as `PENDING_CHANGE_ORDER_CONTEXT` (INFO, category CONTEXT). It has no amount discrepancy field, so it can't be double-counted.

## Dates
`YYYY-MM-DD` strings only, calendar-validated with pure integer arithmetic (including leap years) and compared lexicographically. No `Date` object, so there is no timezone dependence. `periodEnd < periodStart` fails with `PERIOD_END_BEFORE_START`. `reviewDate` is explicit input.

## Determinism
- Canonicalization sorts every array by its primary ID (code units) and sorts object keys before hashing or serializing. Row order and key order therefore cannot change results.
- `semanticHash` = SHA-256 over canonical JSON of {bundle, application, ruleVersions, engineContractVersion}. It excludes `generatedAt`, `occurredAt`, `importBatchId`, `sourceName`, `sourceFormat` and provenance locations. JSON and CSV imports of the same application therefore hash identically.
- `importBatchId` = `IB-` + 16 hex characters of SHA-256(raw bytes). Re-importing the same bytes gives the same batch ID, so re-import is idempotent.
- Findings get a deterministic `findingId` (see `types.js`), letting review history follow a finding across reruns.
