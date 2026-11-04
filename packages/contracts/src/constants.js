// PayGuard v1 contract constants. Owner: architecture (A01); changes require an ADR update
// accepted by Codex. Pure data only: no I/O, no clock, no platform APIs (browser + Node).

/** @param {any} value */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export const SCHEMA_VERSIONS = deepFreeze({
  PROJECT_BUNDLE: 'payguard.project.v1',
  APPLICATION_IMPORT: 'payguard.application.v1',
  ANALYSIS_RESULT: 'payguard.analysis.v1',
  REVIEW_EVENT: 'payguard.review-event.v1',
  REPORT: 'payguard.report.v2',
  REPORT_CSV: 'payguard.report-csv.v2',
  /** Read-only: accepted by parseReportJson and upgraded to v2 with an unverified origin. */
  LEGACY_REPORT_V1: 'payguard.report.v1',
});

/** Bumped by the engine owner whenever any calculation or finding output can change. */
export const ENGINE_CONTRACT_VERSION = '1.0.0';

/**
 * Input gate only: application imports must declare this value. It is a claim made by the file,
 * not proof of origin, and is never used to label a report (see APPLICATION_ORIGIN).
 */
export const DATA_CLASSIFICATION = 'SYNTHETIC';
/** Describes the bundled sample project and sample files shipped with the site. */
export const SYNTHETIC_LABEL =
  'SYNTHETIC DEMO DATA - fictional parties and illustrative contract conditions; not legal advice or a legal determination.';

/**
 * Where the analyzed application came from, as recorded by the app's own control path. Only the
 * built-in sample loader may record BUNDLED_SYNTHETIC_SAMPLE; every user-chosen file is
 * UNVERIFIED_LOCAL_FILE whatever its name or fields say. UNVERIFIED_LEGACY_REPORT is produced only
 * when parseReportJson upgrades a payguard.report.v1 text, whose synthetic flags were unconditional.
 */
export const APPLICATION_ORIGIN = deepFreeze({
  BUNDLED_SYNTHETIC_SAMPLE: 'BUNDLED_SYNTHETIC_SAMPLE',
  UNVERIFIED_LOCAL_FILE: 'UNVERIFIED_LOCAL_FILE',
  UNVERIFIED_LEGACY_REPORT: 'UNVERIFIED_LEGACY_REPORT',
});

export const APPLICATION_ORIGIN_LABEL = deepFreeze({
  BUNDLED_SYNTHETIC_SAMPLE: 'Bundled synthetic sample: the application was loaded by the built-in sample control from the fictional sample files shipped with this site.',
  UNVERIFIED_LOCAL_FILE: 'Unverified origin: the application was imported from a local file. Its name, fields and dataClassification value are claims made by the file and were not verified.',
  UNVERIFIED_LEGACY_REPORT: 'Unverified origin: read from a payguard.report.v1 export, whose synthetic label was applied to every report and does not show where the application came from.',
});

/** Present on every report and in the UI whatever the origin. */
export const REAL_DATA_WARNING =
  'PayGuard does not detect or prevent real data. Do not import real payment applications or personal, financial or confidential information.';

export const CURRENCY = 'USD';
export const MONEY_UNIT = 'USD_CENTS';

/**
 * Money ceiling per input amount: $1,000,000,000.00. Chosen so every intermediate value
 * (line gross <= 2e11 cents, x 10,000 bps <= 2e15; 5,000-row sums <= 1e15) stays inside
 * Number.MAX_SAFE_INTEGER (~9.007e15). The engine must still assert Number.isSafeInteger
 * after every arithmetic step (checked arithmetic).
 */
export const MONEY_LIMITS = deepFreeze({
  MAX_INPUT_AMOUNT_CENTS: 100_000_000_000,
  MAX_BASIS_POINTS: 10_000,
});

/**
 * Strict decimal grammar for imported money: no sign, exponent, separators, or > 2 decimals.
 * Upper bound is exactly MAX_INPUT_AMOUNT_CENTS: '1000000000', '.0' and '.00' are accepted;
 * '1000000000.01' and above are rejected (A02 correctness fix, see ADR-0003).
 */
