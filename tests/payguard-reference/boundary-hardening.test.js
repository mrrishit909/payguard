// Regression tests for audit findings PG-AUD-01..04 (untrusted report, imported envelope,
// own-property schema membership, calendar/time-valid UTC timestamps). SYNTHETIC data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../packages/payguard-engine/src/index.js';
import { bundle, rawApp, jsonBytes, META } from './helpers.js';

const GENERATED_AT = '2026-11-03T00:00:00Z';
const json = (v) => JSON.parse(JSON.stringify(v));

function importedApp() {
  const r = E.parseApplicationJson(jsonBytes(rawApp()), META);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value;
}

async function validReport() {
  const analysis = E.analyze({ bundle: bundle(), imported: importedApp() }).value;
  const semanticHash = await E.computeSemanticHash(analysis);
  const run = E.appendReviewEvent([], { eventId: 'EV-1', sequence: 1, type: 'ANALYSIS_RUN', analysisHash: semanticHash, actor: 'demo-reviewer', occurredAt: '2026-11-03T09:00:00.125Z' }).value;
  const f = analysis.findings[0].findingId;
  const events = E.appendReviewEvent(run, { eventId: 'EV-2', sequence: 2, type: 'NOTE', analysisHash: semanticHash, findingId: f, note: '=SUM(A1) is inert text', actor: 'demo-reviewer', occurredAt: '2028-02-29T23:59:59Z' }, { findingIds: [f] }).value;
  return E.buildReport({ analysis, semanticHash, reviewEvents: events, generatedAt: GENERATED_AT });
}

/** Parses a mutated copy of a valid report; the parser must not throw and must fail with no value. */
function assertRejected(report, mutate, label) {
  const r = json(report);
  mutate(r);
  let parsed;
  assert.doesNotThrow(() => { parsed = E.parseReportJson(JSON.stringify(r)); }, label);
  assert.equal(parsed.ok, false, `${label} should be rejected`);
  assert.ok(!('value' in parsed), label);
  assert.ok(parsed.errors.length > 0 && typeof parsed.errors[0].code === 'string', label);
}

test('PG-AUD-01: valid report still round-trips exactly and exports CSV', async () => {
  const report = await validReport();
  const text = E.serializeReportJson(report);
  const parsed = E.parseReportJson(text);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.deepEqual(parsed.value, report);
  assert.equal(E.serializeReportJson(parsed.value), text);
  assert.equal(E.serializeReportCsv(parsed.value), E.serializeReportCsv(report));
  assert.equal(parsed.value.totals.calculatedCurrentDueCents, 4500000);
  assert.equal(parsed.value.totals.claimDiscrepancyCents, 500000);
});

test('PG-AUD-01: malformed nested report structures return failures, never throw', async () => {
  const report = await validReport();
  const cases = {
    'lines null entry': (r) => { r.lines = [null]; },
    'ruleVersions null entry': (r) => { r.ruleVersions = [null]; },
    'ruleEvaluations null entry': (r) => { r.ruleEvaluations = [null]; },
    'findings null entry': (r) => { r.findings = [null]; },
    'findingStatuses null entry': (r) => { r.findingStatuses = [null]; },
    'reviewEvents null entry': (r) => { r.reviewEvents = [null]; },
    'provenance null entry': (r) => { r.provenance = [null]; },
    'limitations null entry': (r) => { r.limitations = [null]; },
    'ids null': (r) => { r.ids = null; },
    'ids missing applicationId': (r) => { delete r.ids.applicationId; },
    'ids invalid importBatchId': (r) => { r.ids.importBatchId = '../etc'; },
    'period null': (r) => { r.period = null; },
    'period impossible date': (r) => { r.period.periodEnd = '2026-02-30'; },
    'approval readiness': (r) => { r.readiness = 'APPROVED'; },
    'INVALID_INPUT readiness on a report': (r) => { r.readiness = 'INVALID_INPUT'; },
    'impossible generatedAt': (r) => { r.generatedAt = '2026-99-99T99:99:99Z'; },
    'hour 24 generatedAt': (r) => { r.generatedAt = '2026-11-03T24:00:00Z'; },
    'unknown finding severity': (r) => { r.findings[0].severity = 'CRITICAL'; },
    'unknown finding code': (r) => { r.findings[0].code = 'COMPLIANT'; },
    'finding subject null': (r) => { r.findings[0].subject = null; },
    'finding inputRefs null entry': (r) => { r.findings[0].inputRefs = [null]; },
    'finding observed nested object': (r) => { r.findings[0].observed = { x: { deep: true } }; },
    'finding id does not match identity': (r) => { r.findings[0].findingId = 'NONEXISTENT'; },
    'finding unknown field': (r) => { r.findings[0].approved = true; },
    'rule evaluation outcome': (r) => { r.ruleEvaluations[0].outcome = 'COMPLIANT'; },
    'rejected candidate reason': (r) => { r.findings.find((f) => f.rejectedCandidates).rejectedCandidates[0].reasons = ['FORGED']; },
    'finding status enum': (r) => { r.findingStatuses[0].status = 'RESOLVED'; },
    'review event forged sequence': (r) => { r.reviewEvents[1].sequence = 1; },
    'review event impossible time': (r) => { r.reviewEvents[0].occurredAt = '2026-02-29T00:00:00Z'; },
    'provenance missing entry': (r) => { r.provenance.pop(); },
    'provenance wrong batch': (r) => { r.provenance[0].sourceId = 'IB-OTHER'; },
    'provenance oversize raw value': (r) => { r.provenance[0].rawValue = 'x'.repeat(501); },
    'limitations altered': (r) => { r.limitations = ['Approved and compliant.']; },
    'own __proto__ key': (r) => { Object.defineProperty(r.totals, '__proto__', { value: 1, enumerable: true, configurable: true, writable: true }); },
    'totals not internally consistent': (r) => { r.totals.calculatedCurrentDueCents = 1; },
    'line not internally consistent': (r) => { r.lines[0].grossEarnedToDateCents += 1; },
    'line sum differs from totals': (r) => { r.lines[0].storedToDateCents += 1; r.lines[0].grossEarnedToDateCents += 1; r.lines[0].netEarnedToDateCents += 1; },
    'readiness contradicts blocking findings': (r) => { r.readiness = 'NO_BLOCKING_FINDINGS'; },
    'reviewer forged combination': (r) => { r.readiness = 'APPROVED'; r.ids = null; r.findings = []; r.totals.calculatedCurrentDueCents = 1; },
  };
  for (const [label, mutate] of Object.entries(cases)) assertRejected(report, mutate, label);
});

