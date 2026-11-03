// Engine-level integration journey (spec test 7 minus UI). No UI/E2E exists yet: browser,
// keyboard, axe and Playwright coverage remain OPEN gaps (see fixtures/payguard/README.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../packages/payguard-engine/src/index.js';
import { bundle, readBytes, readJson, parseCsv } from './helpers.js';

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.value; };

test('import -> analyze -> correct -> rerun -> review -> export -> parse export', async () => {
  // 1. Import CSV upload with content-addressed batch id.
  const bytes = readBytes('pg-syn-001.application.csv');
  const importBatchId = await E.computeImportBatchId(bytes);
  const imported = ok(E.parseApplicationCsv(bytes, { importBatchId, sourceName: 'pg-syn-001.application.csv' }));
  assert.equal(imported.importBatch.importBatchId, importBatchId);
  const seeded = ok(E.validateProjectBundle(bundle()));

  // 2. Analyze original.
  const first = ok(E.analyze({ bundle: seeded, imported }));
  const firstHash = await E.computeSemanticHash(first);
  assert.equal(first.readiness, 'NOT_READY');
  const waiverId = first.findings.find((f) => f.code === 'MISSING_REQUIRED_SIGNED_WAIVER').findingId;
  const mismatchId = first.findings.find((f) => f.code === 'CLAIMED_DUE_MISMATCH').findingId;
  let history = ok(E.appendReviewEvent([], { eventId: 'EV-001', sequence: 1, type: 'ANALYSIS_RUN', analysisHash: firstHash, actor: 'demo-reviewer', occurredAt: '2026-11-03T14:00:00Z' }));
  history = ok(E.appendReviewEvent(history, { eventId: 'EV-002', sequence: 2, type: 'DISPOSITION', analysisHash: firstHash, findingId: waiverId, disposition: 'CORRECTION_SUBMITTED', note: 'Requested signed October waiver from fictional vendor.', actor: 'demo-reviewer', occurredAt: '2026-11-03T14:05:00Z' }));

  // Append-only guards.
  assert.equal(E.appendReviewEvent(history, { eventId: 'EV-003', sequence: 2, type: 'NOTE', analysisHash: firstHash, findingId: waiverId, note: 'x', actor: 'demo-reviewer', occurredAt: '2026-11-03T14:06:00Z' }).ok, false, 'non-increasing sequence');
  assert.equal(E.appendReviewEvent(history, { eventId: 'EV-003', sequence: 3, type: 'NOTE', analysisHash: firstHash, findingId: waiverId, note: 'x'.repeat(2001), actor: 'demo-reviewer', occurredAt: '2026-11-03T14:06:00Z' }).ok, false, 'note too long');
  assert.equal(E.appendReviewEvent(history, { eventId: 'EV-003', sequence: 3, type: 'DISPOSITION', analysisHash: firstHash, findingId: waiverId, disposition: 'RESOLVED', actor: 'demo-reviewer', occurredAt: '2026-11-03T14:06:00Z' }).ok, false, 'no resolve/dismiss disposition');
  assert.equal(E.appendReviewEvent(history, { eventId: 'EV-003', sequence: 3, type: 'NOTE', analysisHash: firstHash, findingId: 'NOPE', note: 'x', actor: 'demo-reviewer', occurredAt: '2026-11-03T14:06:00Z' }, { findingIds: first.findings.map((f) => f.findingId) }).ok, false, 'unknown finding id');
  assert.ok(Object.isFrozen(history));
  assert.equal(history.length, 2);

  // 3. Correct: attach signed October waiver and set claim to $45,000.00; rerun.
  const corrected = bundle();
  corrected.documents.push(readJson('pg-syn-001.corrected-waiver.document.json'));
  const fixedBytes = readBytes('pg-syn-001.corrected.application.json');
  const fixedImport = ok(E.parseApplicationJson(fixedBytes, { importBatchId: await E.computeImportBatchId(fixedBytes), sourceName: 'corrected.json' }));
  const second = ok(E.analyze({ bundle: corrected, imported: fixedImport }));
  const secondHash = await E.computeSemanticHash(second);
  assert.notEqual(secondHash, firstHash);
  assert.equal(second.totals.calculatedCurrentDueCents, 4500000);
  assert.equal(second.totals.claimDiscrepancyCents, 0);
  assert.deepEqual(second.findings.map((f) => f.code), ['PENDING_CHANGE_ORDER_CONTEXT']);
  assert.equal(second.readiness, 'NO_BLOCKING_FINDINGS');
  history = ok(E.appendReviewEvent(history, { eventId: 'EV-003', sequence: 3, type: 'ANALYSIS_RUN', analysisHash: secondHash, actor: 'demo-reviewer', occurredAt: '2026-11-03T15:00:00Z' }));

  // 4. Export report with derived statuses (resolution only via rerun).
  const report = E.buildReport({ analysis: second, semanticHash: secondHash, priorAnalyses: [{ analysis: first, semanticHash: firstHash }], reviewEvents: history, generatedAt: '2026-11-03T15:30:00Z' });
  const status = Object.fromEntries(report.findingStatuses.map((s) => [s.findingId, s]));
  assert.equal(status[waiverId].status, 'NOT_PRESENT_IN_LATEST_RUN');
  assert.equal(status[waiverId].firstSeenAnalysisHash, firstHash);
  assert.equal(status[waiverId].lastSeenAnalysisHash, firstHash);
  assert.equal(status[mismatchId].status, 'NOT_PRESENT_IN_LATEST_RUN');
  assert.ok(report.findingStatuses.some((s) => s.status === 'OPEN'));
  assert.equal(report.reviewEvents.length, 3);
  assert.equal(report.reviewEvents[1].findingId, waiverId, 'original finding remains traceable in history');

  // 5. Parse exports.
  const json = E.serializeReportJson(report);
  const back = ok(E.parseReportJson(json));
  assert.deepEqual(back, report);
  assert.equal(back.semanticHash, secondHash);
  assert.deepEqual(back.ruleVersions, report.ruleVersions);
  const rows = parseCsv(E.serializeReportCsv(report));
  const h = rows[0];
  const total = (m) => rows.find((r) => r[0] === 'TOTAL' && r[h.indexOf('metric')] === m)[h.indexOf('amount_usd')];
  assert.equal(total('revisedContract'), '160000.00');
  assert.equal(total('calculatedCurrentDue'), '45000.00');
  assert.equal(total('claimDiscrepancy'), '0.00');
  assert.ok(rows.slice(1).every((r) => r[h.indexOf('semantic_hash')] === secondHash));
});
