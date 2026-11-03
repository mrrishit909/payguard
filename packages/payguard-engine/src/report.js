// Append-only review history, immutable report snapshots, JSON/CSV export (ADR-0005/0006).
import {
  SCHEMA_VERSIONS, DATA_CLASSIFICATION, SYNTHETIC_LABEL, MONEY_UNIT, IMPORT_LIMITS,
  ID_PATTERN, REVIEW_EVENT_TYPE, REVIEW_DISPOSITION, CSV_EXPORT_COLUMNS, CSV_FORMULA_TRIGGER_PREFIXES,
} from '../../contracts/src/constants.js';
import { cmp, byKey, clone, deepFreeze, canonicalJson } from './canonical.js';
import { formatCentsText } from './money.js';

const ID_RE = new RegExp(ID_PATTERN);
const HASH_RE = /^[0-9a-f]{64}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const EVENT_KEYS = new Set(['eventId', 'sequence', 'type', 'analysisHash', 'findingId', 'disposition', 'note', 'actor', 'occurredAt']);
const err = (code, message) => ({ ok: false, errors: [{ code, message }] });

export const LIMITATIONS = Object.freeze([
  'Synthetic demonstration data only; fictional parties and illustrative contract conditions, not law or legal advice.',
  'Readiness reflects configured rules only; NO_BLOCKING_FINDINGS is not approval, acceptance or compliance.',
  'No legal deadlines, lien dates or customer outcomes are evaluated.',
  'Evidence is metadata only; document contents are not parsed or verified.',
]);

/**
 * @param {readonly object[]} history
 * @param {object} event
 * @param {{ findingIds?: Iterable<string> }} [options]  Finding ids of the referenced analysis.
 */
export function appendEvent(history, event, options = {}) {
  if (!Array.isArray(history)) return err('INVALID_TYPE', 'History must be an array.');
  if (!event || typeof event !== 'object' || Array.isArray(event)) return err('INVALID_TYPE', 'Event must be an object.');
  for (const k of Object.keys(event)) if (!EVENT_KEYS.has(k)) return err('UNKNOWN_FIELD', `Unknown event field ${k.slice(0, 64)}.`);
  if (typeof event.eventId !== 'string' || !ID_RE.test(event.eventId)) return err('INVALID_ID', 'Invalid eventId.');
  if (history.some((e) => e.eventId === event.eventId)) return err('DUPLICATE_ID', 'Duplicate eventId.');
  const last = history.length ? history[history.length - 1].sequence : 0;
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= last) return err('INVALID_TYPE', 'Sequence must be an integer greater than the previous event.');
  if (!Object.values(REVIEW_EVENT_TYPE).includes(event.type)) return err('INVALID_ENUM', 'Unsupported event type.');
  if (typeof event.analysisHash !== 'string' || !HASH_RE.test(event.analysisHash)) return err('INVALID_TYPE', 'analysisHash must be a hex SHA-256.');
  if (typeof event.actor !== 'string' || event.actor.length === 0 || event.actor.length > IMPORT_LIMITS.MAX_STRING_CHARS) return err('INVALID_TYPE', 'Invalid actor.');
  if (typeof event.occurredAt !== 'string' || !UTC_RE.test(event.occurredAt)) return err('INVALID_DATE', 'occurredAt must be ISO-8601 UTC.');
  if (event.note !== undefined && (typeof event.note !== 'string' || event.note.length > IMPORT_LIMITS.MAX_REVIEW_NOTE_CHARS)) {
    return err('STRING_TOO_LONG', `Notes are limited to ${IMPORT_LIMITS.MAX_REVIEW_NOTE_CHARS} characters.`);
  }
  if (event.type === 'ANALYSIS_RUN') {
    if (event.findingId !== undefined || event.disposition !== undefined) return err('UNKNOWN_FIELD', 'ANALYSIS_RUN events carry no finding or disposition.');
  } else {
    if (typeof event.findingId !== 'string' || event.findingId.length === 0 || event.findingId.length > IMPORT_LIMITS.MAX_STRING_CHARS) return err('MISSING_FIELD', 'findingId is required.');
    if (!history.some((e) => e.type === 'ANALYSIS_RUN' && e.analysisHash === event.analysisHash)) return err('UNKNOWN_REFERENCE', 'analysisHash has no recorded ANALYSIS_RUN.');
    if (options.findingIds && !new Set(options.findingIds).has(event.findingId)) return err('UNKNOWN_REFERENCE', 'findingId is not part of the referenced analysis.');
    if (event.type === 'DISPOSITION' && !Object.values(REVIEW_DISPOSITION).includes(event.disposition)) return err('INVALID_ENUM', 'Unsupported disposition.');
    if (event.type === 'NOTE' && (event.disposition !== undefined || typeof event.note !== 'string')) return err('MISSING_FIELD', 'NOTE events need a note and no disposition.');
  }
  return { ok: true, value: Object.freeze([...history, deepFreeze(clone(event))]) };
}