test('PG-AUD-01: report rejects own constructor/toString keys and non-string input', async () => {
  const report = await validReport();
  assertRejected(report, (r) => { r.toString = 'x'; }, 'top-level toString');
  assertRejected(report, (r) => { r.ids.constructor = 'x'; }, 'ids constructor');
  for (const bad of [null, undefined, 42, {}, 'null', '[]', '"x"']) {
    let parsed;
    assert.doesNotThrow(() => { parsed = E.parseReportJson(bad); });
    assert.equal(parsed.ok, false);
  }
});

test('PG-AUD-02: analyze rejects incomplete or malformed imported envelopes before any totals', () => {
  const good = json(importedApp());
  const cases = {
    'missing importBatch, empty provenance': (x) => { delete x.importBatch; x.provenance = []; },
    'missing importBatch': (x) => { delete x.importBatch; },
    'empty provenance': (x) => { x.provenance = []; },
    'provenance null entry': (x) => { x.provenance[0] = null; },
    'provenance references unknown line': (x) => { x.provenance.find((p) => p.ref.entity === 'applicationLine').ref.id = 'L-NOPE'; },
    'provenance raw value contradicts canonical value': (x) => { x.provenance.find((p) => p.ref.field === 'claimedCurrentDueCents').rawValue = '1.00'; },
    'provenance duplicate entry': (x) => { x.provenance.push(x.provenance[0]); },
    'provenance sourceId differs from batch': (x) => { x.provenance[0].sourceId = 'IB-OTHER'; },
    'provenance oversize column': (x) => { x.provenance[0].jsonPointer = '/'.repeat(501); },
    'importBatch bad id': (x) => { x.importBatch.importBatchId = '../x'; },
    'importBatch oversize sourceName': (x) => { x.importBatch.sourceName = 's'.repeat(501); },
    'importBatch unknown format': (x) => { x.importBatch.sourceFormat = 'xlsx'; },
    'importBatch negative byteLength': (x) => { x.importBatch.byteLength = -1; },
    'importBatch unknown field': (x) => { x.importBatch.trusted = true; },
    'envelope unknown field': (x) => { x.verified = true; },
    'application unknown field': (x) => { x.application.retainageOverride = 0; },
    'application line null': (x) => { x.application.lines = [null]; },
    'application no lines': (x) => { x.application.lines = []; },
    'application impossible reviewDate': (x) => { x.application.reviewDate = '2026-13-01'; },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const x = json(good);
    mutate(x);
    let r;
    assert.doesNotThrow(() => { r = E.analyze({ bundle: bundle(), imported: x }); }, label);
    assert.equal(r.ok, false, `${label} should be rejected`);
    assert.ok(!('value' in r) && !('totals' in r), label);
  }
  // JSON-deserialized (not parser-produced, not frozen) canonical envelope remains accepted.
  const r = E.analyze({ bundle: bundle(), imported: json(good) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value.totals.calculatedCurrentDueCents, 4500000);
});

test('PG-AUD-02: inherited/non-plain imported envelopes are rejected without throwing', () => {
  const good = importedApp();
  for (const x of [Object.create(good), { ...good, application: Object.create(good.application) }, new Map(), [good]]) {
    let r;
    assert.doesNotThrow(() => { r = E.analyze({ bundle: bundle(), imported: x }); });
    assert.equal(r.ok, false);
  }
});

test('PG-AUD-03: bundle schema uses own-property membership and plain objects only', () => {
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    const b = JSON.parse(JSON.stringify(bundle()).replace('{', `{"${key}":"unexpected",`));
    assert.ok(Object.hasOwn(b, key), key);
    const r = E.validateProjectBundle(b);
    assert.equal(r.ok, false, key);
    assert.ok(r.errors.some((e) => e.code === 'UNKNOWN_FIELD'), key);
  }
  const nested = bundle();
  nested.sovLines[0].valueOf = 'x';
  assert.equal(E.validateProjectBundle(nested).ok, false);
  const inheritedCases = [
    Object.create(bundle()),
    { ...bundle(), contract: Object.create(bundle().contract) },
    { ...bundle(), sovLines: bundle().sovLines.map((l) => Object.create(l)) },
  ];
  for (const b of inheritedCases) {
    let r;
    assert.doesNotThrow(() => { r = E.validateProjectBundle(b); });
    assert.equal(r.ok, false);
    assert.ok(!('value' in r));
  }
  assert.equal(E.validateProjectBundle(bundle()).ok, true);
});

