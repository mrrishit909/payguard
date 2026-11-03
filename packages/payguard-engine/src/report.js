// Append-only review history, immutable report snapshots, JSON/CSV export (ADR-0005/0006).
import {
  SCHEMA_VERSIONS, DATA_CLASSIFICATION, SYNTHETIC_LABEL, MONEY_UNIT, IMPORT_LIMITS, MONEY_LIMITS, ENGINE_CONTRACT_VERSION,
  ID_PATTERN, REVIEW_EVENT_TYPE, REVIEW_DISPOSITION, CSV_EXPORT_COLUMNS, CSV_FORMULA_TRIGGER_PREFIXES,
  READINESS, FINDING_CODES, FINDING_SEVERITY, FINDING_CATEGORY, RULE_OUTCOME, CANDIDATE_REJECTION_REASON, CALCULATION_RULES, CURRENCY,
} from '../../contracts/src/constants.js';
import { cmp, byKey, clone, deepFreeze, canonicalJson, isValidDate, isValidUtcTimestamp, isPlainObject, exactKeys } from './canonical.js';
import { add, sub, ArithmeticOverflow, formatCentsText } from './money.js';
import { ErrorList, checkProvenance } from './import.js';

const ID_RE = new RegExp(ID_PATTERN);
const HASH_RE = /^[0-9a-f]{64}$/;
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
  if (!history.every((e) => isPlainObject(e) && typeof e.eventId === 'string' && Number.isSafeInteger(e.sequence))) return err('INVALID_TYPE', 'History entries must be review events.');
  if (!isPlainObject(event)) return err('INVALID_TYPE', 'Event must be a plain object.');
  for (const k of Object.keys(event)) if (!EVENT_KEYS.has(k)) return err('UNKNOWN_FIELD', `Unknown event field ${k.slice(0, 64)}.`);
  if (typeof event.eventId !== 'string' || !ID_RE.test(event.eventId)) return err('INVALID_ID', 'Invalid eventId.');
  if (history.some((e) => e.eventId === event.eventId)) return err('DUPLICATE_ID', 'Duplicate eventId.');
  const last = history.length ? history[history.length - 1].sequence : 0;
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= last) return err('INVALID_TYPE', 'Sequence must be an integer greater than the previous event.');
  if (!Object.values(REVIEW_EVENT_TYPE).includes(event.type)) return err('INVALID_ENUM', 'Unsupported event type.');
  if (typeof event.analysisHash !== 'string' || !HASH_RE.test(event.analysisHash)) return err('INVALID_TYPE', 'analysisHash must be a hex SHA-256.');
  if (typeof event.actor !== 'string' || event.actor.length === 0 || event.actor.length > IMPORT_LIMITS.MAX_STRING_CHARS) return err('INVALID_TYPE', 'Invalid actor.');
  if (!isValidUtcTimestamp(event.occurredAt)) return err('INVALID_DATE', 'occurredAt must be ISO-8601 UTC.');
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
  if (!isValidUtcTimestamp(generatedAt)) throw new TypeError('generatedAt must be ISO-8601 UTC');
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
const LINE_KEYS = ['lineId', 'originalValueCents', 'approvedChangeOrdersCents', 'pendingChangeOrdersCents', 'revisedCapCents', 'completedToDateCents',
  'storedToDateCents', 'grossEarnedToDateCents', 'retainageToDateCents', 'netEarnedToDateCents', 'overCapCents'];
/** Line field -> totals field it sums into. */
const LINE_TO_TOTAL = { originalValueCents: 'originalContractCents', approvedChangeOrdersCents: 'approvedChangeOrdersCents',
  pendingChangeOrdersCents: 'pendingChangeOrdersCents', revisedCapCents: 'revisedContractCents', completedToDateCents: 'completedToDateCents',
  storedToDateCents: 'storedToDateCents', grossEarnedToDateCents: 'grossEarnedToDateCents', retainageToDateCents: 'retainageToDateCents',
  netEarnedToDateCents: 'netEarnedToDateCents' };
