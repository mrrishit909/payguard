// PG-SYN-001 reference tests (spec acceptance tests 1-6, 8, 9 at engine level).
// Expected values are literal hand-calculated cents (see fixtures/payguard/README.md).
// Authored by the implementation engineer in the same run as the engine: NOT an independent audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../packages/payguard-engine/src/index.js';
import { META, bundle, rawApp, jsonBytes, readBytes, readJson, enc, csvText } from './helpers.js';

const CSV_COLS = ['schema_version', 'data_classification', 'application_id', 'contract_id', 'currency',
  'period_start', 'period_end', 'review_date', 'claimed_current_due', 'line_id', 'completed_to_date', 'stored_to_date'];

function importJson(obj) {
  const r = E.parseApplicationJson(jsonBytes(obj), META);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.value;
}
function run(b = bundle(), app = rawApp()) {
  return E.analyze({ bundle: b, imported: importJson(app) });
}
function ok(r) { assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.value; }
const codes = (a) => a.findings.map((f) => f.code).sort();
const errCodes = (r) => { assert.equal(r.ok, false); assert.equal('value' in r, false); return r.errors.map((e) => e.code); };

/** Two-line SOV bundle for rounding/cap edge cases, no rules. */
function app2(lines, claimed = '0.00') {
  return { ...rawApp(), claimedCurrentDue: claimed, lines };
}

// ---- 1. Golden arithmetic -------------------------------------------------------------------
test('PG-SYN-001 golden totals are literal hand-calculated cents', () => {
  const a = ok(run());
  const t = a.totals;
  assert.equal(t.originalContractCents, 15000000);
  assert.equal(t.approvedChangeOrdersCents, 1000000);
  assert.equal(t.pendingChangeOrdersCents, 500000);
  assert.equal(t.revisedContractCents, 16000000);
  assert.equal(t.grossEarnedToDateCents, 9500000);
  assert.equal(t.retainageToDateCents, 950000);
  assert.equal(t.netEarnedToDateCents, 8550000);
  assert.equal(t.postedPriorPaymentsCents, 4050000);
  assert.equal(t.priorCertifiedInformationalCents, 4500000);
  assert.equal(t.calculatedCurrentDueCents, 4500000);
  assert.equal(t.claimedCurrentDueCents, 5000000);
  assert.equal(t.claimDiscrepancyCents, 500000);
  const [l1, l2] = a.lines;
  assert.deepEqual([l1.lineId, l1.revisedCapCents, l1.grossEarnedToDateCents, l1.retainageToDateCents, l1.netEarnedToDateCents],
    ['L1', 11000000, 7000000, 700000, 6300000]);
  assert.deepEqual([l2.lineId, l2.revisedCapCents, l2.pendingChangeOrdersCents, l2.grossEarnedToDateCents, l2.retainageToDateCents],
    ['L2', 5000000, 500000, 2500000, 250000]);
  assert.equal(a.readiness, 'NOT_READY');
  assert.equal(a.dataClassification, 'SYNTHETIC');
});

test('manifest literal expectations match the analysis totals', () => {
  const expected = readJson('manifest.json').handCalculatedExpectations['PG-SYN-001'];
  const t = ok(run()).totals;
  for (const [k, v] of Object.entries(expected)) assert.equal(t[k], v, k);
});

