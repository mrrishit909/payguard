# ADR-0006: Report export schema (JSON + spreadsheet-safe CSV)

Status: ACCEPTED for foundation (pending Codex review). Date: 2026-11-03.

## Application origin (added in v2, 2026-11-04)
A file's own `dataClassification: "SYNTHETIC"` (or its name) is a claim the file makes about itself; it cannot prove where the data came from. v1 nevertheless stamped `dataClassification: "SYNTHETIC"` and `syntheticLabel` on every report. v2 replaces those fields with a recorded origin:
- `applicationOrigin` is one of `APPLICATION_ORIGIN`:
  - `BUNDLED_SYNTHETIC_SAMPLE`: recorded only by `workflow.importSample(format)`. That method reads a file name fixed when the workflow was created, through the injected bundled-sample loader (a same-origin `fetch` of `fixtures/payguard/`). The app's two sample buttons and the landing proof use it.
  - `UNVERIFIED_LOCAL_FILE`: every `workflow.importFile` call, i.e. any file the user picks, whatever its name, bytes or `dataClassification` say. This is also the `buildReport` default when the caller passes nothing.
  - `UNVERIFIED_LEGACY_REPORT`: produced only when `parseReportJson` reads a v1 text. `buildReport` refuses it.
- A claim correction (rerun) keeps the origin of the application it corrects.
- `originLabel` = `APPLICATION_ORIGIN_LABEL[applicationOrigin]` and `originWarning` = `REAL_DATA_WARNING` ("PayGuard does not detect or prevent real data…") are on every report.
- The engine never reads the application's `dataClassification` to choose the origin. The import check that the field equals `SYNTHETIC` remains (ADR-0004), but only as an input gate. The raw value still appears in `provenance` as a record of what the file said.
- The origin is not part of `semanticHash`. The same bytes give the same calculation whichever path loaded them.
- Origin is what the exporting app recorded. A report text is a file too, so a parsed `BUNDLED_SYNTHETIC_SAMPLE` is not proof (see Boundary).

## JSON (`payguard.report.v2`, typedef `Report`)
- Canonical serialization uses sorted object keys, ID-sorted arrays, 2-space indent, LF line endings and a trailing newline. `parseReportJson(serializeReportJson(r))` must deep-equal `r` (spec test 1 round-trip: totals, IDs, rule versions, origin fields).
- Always present: `applicationOrigin`, `originLabel`, `originWarning`, `moneyUnit: "USD_CENTS"`, `engineContractVersion`, `semanticHash`, `ruleVersions`, `limitations[]`. `dataClassification` and `syntheticLabel` are not v2 fields and are rejected.
- Money uses integer cents in `...Cents` fields, and every total is cumulative or current as named in `ReconciliationTotals`.
- `parseReportJson` is strict: unknown keys, wrong schema version, non-integer cents, and an unknown origin or an origin label or warning that doesn't match all fail.
- **Legacy v1 reading:** `payguard.report.v1` text is still accepted and validated against the v1 schema, which requires its fixed `dataClassification`/`syntheticLabel` and the v1 `limitations`. It is returned **upgraded to v2**: `applicationOrigin: "UNVERIFIED_LEGACY_REPORT"`, the two v1 flags dropped, and the v2 `limitations`. All figures, IDs, findings, history and `semanticHash` are kept. v1 flags were unconditional, so they are never treated as evidence of origin. Re-exporting an upgraded report writes v2 JSON/CSV that still says `UNVERIFIED_LEGACY_REPORT`.
- Report text is untrusted. `parseReportJson` never throws. Before freezing anything, it validates every nested structure using own-property key sets on plain objects: `ids` (ID grammar), `period` (calendar dates), `readiness` (`NOT_READY`/`NO_BLOCKING_FINDINGS` only), lines, rule versions and evaluations, findings (enums, FieldRefs, scalar observed/expected, deterministic `findingId`), finding statuses, review events (replayed through `appendReviewEvent`), provenance (complete, from one batch, raw values re-parse to the reported values) and the exact `limitations` for the schema version. Arrays and strings are bounded.
- It checks arithmetic that the report itself determines: line and total PG-CALC identities, line sums, the over-cap/overpayment/claim-mismatch findings implied by the totals, and readiness against BLOCKING findings. Retainage is range-checked only, because the basis points live in the project bundle.
- **Boundary:** a parsed report is an *unverified import*. It is not an authoritative or independently verified calculation. `semanticHash` is an unkeyed fingerprint of the semantic input, not a signature, and it proves nothing about who produced the report. Recomputing requires the original bundle and application through `analyze`.

## CSV (`payguard.report-csv.v2`)
- Columns are exactly `CSV_EXPORT_COLUMNS` in that order. v2 replaces v1's `data_classification` column with `application_origin`, filled on every row. The META rows carry `originLabel` and `originWarning` instead of `syntheticLabel`. Nothing reads CSV reports back, so there is no CSV v1 reader. Rows use `record_type` ∈ META, TOTAL, LINE, FINDING, REVIEW_EVENT and are emitted in that group order, sorted inside each group by ID.
- Encoding is UTF-8 without BOM and CRLF row endings. Every cell is quoted, and `"` is doubled inside quotes. Newlines inside cells are preserved within quotes. Unicode round-trips.
- **Typed numeric cells** (`amount_usd`, `rule_version`) are generated by the engine from integers and must match `^-?\d+\.\d{2}$` / `^\d+$`. They are emitted verbatim so spreadsheets read them as numbers. A negative due like `-5000.00` stays numeric by design.
- **Text cells** (all others) starting with any `CSV_FORMULA_TRIGGER_PREFIXES` character (`= + - @ \t \r`) are prefixed with a single quote `'`. Quoting alone doesn't stop formula evaluation, but the prefix does. The prefix is a documented, one-way transformation for CSV only. JSON keeps the original text.
- TOTAL rows: `metric` = the `ReconciliationTotals` key minus `Cents` (e.g. `calculatedCurrentDue`), plus `amount_usd`.

## Safety
- Notes and evidence titles are never HTML in any export, and the UI renders them as text nodes (spec test 8).
- The export is produced in memory and downloaded by the app (Blob). No server round-trip, and no paths or URLs are read.