test('PG-AUD-04: review and report timestamps must be calendar- and clock-valid UTC', async () => {
  const base = { eventId: 'E1', sequence: 1, type: 'ANALYSIS_RUN', analysisHash: 'a'.repeat(64), actor: 'demo-reviewer' };
  for (const occurredAt of ['2026-99-99T99:99:99Z', '2026-02-29T12:00:00Z', '2026-11-03T24:00:00Z', '2026-11-03T12:60:00Z',
    '2026-11-03T12:00:60Z', '2026-04-31T00:00:00Z', '0000-01-01T00:00:00Z', '2026-11-03T12:00:00+00:00', '2026-11-03 12:00:00Z']) {
    assert.equal(E.appendReviewEvent([], { ...base, occurredAt }).ok, false, occurredAt);
  }
  for (const occurredAt of ['2028-02-29T23:59:59Z', '2000-02-29T00:00:00.5Z', '2026-11-03T00:00:00.000Z', '2026-12-31T23:59:59.999Z']) {
    const r = E.appendReviewEvent([], { ...base, occurredAt });
    assert.equal(r.ok, true, occurredAt);
    assert.equal(r.value[0].occurredAt, occurredAt); // explicit fractional seconds preserved verbatim
  }
  const analysis = E.analyze({ bundle: bundle(), imported: importedApp() }).value;
  const semanticHash = await E.computeSemanticHash(analysis);
  assert.throws(() => E.buildReport({ analysis, semanticHash, generatedAt: '2026-02-30T00:00:00Z' }), TypeError);
  assert.equal(E.buildReport({ analysis, semanticHash, generatedAt: '2028-02-29T12:00:00.25Z' }).generatedAt, '2028-02-29T12:00:00.25Z');
});

test('appendReviewEvent rejects malformed history entries and non-plain events without throwing', () => {
  const ev = { eventId: 'E2', sequence: 2, type: 'ANALYSIS_RUN', analysisHash: 'a'.repeat(64), actor: 'demo-reviewer', occurredAt: GENERATED_AT };
  for (const [history, event] of [[[null], ev], [[{}], ev], [[], Object.create(ev)], [[], new Date()]]) {
    let r;
    assert.doesNotThrow(() => { r = E.appendReviewEvent(history, event); });
    assert.equal(r.ok, false);
  }
});

test('PG-AUD-05: non-string provenance ref fields fail before key interpolation at both boundaries', async () => {
  const good = json(importedApp());
  const report = await validReport();
  const values = { number: 7, boolean: true, null: null, array: ['L-1'], object: {}, 'toString-null': { toString: null } };
  for (const field of ['entity', 'id', 'field']) {
    for (const [kind, value] of Object.entries(values)) {
      const label = `ref.${field} ${kind}`;
      const x = json(good);
      x.provenance[0].ref[field] = value;
      let r;
      assert.doesNotThrow(() => { r = E.analyze({ bundle: bundle(), imported: x }); }, label);
      assert.equal(r.ok, false, `${label} should be rejected`);
      assert.ok(!('value' in r) && r.errors.some((e) => e.code === 'UNKNOWN_REFERENCE' && e.path === '/imported/provenance/0'), label);
      assertRejected(report, (rep) => { rep.provenance[0].ref[field] = value; }, `report ${label}`);
    }
  }
});