export const DECIMAL_AMOUNT_PATTERN =
  '^(?:(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,2})?|1000000000(?:\\.00?)?)$';
/** Strict calendar date grammar; calendar validity (e.g. 2026-02-30) is checked separately. */
export const ISO_DATE_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
/** IDs: printable ASCII subset, case-sensitive, compared by code unit (never localeCompare). */
export const ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';

export const ROUNDING = deepFreeze({
  RETAINAGE: 'HALF_UP_PER_LINE_TO_CENT',
});

export const RETAINAGE_BASE = deepFreeze({
  COMPLETED_PLUS_STORED: 'COMPLETED_PLUS_STORED',
});

export const IMPORT_LIMITS = deepFreeze({
  MAX_UPLOAD_BYTES: 1_048_576,
  MAX_ROWS: 5_000,
  MAX_STRING_CHARS: 500,
  /** Documented exceptions to MAX_STRING_CHARS, each still bounded. */
  MAX_REVIEW_NOTE_CHARS: 2_000,
  MAX_ERRORS_REPORTED: 100,
});

export const CHANGE_ORDER_STATUS = deepFreeze({
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
});

export const PAYMENT_STATUS = deepFreeze({
  POSTED: 'POSTED',
  UNPOSTED: 'UNPOSTED',
  VOID: 'VOID',
});

export const DOCUMENT_TYPE = deepFreeze({
  CONDITIONAL_WAIVER: 'CONDITIONAL_WAIVER',
  UNCONDITIONAL_WAIVER: 'UNCONDITIONAL_WAIVER',
  OTHER: 'OTHER',
});

export const RULE_KIND = deepFreeze({
  /** The only configurable rule kind in v1. Not a universal regulatory engine. */
  REQUIRED_SIGNED_DOCUMENT: 'REQUIRED_SIGNED_DOCUMENT',
});

export const RULE_OUTCOME = deepFreeze({
  SATISFIED: 'SATISFIED',
  NOT_SATISFIED: 'NOT_SATISFIED',
  /** No requirement of that kind is configured. Never to be presented as "compliant". */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
});

export const CANDIDATE_REJECTION_REASON = deepFreeze({
  WRONG_PROJECT: 'WRONG_PROJECT',
  WRONG_DOCUMENT_TYPE: 'WRONG_DOCUMENT_TYPE',
  WRONG_PERIOD: 'WRONG_PERIOD',
  UNSIGNED: 'UNSIGNED',
});

/** Engine-owned calculation rule identities; every financial finding cites one. */
export const CALCULATION_RULES = deepFreeze({
  REVISED_CAP: { ruleId: 'PG-CALC-01', ruleVersion: 1 },
  RETAINAGE: { ruleId: 'PG-CALC-02', ruleVersion: 1 },
  AMOUNT_DUE: { ruleId: 'PG-CALC-03', ruleVersion: 1 },
  CLAIM_COMPARISON: { ruleId: 'PG-CALC-04', ruleVersion: 1 },
});

export const FINDING_SEVERITY = deepFreeze({
  BLOCKING: 'BLOCKING',
  WARNING: 'WARNING',
  INFO: 'INFO',
});

export const FINDING_CATEGORY = deepFreeze({
  FINANCIAL: 'FINANCIAL',
  DOCUMENTARY: 'DOCUMENTARY',
  CONTEXT: 'CONTEXT',
});

export const FINDING_CODES = deepFreeze({
  CLAIMED_DUE_MISMATCH: 'CLAIMED_DUE_MISMATCH',
  LINE_EARNED_EXCEEDS_REVISED_CAP: 'LINE_EARNED_EXCEEDS_REVISED_CAP',
  OVERPAYMENT_CREDIT: 'OVERPAYMENT_CREDIT',
  MISSING_REQUIRED_SIGNED_WAIVER: 'MISSING_REQUIRED_SIGNED_WAIVER',
  PENDING_CHANGE_ORDER_CONTEXT: 'PENDING_CHANGE_ORDER_CONTEXT',
  REQUIREMENT_NOT_CONFIGURED: 'REQUIREMENT_NOT_CONFIGURED',
});