const FINDING_KEYS = ['findingId', 'code', 'severity', 'category', 'ruleId', 'ruleVersion', 'subject', 'inputRefs', 'observed', 'expected', 'rationale', 'remediation'];
const FIELD_REF_ENTITIES = ['project', 'contract', 'sovLine', 'changeOrder', 'payment', 'priorCertification', 'document', 'application', 'applicationLine', 'rule'];
const FINDING_STATUS = ['OPEN', 'NOT_PRESENT_IN_LATEST_RUN'];
/** Engine-generated text (formula, explanation, remediation, rationale) is longer than user strings but still bounded. */
const MAX_DERIVED_TEXT_CHARS = 4 * IMPORT_LIMITS.MAX_REVIEW_NOTE_CHARS;
const MAX_REPORT_ITEMS = 4 * IMPORT_LIMITS.MAX_ROWS;

const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isStr = (v, max = IMPORT_LIMITS.MAX_STRING_CHARS) => typeof v === 'string' && v.length <= max;
const isVersion = (v) => Number.isSafeInteger(v) && v >= 0;
const isCents = (v) => Number.isSafeInteger(v);
const isBoundedArray = (v, max = MAX_REPORT_ITEMS) => Array.isArray(v) && v.length <= max;
const isFieldRef = (r) => exactKeys(r, ['entity', 'id', 'field']) && FIELD_REF_ENTITIES.includes(r.entity) && isId(r.id) && isStr(r.field, 64);
const isScalarRecord = (o) => isPlainObject(o) && Object.keys(o).length <= 32
  && Object.entries(o).every(([k, v]) => k.length <= 64 && (isCents(v) || isStr(v) || typeof v === 'boolean'));
const isRejectedCandidate = (c) => exactKeys(c, ['documentId', 'reasons', 'explanation']) && isId(c.documentId)
  && isBoundedArray(c.reasons, 4) && c.reasons.every((x) => Object.values(CANDIDATE_REJECTION_REASON).includes(x))
  && new Set(c.reasons).size === c.reasons.length && isStr(c.explanation, MAX_DERIVED_TEXT_CHARS);
const findingIdOf = (f) => `${f.code}|${f.ruleId}@v${f.ruleVersion}|${f.subject.entity}:${f.subject.id}`;

function isFinding(f) {
  if (!exactKeys(f, FINDING_KEYS, ['formula', 'source', 'rejectedCandidates'])) return false;
  if (!Object.values(FINDING_CODES).includes(f.code) || !Object.values(FINDING_SEVERITY).includes(f.severity)
    || !Object.values(FINDING_CATEGORY).includes(f.category) || !isId(f.ruleId) || !isVersion(f.ruleVersion)) return false;
  if (!isFieldRef(f.subject) || !isBoundedArray(f.inputRefs) || !f.inputRefs.every(isFieldRef)) return false;
  if (!isScalarRecord(f.observed) || !isScalarRecord(f.expected)) return false;
  if (f.formula !== undefined && !isStr(f.formula, MAX_DERIVED_TEXT_CHARS)) return false;
  if (f.source !== undefined && !(exactKeys(f.source, ['clause', 'illustrative']) && isStr(f.source.clause) && f.source.illustrative === true)) return false;
  if (f.rejectedCandidates !== undefined && !(isBoundedArray(f.rejectedCandidates, IMPORT_LIMITS.MAX_ROWS) && f.rejectedCandidates.every(isRejectedCandidate))) return false;
  const candidates = f.rejectedCandidates?.length ?? 0;
  return isStr(f.rationale, MAX_DERIVED_TEXT_CHARS + candidates * IMPORT_LIMITS.MAX_STRING_CHARS)
    && isStr(f.remediation, MAX_DERIVED_TEXT_CHARS) && f.findingId === findingIdOf(f);
}

const isRuleEvaluation = (e) => exactKeys(e, ['ruleId', 'ruleVersion', 'outcome', 'matchedDocumentIds', 'rejectedCandidates'])
  && isId(e.ruleId) && isVersion(e.ruleVersion) && Object.values(RULE_OUTCOME).includes(e.outcome)
  && isBoundedArray(e.matchedDocumentIds, IMPORT_LIMITS.MAX_ROWS) && e.matchedDocumentIds.every(isId)
  && isBoundedArray(e.rejectedCandidates, IMPORT_LIMITS.MAX_ROWS) && e.rejectedCandidates.every(isRejectedCandidate);