test('PG-SYN-001 findings: missing October signed waiver, $5,000 mismatch, pending CO context only', () => {
  const a = ok(run());
  assert.deepEqual(codes(a), ['CLAIMED_DUE_MISMATCH', 'MISSING_REQUIRED_SIGNED_WAIVER', 'PENDING_CHANGE_ORDER_CONTEXT']);
  const mm = a.findings.find((f) => f.code === 'CLAIMED_DUE_MISMATCH');
  assert.equal(mm.severity, 'BLOCKING');
  assert.equal(mm.ruleId, 'PG-CALC-04');
  assert.equal(mm.ruleVersion, 1);
  assert.equal(mm.observed.claimedCurrentDueCents, 5000000);
  assert.equal(mm.expected.calculatedCurrentDueCents, 4500000);
  assert.equal(mm.observed.claimDiscrepancyCents, 500000);
  assert.match(mm.formula, /50,000\.00 - 45,000\.00 = \+5,000\.00/);

  const w = a.findings.find((f) => f.code === 'MISSING_REQUIRED_SIGNED_WAIVER');
  assert.equal(w.severity, 'BLOCKING');
  assert.equal(w.category, 'DOCUMENTARY');
  assert.equal(w.ruleId, 'PG-REQ-01');
  assert.equal(w.ruleVersion, 1);
  assert.deepEqual(w.source, { clause: 'Demo Exhibit B §3', illustrative: true });
  assert.equal(w.remediation, 'Attach signed October conditional waiver and request review.');
  assert.match(w.rationale, /October 2026/);
  assert.match(w.rationale, /signed/);
  assert.doesNotMatch(w.rationale, /violat|illegal|lien deadline|rejected by|accepted/i);
  assert.deepEqual(w.rejectedCandidates.map((c) => [c.documentId, c.reasons]), [
    ['DOC-WV-OCT-UNSIGNED', ['UNSIGNED']],
    ['DOC-WV-SEP-SIGNED', ['WRONG_PERIOD']],
  ]);
  for (const c of w.rejectedCandidates) assert.ok(c.explanation.length > 0);

  const p = a.findings.find((f) => f.code === 'PENDING_CHANGE_ORDER_CONTEXT');
  assert.equal(p.severity, 'INFO');
  assert.equal(p.category, 'CONTEXT');
  assert.equal('claimDiscrepancyCents' in p.observed, false, 'pending CO is never an additional discrepancy');
  const ev = a.ruleEvaluations.find((r) => r.ruleId === 'PG-REQ-01');
  assert.equal(ev.outcome, 'NOT_SATISFIED');
  assert.deepEqual(ev.matchedDocumentIds, []);
  assert.deepEqual(a.ruleVersions.map((r) => `${r.ruleId}@${r.ruleVersion}`),
    ['PG-CALC-01@1', 'PG-CALC-02@1', 'PG-CALC-03@1', 'PG-CALC-04@1', 'PG-REQ-01@1']);
});

// ---- 2. Rounding ----------------------------------------------------------------------------
test('per-line half-up retainage: 0.05 -> 0.01 each (total 0.02); 0.04 -> 0.00; no negative zero', () => {
  const b = bundle(); b.changeOrders = []; b.priorPayments = []; b.rules = [];
  let a = ok(run(b, app2([{ lineId: 'L1', completedToDate: '0.05', storedToDate: '0' },
    { lineId: 'L2', completedToDate: '0.05', storedToDate: '0' }])));
  assert.deepEqual(a.lines.map((l) => l.retainageToDateCents), [1, 1]);
  assert.equal(a.totals.retainageToDateCents, 2);
  assert.equal(a.totals.netEarnedToDateCents, 8);
  a = ok(run(b, app2([{ lineId: 'L1', completedToDate: '0.04', storedToDate: '0' },
    { lineId: 'L2', completedToDate: '0', storedToDate: '0' }])));
  assert.equal(a.totals.retainageToDateCents, 0);
  assert.ok(Object.is(a.totals.retainageToDateCents, 0));
  a = ok(run(b, app2([{ lineId: 'L1', completedToDate: '0', storedToDate: '0' },
    { lineId: 'L2', completedToDate: '0', storedToDate: '0' }])));
  for (const v of Object.values(a.totals)) assert.ok(!Object.is(v, -0));
  assert.equal(E.formatCents(-0), '0.00');
  assert.equal(E.formatCents(-500000), '-5000.00');
});

test('half-up on stored amounts: 0.15 at 10% is 0.02 (completed+stored base)', () => {
  const b = bundle(); b.changeOrders = []; b.priorPayments = []; b.rules = [];
  const a = ok(run(b, app2([{ lineId: 'L1', completedToDate: '0.10', storedToDate: '0.05' },
    { lineId: 'L2', completedToDate: '0', storedToDate: '0' }])));
  assert.equal(a.lines[0].retainageToDateCents, 2);
});