/** Readiness never says "compliant", "approved" or "accepted". */
export const READINESS = deepFreeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_READY: 'NOT_READY',
  NO_BLOCKING_FINDINGS: 'NO_BLOCKING_FINDINGS',
});

export const VALIDATION_ERROR_CODES = deepFreeze({
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE',
  TOO_MANY_ROWS: 'TOO_MANY_ROWS',
  INVALID_UTF8: 'INVALID_UTF8',
  MALFORMED_JSON: 'MALFORMED_JSON',
  MALFORMED_CSV: 'MALFORMED_CSV',
  UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
  UNSUPPORTED_CLASSIFICATION: 'UNSUPPORTED_CLASSIFICATION',
  MISSING_FIELD: 'MISSING_FIELD',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  MISSING_COLUMN: 'MISSING_COLUMN',
  UNKNOWN_COLUMN: 'UNKNOWN_COLUMN',
  INCONSISTENT_HEADER_VALUE: 'INCONSISTENT_HEADER_VALUE',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_ID: 'INVALID_ID',
  DUPLICATE_ID: 'DUPLICATE_ID',
  UNKNOWN_REFERENCE: 'UNKNOWN_REFERENCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  AMOUNT_OUT_OF_RANGE: 'AMOUNT_OUT_OF_RANGE',
  INVALID_BASIS_POINTS: 'INVALID_BASIS_POINTS',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  INVALID_DATE: 'INVALID_DATE',
  PERIOD_END_BEFORE_START: 'PERIOD_END_BEFORE_START',
  INVALID_ENUM: 'INVALID_ENUM',
  STRING_TOO_LONG: 'STRING_TOO_LONG',
  ARITHMETIC_OVERFLOW: 'ARITHMETIC_OVERFLOW',
});

export const REVIEW_EVENT_TYPE = deepFreeze({
  ANALYSIS_RUN: 'ANALYSIS_RUN',
  NOTE: 'NOTE',
  DISPOSITION: 'DISPOSITION',
});

/** No "RESOLVED"/"DISMISSED": resolution is only derived from a rerun lacking the finding. */
export const REVIEW_DISPOSITION = deepFreeze({
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  CORRECTION_SUBMITTED: 'CORRECTION_SUBMITTED',
  NEEDS_FOLLOW_UP: 'NEEDS_FOLLOW_UP',
});

/** Exact CSV application-import header set (order-insensitive, case-sensitive). */
export const CSV_IMPORT_COLUMNS = deepFreeze([
  'schema_version',
  'data_classification',
  'application_id',
  'contract_id',
  'currency',
  'period_start',
  'period_end',
  'review_date',
  'claimed_current_due',
  'line_id',
  'completed_to_date',
  'stored_to_date',
]);

/** Exact CSV report-export column order; `record_type` selects which columns are populated. */
export const CSV_EXPORT_COLUMNS = deepFreeze([
  'record_type',
  'report_schema_version',
  'application_origin',
  'semantic_hash',
  'project_id',
  'contract_id',
  'application_id',
  'line_id',
  'finding_id',
  'finding_code',
  'severity',
  'rule_id',
  'rule_version',
  'metric',
  'amount_usd',
  'text',
]);

export const CSV_RECORD_TYPE = deepFreeze({
  META: 'META',
  TOTAL: 'TOTAL',
  LINE: 'LINE',
  FINDING: 'FINDING',
  REVIEW_EVENT: 'REVIEW_EVENT',
});

/** Text cells beginning with any of these are neutralised on CSV export. */
export const CSV_FORMULA_TRIGGER_PREFIXES = deepFreeze(['=', '+', '-', '@', '\t', '\r']);

/** Exact public surface of packages/payguard-engine/src/index.js (enforced by tests). */
export const ENGINE_PUBLIC_API = deepFreeze([
  'parseDecimalToCents',
  'formatCents',
  'computeImportBatchId',
  'parseApplicationJson',
  'parseApplicationCsv',
  'validateProjectBundle',
  'analyze',
  'computeSemanticHash',
  'appendReviewEvent',
  'buildReport',
  'serializeReportJson',
  'parseReportJson',
  'serializeReportCsv',
]);