const isFindingStatus = (s) => exactKeys(s, ['findingId', 'status', 'firstSeenAnalysisHash', 'lastSeenAnalysisHash'])
  && isStr(s.findingId) && FINDING_STATUS.includes(s.status) && HASH_RE.test(s.firstSeenAnalysisHash) && HASH_RE.test(s.lastSeenAnalysisHash);

/**
 * Arithmetic that is derivable from the report alone (PG-CALC-01..04 identities, line sums,
 * readiness, presence of financial findings). Retainage itself needs the basis points from the
 * project bundle, so it is only range-checked here. Returns an error message or null.
 */
function arithmeticError(r) {
  const t = r.totals;
  const lineSums = Object.fromEntries(Object.values(LINE_TO_TOTAL).map((k) => [k, 0]));
  const expectedFinancial = new Set();
  const appId = r.ids.applicationId;
  for (const l of r.lines) {
    if (LINE_KEYS.slice(1).some((k) => l[k] < 0)) return 'Line amounts must be non-negative.';
    if (l.revisedCapCents !== add(l.originalValueCents, l.approvedChangeOrdersCents)) return `Line ${l.lineId} revised cap is inconsistent.`;
    if (l.grossEarnedToDateCents !== add(l.completedToDateCents, l.storedToDateCents)) return `Line ${l.lineId} gross earned is inconsistent.`;
    if (l.retainageToDateCents > l.grossEarnedToDateCents) return `Line ${l.lineId} retainage exceeds gross earned.`;
    if (l.netEarnedToDateCents !== sub(l.grossEarnedToDateCents, l.retainageToDateCents)) return `Line ${l.lineId} net earned is inconsistent.`;
    const over = l.grossEarnedToDateCents > l.revisedCapCents ? sub(l.grossEarnedToDateCents, l.revisedCapCents) : 0;
    if (l.overCapCents !== over) return `Line ${l.lineId} over-cap amount is inconsistent.`;
    if (over > 0) expectedFinancial.add(`${FINDING_CODES.LINE_EARNED_EXCEEDS_REVISED_CAP}|${CALCULATION_RULES.REVISED_CAP.ruleId}@v${CALCULATION_RULES.REVISED_CAP.ruleVersion}|sovLine:${l.lineId}`);
    for (const [lk, tk] of Object.entries(LINE_TO_TOTAL)) lineSums[tk] = add(lineSums[tk], l[lk]);
  }
  for (const tk of Object.values(LINE_TO_TOTAL)) if (t[tk] !== lineSums[tk]) return `Total ${tk} does not equal the sum of its lines.`;
  for (const k of ['postedPriorPaymentsCents', 'priorCertifiedInformationalCents', 'claimedCurrentDueCents']) if (t[k] < 0) return `Total ${k} must be non-negative.`;
  if (t.claimedCurrentDueCents > MONEY_LIMITS.MAX_INPUT_AMOUNT_CENTS) return 'Claimed current due is out of range.';
  if (t.calculatedCurrentDueCents !== sub(t.netEarnedToDateCents, t.postedPriorPaymentsCents)) return 'Calculated current due is inconsistent.';
  if (t.claimDiscrepancyCents !== sub(t.claimedCurrentDueCents, t.calculatedCurrentDueCents)) return 'Claim discrepancy is inconsistent.';
  if (t.calculatedCurrentDueCents < 0) expectedFinancial.add(`${FINDING_CODES.OVERPAYMENT_CREDIT}|${CALCULATION_RULES.AMOUNT_DUE.ruleId}@v${CALCULATION_RULES.AMOUNT_DUE.ruleVersion}|application:${appId}`);
  if (t.claimDiscrepancyCents !== 0) expectedFinancial.add(`${FINDING_CODES.CLAIMED_DUE_MISMATCH}|${CALCULATION_RULES.CLAIM_COMPARISON.ruleId}@v${CALCULATION_RULES.CLAIM_COMPARISON.ruleVersion}|application:${appId}`);
  const financial = r.findings.filter((f) => f.category === FINDING_CATEGORY.FINANCIAL).map((f) => f.findingId);
  if (financial.length !== expectedFinancial.size || !financial.every((id) => expectedFinancial.has(id))) return 'Financial findings do not match the reported totals.';
  const blocking = r.findings.some((f) => f.severity === FINDING_SEVERITY.BLOCKING);
  if (r.readiness !== (blocking ? READINESS.NOT_READY : READINESS.NO_BLOCKING_FINDINGS)) return 'Readiness does not match the reported findings.';
  return null;
}