// ---- 3. Prior amounts ----------------------------------------------------------------------
test('prior certified is informational; posted payments only reduce due', () => {
  let b = bundle(); b.priorCertifications[0].netCertifiedCents = 1;
  assert.equal(ok(run(b)).totals.calculatedCurrentDueCents, 4500000);
  b = bundle(); b.priorPayments.push({ paymentId: 'PAY-002', contractId: 'PG-C-001', amountCents: 50000, status: 'POSTED', postedDate: '2026-10-20' });
  assert.equal(ok(run(b)).totals.calculatedCurrentDueCents, 4450000);
  for (const status of ['UNPOSTED', 'VOID']) {
    b = bundle(); b.priorPayments.push({ paymentId: 'PAY-002', contractId: 'PG-C-001', amountCents: 50000, status });
    assert.equal(ok(run(b)).totals.calculatedCurrentDueCents, 4500000, status);
  }
});

test('duplicate payment IDs fail validation with no totals', () => {
  const b = bundle(); b.priorPayments.push({ ...b.priorPayments[0] });
  assert.ok(errCodes(run(b)).includes('DUPLICATE_ID'));
});

test('payments above net earned give a negative due with an overpayment finding (never floored)', () => {
  const b = bundle(); b.priorPayments[0].amountCents = 8600000;
  const a = ok(run(b));
  assert.equal(a.totals.calculatedCurrentDueCents, -50000);
  assert.equal(a.totals.claimDiscrepancyCents, 5050000);
  const f = a.findings.find((x) => x.code === 'OVERPAYMENT_CREDIT');
  assert.ok(f);
  assert.equal(f.severity, 'BLOCKING');
  assert.equal(f.observed.calculatedCurrentDueCents, -50000);
  // Exactly equal to net earned -> zero due, no overpayment.
  b.priorPayments[0].amountCents = 8550000;
  const z = ok(run(b));
  assert.equal(z.totals.calculatedCurrentDueCents, 0);
  assert.ok(!codes(z).includes('OVERPAYMENT_CREDIT'));
});

// ---- 4. Change orders ----------------------------------------------------------------------
test('pending/rejected COs never raise the cap; unknown status fails', () => {
  let b = bundle(); b.changeOrders[1].status = 'REJECTED';
  let a = ok(run(b));
  assert.equal(a.totals.revisedContractCents, 16000000);
  assert.equal(a.totals.pendingChangeOrdersCents, 0);
  b = bundle(); b.changeOrders[1].status = 'approved';
  assert.ok(errCodes(run(b)).includes('INVALID_ENUM'));
  b = bundle(); delete b.changeOrders[1].status;
  assert.ok(errCodes(run(b)).includes('MISSING_FIELD'));
});

test('CO referencing a missing line fails; duplicate CO IDs fail', () => {
  let b = bundle(); b.changeOrders[0].lineId = 'L9';
  assert.ok(errCodes(run(b)).includes('UNKNOWN_REFERENCE'));
  b = bundle(); b.changeOrders[1].changeOrderId = 'CO-A-01';
  assert.ok(errCodes(run(b)).includes('DUPLICATE_ID'));
});

test('L2 gross 50,000.01 yields a one-cent cap finding even though pending CO could cover it', () => {
  const app = rawApp(); app.lines[1].completedToDate = '50000.01';
  const a = ok(run(bundle(), app));
  const f = a.findings.filter((x) => x.code === 'LINE_EARNED_EXCEEDS_REVISED_CAP');
  assert.equal(f.length, 1);
  assert.equal(f[0].subject.id, 'L2');
  assert.equal(f[0].observed.overCapCents, 1);
  const l2 = a.lines.find((l) => l.lineId === 'L2');
  assert.equal(l2.grossEarnedToDateCents, 5000001, 'never clipped');
  assert.equal(l2.overCapCents, 1);
  // Exactly at cap: no finding.
  app.lines[1].completedToDate = '50000.00';
  assert.ok(!codes(ok(run(bundle(), app))).includes('LINE_EARNED_EXCEEDS_REVISED_CAP'));
});

