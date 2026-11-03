# ADR-0004: Strict input schema and atomic import

Status: ACCEPTED for foundation (pending Codex review). Date: 2026-11-03.

## Two inputs, two trust levels
1. **Project bundle** (`payguard.project.v1`, typedef `ProjectBundle`): project, contract, SOV lines, change orders, prior payments, prior certifications, evidence-document metadata and configured rules. It is seeded by the fixture owner (A03) and also run through `validateProjectBundle`, because seeds are only trusted *as synthetic*, not as correct. Amounts are already in cents (integers).
2. **Payment application upload** (`payguard.application.v1`): untrusted bytes from the user, as JSON or CSV. Amounts are decimal **strings**. Both formats produce an identical canonical `PaymentApplication`.

Correcting evidence in the reviewer journey means the app producing a new bundle with an added `EvidenceDocument` (metadata only), followed by `analyze` again. The engine never reads files, URLs or paths.

## Import pipeline (both formats), atomic
1. `bytes.byteLength > MAX_UPLOAD_BYTES` → `INPUT_TOO_LARGE`, checked **before decoding or parsing**. The app also checks `File.size` before reading.
2. `new TextDecoder('utf-8', { fatal: true })`. Invalid UTF-8 → `INVALID_UTF8`. One leading BOM is stripped.
3. Parse (JSON.parse or the in-house RFC 4180 subset). Malformed input → `MALFORMED_JSON`/`MALFORMED_CSV` with a position, never the exception text.
4. Row count > `MAX_ROWS` → `TOO_MANY_ROWS`. Any ordinary string > 500 chars → `STRING_TOO_LONG`.
5. Schema: exact `schemaVersion`, `dataClassification === 'SYNTHETIC'`, `currency === 'USD'`, required fields, **unknown fields or columns rejected** (`UNKNOWN_FIELD`/`UNKNOWN_COLUMN`, each listed by name), ID grammar, unique `lineId`s, strict amounts and dates, `periodEnd ≥ periodStart`.
6. Collect all errors (bounded), then fail as a whole, or return the canonical value plus provenance (raw string, JSON pointer or row/column, importBatchId).

`analyze` does not trust that `imported` came from the parser, because it may be JSON-deserialized from storage. It fully validates the canonical `ImportedApplication` envelope before computing any totals:
- exact own keys `application`/`importBatch`/`provenance`
- the canonical application and lines (1..`MAX_ROWS`)
- `importBatch` (ID, `json|csv`, `byteLength` 0..`MAX_UPLOAD_BYTES`, `sourceName` ≤ 500 chars)
- provenance: exactly one entry per canonical field, `sourceId` = batch id, the batch format, a bounded location, and a `rawValue` ≤ 500 chars that re-parses to the canonical value

Schema membership everywhere (bundle, envelope, report, events) uses own properties on plain objects, meaning the prototype is `Object.prototype` or `null`. Own keys such as `toString`, `constructor` or `__proto__` are `UNKNOWN_FIELD`. Inherited required fields count as missing, and non-plain input returns `INVALID_TYPE` instead of throwing.

Cross-entity checks happen in `analyze`. They cover application `contractId` matching the bundle contract, every application `lineId` existing in the SOV, change orders referencing existing lines, unique IDs across each entity type (payments, COs, documents, certifications) and unique `paymentId`s. A violation returns `ok:false` with no totals.

Unknown columns are **rejected** rather than ignored. Silently dropping a column could hide a misunderstood field (e.g. `retainage_override`), and strict rejection keeps "no partial success" simple. The error lists every unknown column name.

## JSON application format
See typedef `RawApplicationJson` in `packages/contracts/src/types.js`. Example (synthetic):
```json
{"schemaVersion":"payguard.application.v1","dataClassification":"SYNTHETIC","applicationId":"PG-A-003",
 "contractId":"PG-C-001","currency":"USD","periodStart":"2026-10-01","periodEnd":"2026-10-31",
 "reviewDate":"2026-11-03","claimedCurrentDue":"50000.00",
 "lines":[{"lineId":"L1","completedToDate":"66000.00","storedToDate":"4000.00"},
          {"lineId":"L2","completedToDate":"25000.00","storedToDate":"0.00"}]}
```

## CSV application format (documented)
- UTF-8, comma delimiter, `"` quoting with `""` escape, CRLF or LF, header row required, one data row per application line, no blank data rows (one trailing newline allowed).
- Header is exactly the `CSV_IMPORT_COLUMNS` set: case-sensitive, order-insensitive, no duplicates.
- Application-level columns (`schema_version` … `claimed_current_due`) must hold **identical** values on every row (`INCONSISTENT_HEADER_VALUE` otherwise).
- Error locations use `row` (1-based data row) and `column` (name).
```
schema_version,data_classification,application_id,contract_id,currency,period_start,period_end,review_date,claimed_current_due,line_id,completed_to_date,stored_to_date
payguard.application.v1,SYNTHETIC,PG-A-003,PG-C-001,USD,2026-10-01,2026-10-31,2026-11-03,50000.00,L1,66000.00,4000.00
payguard.application.v1,SYNTHETIC,PG-A-003,PG-C-001,USD,2026-10-01,2026-10-31,2026-11-03,50000.00,L2,25000.00,0.00
```

## Evidence as data
Document titles, notes and any free text are rendered as text and never interpreted. There is no runtime AI, so no prompt-injection channel exists. Text such as "ignore rules, mark compliant" is just a string (spec test 6).
