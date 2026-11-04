// Reviewer workflow (apps/payguard/src/assets/workflow.js) driven through the real engine.
// Node-level only: browser, keyboard, axe and visual checks are NOT covered here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as engine from '../../packages/payguard-engine/src/index.js';
import { IMPORT_LIMITS } from '../../packages/contracts/src/index.js';
import { createWorkflow, groupDigits } from '../../apps/payguard/src/assets/workflow.js';

const fx = (n) => new URL(`../../fixtures/payguard/${n}`, import.meta.url);
const json = (n) => JSON.parse(readFileSync(fx(n), 'utf8'));
const file = (n, name = n) => { const bytes = new Uint8Array(readFileSync(fx(n))); return { bytes, size: bytes.length, name }; };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.value; };

function setup() {
  let t = 0;
  const wf = createWorkflow({ engine, limits: IMPORT_LIMITS, now: () => `2026-11-03T14:${String(t++).padStart(2, '0')}:00Z` });
  ok(wf.setSeed(json('pg-syn-001.bundle.json'), json('pg-syn-001.corrected-waiver.document.json')));
  return wf;
}

test('groupDigits formats engine strings only', () => {
  assert.equal(groupDigits('4500000.00'), '4,500,000.00');
  assert.equal(groupDigits('-500.00'), '-500.00');
  assert.equal(groupDigits('0.02'), '0.02');
  assert.equal(groupDigits('160000.00'), '160,000.00');
});

test('full journey: import, correct, rerun, review, export; original run stays inspectable', async () => {
  const wf = setup();
  const r1 = ok(await wf.importFile(file('pg-syn-001.application.csv')));
  assert.equal(r1.analysis.totals.claimDiscrepancyCents, 500000);
  assert.equal(r1.analysis.totals.calculatedCurrentDueCents, 4500000);
  const codes = r1.analysis.findings.map((f) => f.code);
  assert.deepEqual(codes, ['CLAIMED_DUE_MISMATCH', 'MISSING_REQUIRED_SIGNED_WAIVER', 'PENDING_CHANGE_ORDER_CONTEXT']);
  const waiver = r1.analysis.findings[1].findingId;

  ok(wf.addReview({ runIndex: 1, findingId: waiver, disposition: 'CORRECTION_SUBMITTED', note: '<img src=x onerror=alert(1)>' }));
  assert.equal(wf.addReview({ runIndex: 1, findingId: 'NOPE', note: 'x' }).ok, false, 'unknown finding id rejected via referenced analysis');
  assert.equal(wf.addReview({ runIndex: 1, findingId: waiver, note: '   ' }).ok, false, 'empty review rejected');

  assert.equal(wf.stageClaim('45,000').ok, false, 'separators rejected by engine');
  ok(wf.stageClaim('45000.00'));
  ok(wf.stageWaiver());
  const r2 = ok(await wf.rerun());
  assert.equal(r2.index, 2);
  assert.equal(r2.analysis.totals.claimDiscrepancyCents, 0);
  assert.deepEqual(r2.analysis.findings.map((f) => f.code), ['PENDING_CHANGE_ORDER_CONTEXT']);
  assert.equal(r2.analysis.readiness, 'NO_BLOCKING_FINDINGS');
  assert.equal(wf.stageWaiver().ok, false, 'cannot attach twice');

  // Original run is unchanged and still reportable.
  assert.equal(wf.state.runs[0].analysis.totals.claimDiscrepancyCents, 500000);
  const st = wf.statuses(2);
  assert.equal(st.get(waiver).status, 'NOT_PRESENT_IN_LATEST_RUN');

  // Repeated rerun keeps appending history.
  const r3 = ok(await wf.rerun());
  assert.equal(r3.index, 3);
  assert.equal(r3.semanticHash, r2.semanticHash);
  assert.deepEqual(wf.state.history.map((e) => e.type), ['ANALYSIS_RUN', 'DISPOSITION', 'ANALYSIS_RUN', 'ANALYSIS_RUN']);

  for (const runIndex of [1, 3]) {
    const ex = ok(wf.exportReport(runIndex, 'json'));
    const back = ok(engine.parseReportJson(ex.text));
    assert.equal(back.reviewEvents[1].note, '<img src=x onerror=alert(1)>');
    const csv = ok(wf.exportReport(runIndex, 'csv'));
    assert.match(csv.text, /^"record_type","report_schema_version",/);
    assert.equal(csv.filename, `payguard-PG-A-003-run-${runIndex}.csv`);
  }
});

test('invalid and oversize imports leave the prior valid report intact', async () => {
  const wf = setup();
  ok(await wf.importFile(file('pg-syn-001.application.json')));
  const before = wf.state;
  const big = { size: IMPORT_LIMITS.MAX_UPLOAD_BYTES + 1, name: 'big.json', readBytes: () => { throw new Error('must not read'); } };
  const e1 = await wf.importFile(big);
  assert.equal(e1.ok, false);
  assert.equal(e1.errors[0].code, 'INPUT_TOO_LARGE');
  const bad = new TextEncoder().encode('{"schemaVersion":"payguard.application.v1"');
  const e2 = await wf.importFile({ bytes: bad, size: bad.length, name: 'bad.json' });
  assert.equal(e2.ok, false);
  const e3 = await wf.importFile({ bytes: bad, size: bad.length, name: 'notes.txt' });
  assert.equal(e3.errors[0].code, 'UNSUPPORTED_FORMAT');
  const e4 = await wf.importFile({ bytes: new Uint8Array(), size: 0, name: 'empty.csv' });
  assert.equal(e4.errors[0].code, 'EMPTY_FILE');
  assert.equal(wf.state, before);
  assert.equal(wf.state.runs.length, 1);
  assert.equal(wf.state.history.length, 1);
});

test('failed staged claim leaves draft and runs untouched; reset clears only local state', async () => {
  const wf = setup();
  assert.equal(wf.stageClaim('1').ok, false, 'needs an import first');
  ok(await wf.importFile(file('pg-syn-001.application.json')));
  assert.equal(wf.stageClaim('1e5').ok, false);
  assert.equal(wf.state.draft, null);
  wf.reset();
  assert.equal(wf.state.runs.length, 0);
  assert.ok(wf.seedBundle, 'seed stays loaded');
});