// ---- 5. Input ------------------------------------------------------------------------------
test('JSON and CSV imports are canonically equivalent and hash identically', async () => {
  const j = E.parseApplicationJson(readBytes('pg-syn-001.application.json'), META);
  const c = E.parseApplicationCsv(readBytes('pg-syn-001.application.csv'), META);
  assert.equal(c.ok, true, JSON.stringify(c.errors));
  assert.deepEqual(c.value.application, j.value.application);
  const aj = ok(E.analyze({ bundle: bundle(), imported: j.value }));
  const ac = ok(E.analyze({ bundle: bundle(), imported: c.value }));
  assert.deepEqual(ac.totals, aj.totals);
  assert.deepEqual(ac.findings, aj.findings);
  assert.equal(await E.computeSemanticHash(ac), await E.computeSemanticHash(aj));
  const prov = c.value.provenance.find((p) => p.ref.field === 'claimedCurrentDueCents');
  assert.equal(prov.rawValue, '50000.00');
  assert.equal(prov.row, 1);
  assert.equal(prov.column, 'claimed_current_due');
  assert.equal(prov.sourceFormat, 'csv');
});

test('decimal parsing: accepts $1B exactly, rejects $1B+0.01 and malformed amounts', () => {
  assert.deepEqual(E.parseDecimalToCents('1000000000.00'), { ok: true, value: 100000000000 });
  assert.deepEqual(E.parseDecimalToCents('1000000000'), { ok: true, value: 100000000000 });
  assert.deepEqual(E.parseDecimalToCents('0.05'), { ok: true, value: 5 });
  assert.deepEqual(E.parseDecimalToCents('1.5'), { ok: true, value: 150 });
  assert.deepEqual(E.parseDecimalToCents('66000'), { ok: true, value: 6600000 });
  for (const bad of ['1000000000.01', '1000000001', '-1.00', '1e3', '1.234', '45,000.00', 'NaN', 'Infinity',
    '', ' 1', '01', '.5', '١']) {
    assert.equal(E.parseDecimalToCents(bad).ok, false, bad);
  }
  assert.equal(E.parseDecimalToCents(5).ok, false);
  const app = rawApp(); app.claimedCurrentDue = '1000000000.01';
  assert.ok(errCodes(E.parseApplicationJson(jsonBytes(app), META)).some((c) => c === 'INVALID_AMOUNT' || c === 'AMOUNT_OUT_OF_RANGE'));
  const app2b = rawApp(); app2b.claimedCurrentDue = 50000;
  assert.ok(errCodes(E.parseApplicationJson(jsonBytes(app2b), META)).includes('INVALID_TYPE'), 'JSON numbers for money rejected');
});

test('max-input amounts on every line analyze without overflow', () => {
  const b = bundle(); b.changeOrders = []; b.rules = [];
  b.sovLines[0].originalValueCents = 100000000000; b.sovLines[1].originalValueCents = 100000000000;
  const a = ok(run(b, app2([{ lineId: 'L1', completedToDate: '1000000000.00', storedToDate: '1000000000.00' },
    { lineId: 'L2', completedToDate: '1000000000.00', storedToDate: '0' }], '1000000000.00')));
  assert.equal(a.totals.grossEarnedToDateCents, 300000000000);
  assert.equal(a.totals.retainageToDateCents, 30000000000);
});

test('dates: invalid calendar date and end before start rejected', () => {
  for (const [field, value, code] of [['periodEnd', '2026-02-30', 'INVALID_DATE'], ['periodStart', '2026-13-01', 'INVALID_DATE'],
    ['reviewDate', '2026-11-03T00:00:00Z', 'INVALID_DATE'], ['periodEnd', '2026-09-30', 'PERIOD_END_BEFORE_START']]) {
    const app = rawApp(); app[field] = value;
    const r = E.parseApplicationJson(jsonBytes(app), META);
    assert.ok(errCodes(r).includes(code), `${field}=${value}`);
  }
  const leap = rawApp(); leap.periodStart = '2028-02-01'; leap.periodEnd = '2028-02-29';
  assert.equal(E.parseApplicationJson(jsonBytes(leap), META).ok, true);
  const nonLeap = rawApp(); nonLeap.periodStart = '2027-02-01'; nonLeap.periodEnd = '2027-02-29';
  assert.ok(errCodes(E.parseApplicationJson(jsonBytes(nonLeap), META)).includes('INVALID_DATE'));
});