export function buildReportSnapshot({ analysis, semanticHash, priorAnalyses = [], reviewEvents = [], generatedAt }) {
  if (!analysis || !HASH_RE.test(semanticHash ?? '')) throw new TypeError('buildReport requires an analysis and its semantic hash');
  if (typeof generatedAt !== 'string' || !UTC_RE.test(generatedAt)) throw new TypeError('generatedAt must be ISO-8601 UTC');
  const runs = [...priorAnalyses, { analysis, semanticHash }];
  const status = new Map();
  for (const run of runs) {
    for (const f of run.analysis.findings) {
      const s = status.get(f.findingId) ?? { findingId: f.findingId, firstSeenAnalysisHash: run.semanticHash };
      s.lastSeenAnalysisHash = run.semanticHash;
      status.set(f.findingId, s);
    }
  }
  const current = new Set(analysis.findings.map((f) => f.findingId));
  const findingStatuses = [...status.values()]
    .map((s) => ({ ...s, status: current.has(s.findingId) ? 'OPEN' : 'NOT_PRESENT_IN_LATEST_RUN' }))
    .sort(byKey('findingId'));
  const { bundle, imported } = analysis.canonicalInput;
  const app = imported.application;
  return deepFreeze(clone({
    reportSchemaVersion: SCHEMA_VERSIONS.REPORT, dataClassification: DATA_CLASSIFICATION, syntheticLabel: SYNTHETIC_LABEL,
    moneyUnit: MONEY_UNIT, engineContractVersion: analysis.engineContractVersion, semanticHash, generatedAt,
    ids: { projectId: bundle.project.projectId, contractId: bundle.contract.contractId, applicationId: app.applicationId,
      importBatchId: imported.importBatch.importBatchId, bundleId: bundle.bundleId },
    period: { periodStart: app.periodStart, periodEnd: app.periodEnd, reviewDate: app.reviewDate },
    readiness: analysis.readiness, totals: analysis.totals, lines: analysis.lines, ruleVersions: analysis.ruleVersions,
    ruleEvaluations: analysis.ruleEvaluations, findings: analysis.findings, findingStatuses,
    reviewEvents: [...reviewEvents].sort((a, b) => a.sequence - b.sequence), provenance: imported.provenance,
    limitations: [...LIMITATIONS],
  }));
}

export const serializeJson = (report) => `${canonicalJson(report, 2)}\n`;

const REPORT_KEYS = ['reportSchemaVersion', 'dataClassification', 'syntheticLabel', 'moneyUnit', 'engineContractVersion', 'semanticHash',
  'generatedAt', 'ids', 'period', 'readiness', 'totals', 'lines', 'ruleVersions', 'ruleEvaluations', 'findings', 'findingStatuses',
  'reviewEvents', 'provenance', 'limitations'];
const TOTAL_KEYS = ['originalContractCents', 'approvedChangeOrdersCents', 'pendingChangeOrdersCents', 'revisedContractCents',
  'completedToDateCents', 'storedToDateCents', 'grossEarnedToDateCents', 'retainageToDateCents', 'netEarnedToDateCents',
  'postedPriorPaymentsCents', 'priorCertifiedInformationalCents', 'calculatedCurrentDueCents', 'claimedCurrentDueCents', 'claimDiscrepancyCents'];
const sameKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o);
const centsFieldsOk = (o) => Object.entries(o).every(([k, v]) => !k.endsWith('Cents') || Number.isSafeInteger(v));