/**
 * Strict, non-throwing validator for an untrusted payguard.report.v1 text. Success means the
 * report is structurally valid and internally consistent; it is NOT authenticity or source
 * verification: semanticHash is an unkeyed input fingerprint, not a signature, and imported
 * figures are not recomputed from the original bundle/application (ADR-0006).
 */
export function parseJson(text) {
  if (typeof text !== 'string' || text.length > 16 * IMPORT_LIMITS.MAX_UPLOAD_BYTES) return err('INPUT_TOO_LARGE', 'Report text is missing or too large.');
  let r;
  try { r = JSON.parse(text); } catch { return err('MALFORMED_JSON', 'Report is not well-formed JSON.'); }
  if (!exactKeys(r, REPORT_KEYS)) return err('UNKNOWN_FIELD', 'Report fields do not match payguard.report.v1.');
  if (r.reportSchemaVersion !== SCHEMA_VERSIONS.REPORT) return err('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported report schema version.');
  if (r.dataClassification !== DATA_CLASSIFICATION || r.syntheticLabel !== SYNTHETIC_LABEL) return err('UNSUPPORTED_CLASSIFICATION', 'Report is not labelled synthetic.');
  if (r.moneyUnit !== MONEY_UNIT) return err('INVALID_TYPE', 'Unsupported money unit.');
  if (r.engineContractVersion !== ENGINE_CONTRACT_VERSION) return err('UNSUPPORTED_SCHEMA_VERSION', 'Report was produced by an unsupported engine contract version.');
  if (typeof r.semanticHash !== 'string' || !HASH_RE.test(r.semanticHash)) return err('INVALID_TYPE', 'Invalid semantic hash.');
  if (!isValidUtcTimestamp(r.generatedAt)) return err('INVALID_DATE', 'generatedAt must be a valid ISO-8601 UTC timestamp.');
  const idKeys = ['projectId', 'contractId', 'applicationId', 'importBatchId', 'bundleId'];
  if (!exactKeys(r.ids, idKeys) || !idKeys.every((k) => isId(r.ids[k]))) return err('INVALID_ID', 'Report ids must be valid identifiers.');
  const periodKeys = ['periodStart', 'periodEnd', 'reviewDate'];
  if (!exactKeys(r.period, periodKeys) || !periodKeys.every((k) => isValidDate(r.period[k]))) return err('INVALID_DATE', 'Report period dates must be calendar-valid.');
  if (r.period.periodEnd < r.period.periodStart) return err('PERIOD_END_BEFORE_START', 'Report period ends before it starts.');
  if (![READINESS.NOT_READY, READINESS.NO_BLOCKING_FINDINGS].includes(r.readiness)) return err('INVALID_ENUM', 'Unsupported report readiness.');
  if (!exactKeys(r.totals, TOTAL_KEYS) || !TOTAL_KEYS.every((k) => isCents(r.totals[k]))) return err('INVALID_AMOUNT', 'Totals must be integer cents.');

  if (!isBoundedArray(r.lines, IMPORT_LIMITS.MAX_ROWS) || r.lines.length === 0) return err('INVALID_TYPE', 'lines must be a non-empty bounded array.');
  if (!r.lines.every((l) => exactKeys(l, LINE_KEYS) && isId(l.lineId) && LINE_KEYS.slice(1).every((k) => isCents(l[k])))) return err('INVALID_AMOUNT', 'Line fields must match the schema with integer cents.');
  if (new Set(r.lines.map((l) => l.lineId)).size !== r.lines.length) return err('DUPLICATE_ID', 'Duplicate report line.');
  if (!isBoundedArray(r.ruleVersions) || !r.ruleVersions.every((v) => exactKeys(v, ['ruleId', 'ruleVersion']) && isId(v.ruleId) && isVersion(v.ruleVersion))) return err('INVALID_TYPE', 'Invalid rule versions.');
  const ruleKeys = new Set(r.ruleVersions.map((v) => `${v.ruleId}@${v.ruleVersion}`));
  if (ruleKeys.size !== r.ruleVersions.length) return err('DUPLICATE_ID', 'Duplicate rule version.');
  if (!Object.values(CALCULATION_RULES).every((c) => ruleKeys.has(`${c.ruleId}@${c.ruleVersion}`))) return err('MISSING_FIELD', 'Report must list every calculation rule version applied.');
  if (!isBoundedArray(r.ruleEvaluations) || r.ruleEvaluations.length === 0 || !r.ruleEvaluations.every(isRuleEvaluation)) return err('INVALID_TYPE', 'Invalid rule evaluations.');
  if (!isBoundedArray(r.findings) || !r.findings.every(isFinding)) return err('INVALID_TYPE', 'Invalid findings.');
  const findingIds = new Set(r.findings.map((f) => f.findingId));
  if (findingIds.size !== r.findings.length) return err('DUPLICATE_ID', 'Duplicate finding.');
  if (!r.findings.every((f) => ruleKeys.has(`${f.ruleId}@${f.ruleVersion}`) || f.code === FINDING_CODES.REQUIREMENT_NOT_CONFIGURED)) return err('UNKNOWN_REFERENCE', 'Finding cites a rule version the report does not list.');
  if (!isBoundedArray(r.findingStatuses) || !r.findingStatuses.every(isFindingStatus)) return err('INVALID_TYPE', 'Invalid finding statuses.');
  const statusIds = new Set(r.findingStatuses.map((s) => s.findingId));
  if (statusIds.size !== r.findingStatuses.length) return err('DUPLICATE_ID', 'Duplicate finding status.');
  if (!r.findingStatuses.every((s) => (s.status === 'OPEN') === findingIds.has(s.findingId) && (s.status !== 'OPEN' || s.lastSeenAnalysisHash === r.semanticHash))
    || ![...findingIds].every((id) => statusIds.has(id))) return err('UNKNOWN_REFERENCE', 'Finding statuses do not match the latest findings.');

  if (!isBoundedArray(r.reviewEvents)) return err('INVALID_TYPE', 'reviewEvents must be a bounded array.');
  let history = [];
  for (const e of r.reviewEvents) {
    const step = appendEvent(history, e);
    if (!step.ok) return step;
    history = step.value;
  }
  if (!Array.isArray(r.provenance)) return err('INVALID_TYPE', 'provenance must be an array.');
  const application = { applicationId: r.ids.applicationId, contractId: r.ids.contractId, currency: CURRENCY, ...r.period, claimedCurrentDueCents: r.totals.claimedCurrentDueCents };
  const provErrors = new ErrorList();
  checkProvenance(r.provenance, { application, lines: r.lines, importBatchId: r.ids.importBatchId }, '/provenance', provErrors);
  if (provErrors.any) return { ok: false, errors: provErrors.items };
  if (!Array.isArray(r.limitations) || r.limitations.length !== LIMITATIONS.length || !LIMITATIONS.every((x, i) => r.limitations[i] === x)) {
    return err('INVALID_TYPE', 'Report limitations must be the payguard.report.v1 limitations.');
  }

  let arithmetic;
  try { arithmetic = arithmeticError(r); } catch (e) {
    if (!(e instanceof ArithmeticOverflow)) throw e;
    arithmetic = 'A report amount exceeds the safe integer range.';
  }
  if (arithmetic) return err('INVALID_AMOUNT', arithmetic);
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