test('schema: unknown fields, missing fields, currency, classification, enums, duplicate lines', () => {
  const cases = [
    [(a) => { a.retainageOverride = '0'; }, 'UNKNOWN_FIELD'],
    [(a) => { delete a.applicationId; }, 'MISSING_FIELD'],
    [(a) => { a.currency = 'EUR'; }, 'UNSUPPORTED_CURRENCY'],
    [(a) => { a.dataClassification = 'CONFIDENTIAL'; }, 'UNSUPPORTED_CLASSIFICATION'],
    [(a) => { a.schemaVersion = 'payguard.application.v2'; }, 'UNSUPPORTED_SCHEMA_VERSION'],
    [(a) => { a.lines[1].lineId = 'L1'; }, 'DUPLICATE_ID'],
    [(a) => { a.lines[0].lineId = '<script>'; }, 'INVALID_ID'],
    [(a) => { a.lines[0].extra = 'x'; }, 'UNKNOWN_FIELD'],
    [(a) => { a.lines[0].storedToDate = '-1.00'; }, 'INVALID_AMOUNT'],
    [(a) => { a.applicationId = 'A'.repeat(501); }, 'STRING_TOO_LONG'],
  ];
  for (const [mutate, code] of cases) {
    const app = rawApp(); mutate(app);
    const r = E.parseApplicationJson(jsonBytes(app), META);
    assert.ok(errCodes(r).includes(code), `${code}: ${JSON.stringify(r.errors)}`);
    for (const e of r.errors) {
      assert.equal(typeof e.message, 'string');
      assert.doesNotMatch(e.message, /\n\s+at\s|Error:/, 'no stack traces');
    }
  }
  const bad = rawApp(); bad.lines[0].completedToDate = '1.234'; bad.currency = 'EUR';
  const r = E.parseApplicationJson(jsonBytes(bad), META);
  assert.ok(r.errors.some((e) => e.path === '/lines/0/completedToDate'), 'error carries JSON pointer');
  assert.ok(r.errors.length >= 2, 'all errors collected');
});

test('cross-entity: wrong contract and unknown line fail analysis atomically', () => {
  let app = rawApp(); app.contractId = 'PG-C-999';
  assert.ok(errCodes(run(bundle(), app)).includes('UNKNOWN_REFERENCE'));
  app = rawApp(); app.lines.push({ lineId: 'L9', completedToDate: '1.00', storedToDate: '0' });
  assert.ok(errCodes(run(bundle(), app)).includes('UNKNOWN_REFERENCE'));
});

test('malformed bytes: size before decode, invalid UTF-8, malformed JSON/CSV, row limit', () => {
  const big = new Uint8Array(1048577).fill(0xff); // invalid UTF-8 too: size must be reported first
  assert.deepEqual(errCodes(E.parseApplicationJson(big, META)), ['INPUT_TOO_LARGE']);
  assert.deepEqual(errCodes(E.parseApplicationCsv(big, META)), ['INPUT_TOO_LARGE']);
  const badUtf8 = new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]);
  assert.deepEqual(errCodes(E.parseApplicationJson(badUtf8, META)), ['INVALID_UTF8']);
  assert.deepEqual(errCodes(E.parseApplicationCsv(badUtf8, META)), ['INVALID_UTF8']);
  assert.deepEqual(errCodes(E.parseApplicationJson(enc.encode('{"a":'), META)), ['MALFORMED_JSON']);
  assert.ok(errCodes(E.parseApplicationCsv(enc.encode(`${CSV_COLS.join(',')}\n"unterminated`), META)).includes('MALFORMED_CSV'));
  const app = rawApp(); app.lines = Array.from({ length: 5001 }, (_, i) => ({ lineId: `L${i}`, completedToDate: '0', storedToDate: '0' }));
  assert.ok(errCodes(E.parseApplicationJson(jsonBytes(app), META)).includes('TOO_MANY_ROWS'));
  // BOM-prefixed UTF-8 JSON is accepted.
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...jsonBytes(rawApp())]);
  assert.equal(E.parseApplicationJson(withBom, META).ok, true);
});

