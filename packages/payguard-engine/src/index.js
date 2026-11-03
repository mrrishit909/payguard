// PayGuard pure engine — public boundary. Exported names must equal ENGINE_PUBLIC_API in
// packages/contracts (enforced by tests/architecture).
//
// Engine rules (ADR-0002): pure functions; no I/O, network, storage, DOM, clock, randomness,
// locale, timezone or node:* imports; deterministic for identical canonical input; never
// throws for invalid user input (returns Result failures); no financial totals on failure.
// Only computeImportBatchId and computeSemanticHash are async (WebCrypto SHA-256).

import { ENGINE_CONTRACT_VERSION } from '../../contracts/src/constants.js';
import { parseCents, formatCentsText } from './money.js';
import { canonicalJson, sha256Hex } from './canonical.js';
import { importJson, importCsv } from './import.js';
import { validateBundle } from './validate.js';
import { analyzeInput } from './analyze.js';
import { appendEvent, buildReportSnapshot, serializeJson, parseJson, serializeCsv } from './report.js';

/** @typedef {import('../../contracts/src/types.js').Cents} Cents */
/** @typedef {import('../../contracts/src/types.js').ProjectBundle} ProjectBundle */
/** @typedef {import('../../contracts/src/types.js').ImportedApplication} ImportedApplication */
/** @typedef {import('../../contracts/src/types.js').AnalysisInput} AnalysisInput */
/** @typedef {import('../../contracts/src/types.js').Analysis} Analysis */
/** @typedef {import('../../contracts/src/types.js').ReviewEvent} ReviewEvent */
/** @typedef {import('../../contracts/src/types.js').Report} Report */
/**
 * @template T
 * @typedef {import('../../contracts/src/types.js').Result<T>} Result
 */

/**
 * Strict decimal string -> integer cents (DECIMAL_AMOUNT_PATTERN, <= MAX_INPUT_AMOUNT_CENTS).
 * @param {string} text
 * @returns {Result<Cents>}
 */
export function parseDecimalToCents(text) {
  const r = parseCents(text);
  return r.ok ? r : { ok: false, errors: [{ code: r.code, message: 'Amount must be a non-negative decimal of at most 1000000000.00 with up to two places.' }] };
}

/**
 * Integer cents -> '-1234.56' style decimal string; never '-0.00'. Throws TypeError for
 * non-safe-integer input (programmer error, not user input).
 * @param {Cents} cents
 * @returns {string}
 */
export function formatCents(cents) { return formatCentsText(cents); }

/**
 * 'IB-' + first 16 hex chars of SHA-256(bytes). Same bytes => same batch id (idempotent reimport).
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function computeImportBatchId(bytes) { return `IB-${(await sha256Hex(bytes)).slice(0, 16)}`; }

/**
 * Size check BEFORE decoding; fatal UTF-8 decode; strict schema; atomic.
 * @param {Uint8Array} bytes
 * @param {{ importBatchId: string, sourceName: string }} meta
 * @returns {Result<ImportedApplication>}
 */
export function parseApplicationJson(bytes, meta) { return importJson(bytes, meta); }

/**
 * RFC 4180 subset; exact CSV_IMPORT_COLUMNS header; same canonical output as JSON.
 * @param {Uint8Array} bytes
 * @param {{ importBatchId: string, sourceName: string }} meta
 * @returns {Result<ImportedApplication>}
 */
export function parseApplicationCsv(bytes, meta) { return importCsv(bytes, meta); }

/**
 * Validates a seeded/canonical project bundle (unique IDs, references, enums, ranges).
 * @param {unknown} bundle
 * @returns {Result<ProjectBundle>}
 */
export function validateProjectBundle(bundle) { return validateBundle(bundle); }

/**
 * Cross-validates bundle + application, reconciles, evaluates configured rules, emits findings.
 * Must not mutate its arguments; result.canonicalInput is a deep-frozen clone.
 * @param {AnalysisInput} input
 * @returns {Result<Analysis>}
 */
export function analyze(input) { return analyzeInput(input); }

/**
 * Hex SHA-256 over canonical JSON (sorted keys, ID-sorted arrays) of the semantic content:
 * canonical bundle + application + ruleVersions + engineContractVersion. Excludes
 * timestamps, importBatchId, sourceName, sourceFormat and provenance locations.
 * @param {Analysis} analysis
 * @returns {Promise<string>}
 */
export async function computeSemanticHash(analysis) {
  const content = {
    bundle: analysis.canonicalInput.bundle,
    application: analysis.canonicalInput.imported.application,
    ruleVersions: analysis.ruleVersions,
    engineContractVersion: ENGINE_CONTRACT_VERSION,
  };
  return sha256Hex(new TextEncoder().encode(canonicalJson(content)));
}

/**
 * Append-only: returns a NEW frozen array; validates sequence, references and note bounds.
 * Optional `options.findingIds` (finding ids of the referenced analysis) enables the
 * unknown-findingId check from ADR-0005; NOTE/DISPOSITION must cite a recorded ANALYSIS_RUN hash.
 * @param {readonly ReviewEvent[]} history
 * @param {ReviewEvent} event
 * @param {{ findingIds?: Iterable<string> }} [options]
 * @returns {Result<readonly ReviewEvent[]>}
 */
export function appendReviewEvent(history, event, options) { return appendEvent(history, event, options); }

/**
 * Builds an immutable report snapshot. `generatedAt` is supplied by the caller (no clock).
 * Earlier analyses let the report derive FindingStatus (resolution only via rerun).
 * @param {{ analysis: Analysis, semanticHash: string, priorAnalyses: { analysis: Analysis, semanticHash: string }[], reviewEvents: readonly ReviewEvent[], generatedAt: string }} args
 * @returns {Report}
 */
export function buildReport(args) { return buildReportSnapshot(args); }

/** @param {Report} report @returns {string} Canonical JSON (sorted keys, LF, trailing newline). */
export function serializeReportJson(report) { return serializeJson(report); }

/**
 * Strict inverse of serializeReportJson for UNTRUSTED text. Success means the report is schema-valid
 * and internally consistent; it is an unverified import, not proof of authenticity: semanticHash is an
 * unkeyed input fingerprint, not a signature, and figures are not recomputed from source inputs.
 * @param {string} text @returns {Result<Report>}
 */
export function parseReportJson(text) { return parseJson(text); }

/** @param {Report} report @returns {string} CSV_EXPORT_COLUMNS, CRLF, formula-safe text cells. */
export function serializeReportCsv(report) { return serializeCsv(report); }