export function parseJson(text) {
  if (typeof text !== 'string' || text.length > 16 * IMPORT_LIMITS.MAX_UPLOAD_BYTES) return err('INPUT_TOO_LARGE', 'Report text is missing or too large.');
  let r;
  try { r = JSON.parse(text); } catch { return err('MALFORMED_JSON', 'Report is not well-formed JSON.'); }
  if (!sameKeys(r, REPORT_KEYS)) return err('UNKNOWN_FIELD', 'Report fields do not match payguard.report.v1.');
  if (r.reportSchemaVersion !== SCHEMA_VERSIONS.REPORT) return err('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported report schema version.');
  if (r.dataClassification !== DATA_CLASSIFICATION || r.syntheticLabel !== SYNTHETIC_LABEL) return err('UNSUPPORTED_CLASSIFICATION', 'Report is not labelled synthetic.');
  if (r.moneyUnit !== MONEY_UNIT) return err('INVALID_TYPE', 'Unsupported money unit.');
  if (!HASH_RE.test(r.semanticHash) || !UTC_RE.test(r.generatedAt)) return err('INVALID_TYPE', 'Invalid semantic hash or generatedAt.');
  if (!sameKeys(r.totals, TOTAL_KEYS) || !centsFieldsOk(r.totals)) return err('INVALID_AMOUNT', 'Totals must be integer cents.');
  for (const k of ['lines', 'ruleVersions', 'ruleEvaluations', 'findings', 'findingStatuses', 'reviewEvents', 'provenance', 'limitations']) {
    if (!Array.isArray(r[k])) return err('INVALID_TYPE', `${k} must be an array.`);
  }
  if (!r.lines.every(centsFieldsOk)) return err('INVALID_AMOUNT', 'Line amounts must be integer cents.');
  if (!r.ruleVersions.every((v) => typeof v.ruleId === 'string' && Number.isSafeInteger(v.ruleVersion))) return err('INVALID_TYPE', 'Invalid rule versions.');
  return { ok: true, value: deepFreeze(r) };
}

const safeText = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return CSV_FORMULA_TRIGGER_PREFIXES.some((p) => s.startsWith(p)) ? `'${s}` : s;
};
const quote = (s) => `"${s.replaceAll('"', '""')}"`;

export function serializeCsv(report) {
  const base = {
    report_schema_version: SCHEMA_VERSIONS.REPORT_CSV, data_classification: report.dataClassification, semantic_hash: report.semanticHash,
    project_id: report.ids.projectId, contract_id: report.ids.contractId, application_id: report.ids.applicationId,
  };
  const rows = [];
  const push = (record_type, fields) => rows.push({ ...base, record_type, ...fields });
  const meta = { syntheticLabel: report.syntheticLabel, engineContractVersion: report.engineContractVersion, readiness: report.readiness,
    periodStart: report.period.periodStart, periodEnd: report.period.periodEnd, reviewDate: report.period.reviewDate,
    generatedAt: report.generatedAt, moneyUnit: report.moneyUnit, importBatchId: report.ids.importBatchId, bundleId: report.ids.bundleId };
  for (const k of Object.keys(meta).sort(cmp)) push('META', { metric: k, text: meta[k] });
  for (const k of Object.keys(report.totals).sort(cmp)) push('TOTAL', { metric: k.replace(/Cents$/, ''), amount: report.totals[k] });
  for (const l of report.lines) {
    for (const k of Object.keys(l).filter((x) => x.endsWith('Cents')).sort(cmp)) push('LINE', { line_id: l.lineId, metric: k.replace(/Cents$/, ''), amount: l[k] });
  }
  for (const f of [...report.findings].sort(byKey('findingId'))) {
    push('FINDING', { finding_id: f.findingId, finding_code: f.code, severity: f.severity, rule_id: f.ruleId, rule_version: f.ruleVersion,
      metric: f.category, text: [f.rationale, f.formula, `Remediation: ${f.remediation}`].filter(Boolean).join('\n') });
  }
  for (const e of report.reviewEvents) {
    push('REVIEW_EVENT', { finding_id: e.findingId, metric: e.type, text: [e.disposition, e.note].filter((x) => x !== undefined).join('\n') });
  }
  const lines = [CSV_EXPORT_COLUMNS.map(quote).join(',')];
  for (const r of rows) {
    lines.push(CSV_EXPORT_COLUMNS.map((c) => {
      if (c === 'amount_usd') return quote(r.amount === undefined ? '' : formatCentsText(r.amount));
      if (c === 'rule_version') return quote(r.rule_version === undefined ? '' : String(r.rule_version));
      return quote(safeText(r[c]));
    }).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