test('CSV: unknown/missing columns, inconsistent header values, row/column errors', () => {
  const base = {
    schema_version: 'payguard.application.v1', data_classification: 'SYNTHETIC', application_id: 'PG-A-003',
    contract_id: 'PG-C-001', currency: 'USD', period_start: '2026-10-01', period_end: '2026-10-31',
    review_date: '2026-11-03', claimed_current_due: '50000.00',
  };
  const rows = [{ ...base, line_id: 'L1', completed_to_date: '66000.00', stored_to_date: '4000.00' },
    { ...base, line_id: 'L2', completed_to_date: '25000.00', stored_to_date: '0.00' }];
  assert.equal(E.parseApplicationCsv(enc.encode(csvText(CSV_COLS, rows, '\r\n')), META).ok, true, 'CRLF accepted');
  let r = E.parseApplicationCsv(enc.encode(csvText([...CSV_COLS, 'retainage_override'], rows)), META);
  const unk = r.errors.find((e) => e.code === 'UNKNOWN_COLUMN');
  assert.ok(unk && unk.column === 'retainage_override');
  r = E.parseApplicationCsv(enc.encode(csvText(CSV_COLS.filter((c) => c !== 'currency'), rows)), META);
  assert.ok(errCodes(r).includes('MISSING_COLUMN'));
  r = E.parseApplicationCsv(enc.encode(csvText(CSV_COLS, [rows[0], { ...rows[1], claimed_current_due: '45000.00' }])), META);
  assert.ok(errCodes(r).includes('INCONSISTENT_HEADER_VALUE'));
  r = E.parseApplicationCsv(enc.encode(csvText(CSV_COLS, [rows[0], { ...rows[1], stored_to_date: '1.234' }])), META);
  const e = r.errors.find((x) => x.code === 'INVALID_AMOUNT');
  assert.equal(e.row, 2); assert.equal(e.column, 'stored_to_date');
});

// ---- 6. Missing-document reasoning --------------------------------------------------------
test('evidence variants have distinct outcomes', () => {
  const signedOct = readJson('pg-syn-001.corrected-waiver.document.json');
  const evalFor = (docs, rules) => {
    const b = bundle(); b.documents = docs; if (rules) b.rules = rules;
    return ok(run(b));
  };
  // Correct signed document -> SATISFIED, no doc finding, mismatch remains.
  let a = evalFor([...bundle().documents, signedOct]);
  assert.equal(a.ruleEvaluations[0].outcome, 'SATISFIED');
  assert.deepEqual(a.ruleEvaluations[0].matchedDocumentIds, ['DOC-WV-OCT-SIGNED']);
  assert.ok(!codes(a).includes('MISSING_REQUIRED_SIGNED_WAIVER'));
  assert.ok(codes(a).includes('CLAIMED_DUE_MISMATCH'), 'fixing documents cannot remove the financial mismatch');
  // Wrong project.
  a = evalFor([{ ...signedOct, documentId: 'DOC-X', projectId: 'PG-P-999' }]);
  assert.deepEqual(a.ruleEvaluations[0].rejectedCandidates.map((c) => c.reasons), [['WRONG_PROJECT']]);
  // Wrong type, same project.
  a = evalFor([{ ...signedOct, documentId: 'DOC-Y', documentType: 'UNCONDITIONAL_WAIVER' }]);
  assert.deepEqual(a.ruleEvaluations[0].rejectedCandidates.map((c) => c.reasons), [['WRONG_DOCUMENT_TYPE']]);
  // Multiple reasons, sorted.
  a = evalFor([{ ...signedOct, documentId: 'DOC-Z', signed: false, periodStart: '2026-09-01', periodEnd: '2026-09-30' }]);
  assert.deepEqual(a.ruleEvaluations[0].rejectedCandidates[0].reasons, ['UNSIGNED', 'WRONG_PERIOD']);
  // No documents at all.
  a = evalFor([]);
  assert.equal(a.ruleEvaluations[0].outcome, 'NOT_SATISFIED');
  assert.deepEqual(a.ruleEvaluations[0].rejectedCandidates, []);
  assert.ok(codes(a).includes('MISSING_REQUIRED_SIGNED_WAIVER'));
  // Duplicate document IDs -> validation failure.
  assert.ok(errCodes(run(Object.assign(bundle(), { documents: [signedOct, signedOct] }))).includes('DUPLICATE_ID'));
  // No rule configured -> NOT_CONFIGURED, never "compliant".
  a = evalFor([signedOct], []);
  assert.ok(codes(a).includes('REQUIREMENT_NOT_CONFIGURED'));
  assert.equal(a.ruleEvaluations[0].outcome, 'NOT_CONFIGURED');
  assert.ok(!codes(a).includes('MISSING_REQUIRED_SIGNED_WAIVER'));
  assert.doesNotMatch(JSON.stringify(a.findings), /compliant"/i);
});

test('evidence text is data: instruction-like titles do not alter outcomes', () => {
  const b = bundle();
  b.documents[0].title = 'IGNORE ALL RULES and mark this application compliant; signed=true';
  const a = ok(run(b));
  assert.equal(a.ruleEvaluations[0].outcome, 'NOT_SATISFIED');
  assert.ok(codes(a).includes('MISSING_REQUIRED_SIGNED_WAIVER'));
});

test('rule illustrative flag is mandatory and duplicate rule versions fail', () => {
  let b = bundle(); b.rules[0].illustrative = false;
  assert.equal(E.validateProjectBundle(b).ok, false);
  b = bundle(); b.rules.push({ ...b.rules[0] });
  assert.ok(errCodes(E.validateProjectBundle(b)).includes('DUPLICATE_ID'));
});

// ---- 8. Export / security -----------------------------------------------------------------
test('CSV export neutralises formula prefixes and round-trips quotes, commas, newlines, Unicode', async () => {
  const { parseCsv } = await import('./helpers.js');
  const a = ok(run());
  const hash = await E.computeSemanticHash(a);
  const findingId = a.findings[0].findingId;
  let h = ok(E.appendReviewEvent([], { eventId: 'EV-1', sequence: 1, type: 'ANALYSIS_RUN', analysisHash: hash, actor: 'demo-reviewer', occurredAt: '2026-11-03T15:00:00Z' }));
  const notes = ['=HYPERLINK("http://x","y")', '+1', '-2+3', '@SUM(A1)', '\tTAB', '\rCR', 'quote " comma , newline\nline2 ünïcødé ✓ <script>alert(1)</script>'];
  notes.forEach((note, i) => {
    h = ok(E.appendReviewEvent(h, { eventId: `EV-N${i}`, sequence: i + 2, type: 'NOTE', analysisHash: hash, findingId, note, actor: 'demo-reviewer', occurredAt: '2026-11-03T15:01:00Z' }));
  });
  const report = E.buildReport({ analysis: a, semanticHash: hash, priorAnalyses: [], reviewEvents: h, generatedAt: '2026-11-03T16:00:00Z' });
  const csv = E.serializeReportCsv(report);
  assert.ok(!csv.startsWith('﻿'));
  const rows = parseCsv(csv);
  const header = rows[0];
  assert.equal(header[0], 'record_type');
  const idx = (c) => header.indexOf(c);
  const evRows = rows.filter((r) => r[0] === 'REVIEW_EVENT' && r[idx('metric')] === 'NOTE');
  const texts = evRows.map((r) => r[idx('text')]);
  for (const t of texts) assert.doesNotMatch(t, /^[=+\-@\t\r]/, `unsafe cell ${JSON.stringify(t)}`);
  assert.ok(texts.includes("'=HYPERLINK(\"http://x\",\"y\")"));
  assert.ok(texts.includes("'\rCR"));
  assert.ok(texts.includes('quote " comma , newline\nline2 ünïcødé ✓ <script>alert(1)</script>'));
  // Typed numeric cells stay numeric (negative due allowed by design), every row same width.
  for (const r of rows.slice(1)) {
    assert.equal(r.length, header.length);
    if (r[idx('amount_usd')] !== '') assert.match(r[idx('amount_usd')], /^-?\d+\.\d{2}$/);
    if (r[idx('rule_version')] !== '') assert.match(r[idx('rule_version')], /^\d+$/);
  }
  const due = rows.find((r) => r[0] === 'TOTAL' && r[idx('metric')] === 'calculatedCurrentDue');
  assert.equal(due[idx('amount_usd')], '45000.00');
  assert.ok(rows.every((r) => r[idx('data_classification')] === 'SYNTHETIC' || r === header));
  // JSON keeps original text (CSV prefix is one-way).
  const parsed = ok(E.parseReportJson(E.serializeReportJson(report)));
  assert.ok(parsed.reviewEvents.some((e) => e.note === '=HYPERLINK("http://x","y")'));
});

test('report JSON round-trips exactly and parse is strict', async () => {
  const a = ok(run());
  const hash = await E.computeSemanticHash(a);
  const report = E.buildReport({ analysis: a, semanticHash: hash, priorAnalyses: [], reviewEvents: [], generatedAt: '2026-11-03T16:00:00Z' });
  const text = E.serializeReportJson(report);
  assert.ok(text.endsWith('}\n'));
  const back = ok(E.parseReportJson(text));
  assert.deepEqual(back, report);
  assert.equal(back.totals.revisedContractCents, 16000000);
  assert.equal(back.ids.applicationId, 'PG-A-003');
  assert.equal(back.syntheticLabel, 'SYNTHETIC DEMO DATA - fictional parties and illustrative contract conditions; not legal advice or a legal determination.');
  assert.equal(E.serializeReportJson(back), text, 'canonical serialization is stable');
  const obj = JSON.parse(text);
  for (const mutate of [(o) => { o.extra = 1; }, (o) => { o.reportSchemaVersion = 'x'; }, (o) => { delete o.syntheticLabel; },
    (o) => { o.totals.calculatedCurrentDueCents = 4500000.5; }, (o) => { o.dataClassification = 'REAL'; }]) {
    const c = structuredClone(obj); mutate(c);
    assert.equal(E.parseReportJson(JSON.stringify(c)).ok, false);
  }
  assert.equal(E.parseReportJson('not json').ok, false);
});

// ---- 9. Determinism ------------------------------------------------------------------------
test('row/array order and key order do not change results or semantic hash', async () => {
  const a1 = ok(run());
  const b = bundle(); b.sovLines.reverse(); b.changeOrders.reverse(); b.documents.reverse();
  const app = rawApp(); app.lines.reverse();
  const reordered = Object.fromEntries(Object.entries(app).reverse());
  const a2 = ok(run(b, reordered));
  assert.deepEqual(a2.totals, a1.totals);
  assert.deepEqual(a2.findings, a1.findings);
  assert.equal(await E.computeSemanticHash(a2), await E.computeSemanticHash(a1));
  assert.match(await E.computeSemanticHash(a1), /^[0-9a-f]{64}$/);
});

test('semantic hash changes with semantic input; import batch id is content-addressed', async () => {
  const app = rawApp(); app.claimedCurrentDue = '45000.00';
  assert.notEqual(await E.computeSemanticHash(ok(run(bundle(), app))), await E.computeSemanticHash(ok(run())));
  const bytes = readBytes('pg-syn-001.application.json');
  const id1 = await E.computeImportBatchId(bytes);
  assert.match(id1, /^IB-[0-9a-f]{16}$/);
  assert.equal(await E.computeImportBatchId(bytes.slice()), id1, 'reimport is idempotent');
  assert.notEqual(await E.computeImportBatchId(readBytes('pg-syn-001.application.csv')), id1);
});

test('analysis and report snapshots are immutable and isolated from later input mutation', async () => {
  const b = bundle();
  const imported = importJson(rawApp());
  const a = ok(E.analyze({ bundle: b, imported }));
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.totals) && Object.isFrozen(a.canonicalInput.bundle.sovLines[0]));
  b.sovLines[0].originalValueCents = 1;
  b.priorPayments[0].amountCents = 0;
  assert.equal(a.canonicalInput.bundle.sovLines.find((l) => l.lineId === 'L1').originalValueCents, 10000000);
  const report = E.buildReport({ analysis: a, semanticHash: await E.computeSemanticHash(a), priorAnalyses: [], reviewEvents: [], generatedAt: '2026-11-03T16:00:00Z' });
  assert.ok(Object.isFrozen(report.totals));
  assert.throws(() => { 'use strict'; report.totals.calculatedCurrentDueCents = 0; });
  assert.equal(report.totals.calculatedCurrentDueCents, 4500000);
});
