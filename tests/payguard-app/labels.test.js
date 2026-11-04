// Regression tests for two browser defects: evidence labels that said "Cents" beside formatted
// dollar values, and landing proof slots looked up outside the element that contains them.
// Node-level only; the rendered pages are exercised by tests/e2e/browser-qa.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as engine from '../../packages/payguard-engine/src/index.js';
import { IMPORT_LIMITS } from '../../packages/contracts/src/index.js';
import { createWorkflow } from '../../apps/payguard/src/assets/workflow.js';
import { FIELD_TEXT, fieldText } from '../../apps/payguard/src/assets/labels.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const fx = (n) => new URL(`../../fixtures/payguard/${n}`, import.meta.url);
const json = (n) => JSON.parse(readFileSync(fx(n), 'utf8'));
const file = (n) => { const bytes = new Uint8Array(readFileSync(fx(n))); return { bytes, size: bytes.length, name: n }; };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.value; };

function assertReadable(k) {
  const label = fieldText(k);
  assert.ok(!/cents/i.test(label), `${k} label "${label}" mentions cents`);
  if (k.endsWith('Cents')) assert.match(label, /, USD$/, `${k} is shown as dollars, so its label must say USD`);
}

test('every observed/expected key the engine can emit has an explicit readable label', () => {
  const blocks = [...src('packages/payguard-engine/src/analyze.js').matchAll(/\b(?:observed|expected): \{([^}]*)\}/g)];
  assert.ok(blocks.length >= 10, `expected the engine's finding literals, found ${blocks.length}`);
  const keys = new Set(blocks.flatMap((b) => b[1].split(',').map((p) => p.match(/^\s*(\w+)\s*:/)?.[1]).filter(Boolean)));
  for (const k of keys) {
    assert.ok(Object.hasOwn(FIELD_TEXT, k), `no explicit label for engine key ${k}`);
    assertReadable(k);
  }
  assertReadable('someFutureAmountCents');
  assert.equal(fieldText('someFutureAmountCents'), 'Some future amount, USD');
  assert.equal(fieldText('someFlag'), 'Some flag');
});

test('sample runs: shown labels are readable while JSON and CSV exports keep machine amounts', async () => {
  let t = 0;
  const wf = createWorkflow({ engine, limits: IMPORT_LIMITS, now: () => `2026-11-03T14:${String(t++).padStart(2, '0')}:00Z` });
  ok(wf.setSeed(json('pg-syn-001.bundle.json'), json('pg-syn-001.corrected-waiver.document.json')));
  const r1 = ok(await wf.importFile(file('pg-syn-001.application.json')));
  ok(wf.stageClaim('45000.00'));
  ok(wf.stageWaiver());
  const r2 = ok(await wf.rerun());
  for (const f of [...r1.analysis.findings, ...r2.analysis.findings]) {
    for (const k of [...Object.keys(f.observed), ...Object.keys(f.expected)]) assertReadable(k);
  }

  const report = ok(engine.parseReportJson(ok(wf.exportReport(1, 'json')).text));
  const mismatch = report.findings.find((f) => f.code === 'CLAIMED_DUE_MISMATCH');
  assert.deepEqual(mismatch.observed, { claimedCurrentDueCents: 5000000, claimDiscrepancyCents: 500000 });
  assert.deepEqual(mismatch.expected, { calculatedCurrentDueCents: 4500000, toleranceCents: 0 });
  assert.equal(report.totals.claimDiscrepancyCents, 500000);

  const rows = ok(wf.exportReport(1, 'csv')).text.split('\n');
  const header = rows[0].split(',').map((c) => c.replaceAll('"', ''));
  const total = (metric) => rows.map((r) => r.split(',').map((c) => c.replaceAll('"', '')))
    .find((c) => c[header.indexOf('record_type')] === 'TOTAL' && c[header.indexOf('metric')] === metric);
  assert.equal(total('claimDiscrepancy')[header.indexOf('amount_usd')], '5000.00');
  assert.equal(total('calculatedCurrentDue')[header.indexOf('amount_usd')], '45000.00');
});

// Text-only HTML scan: returns the markup of the element with this id, nested same-name tags included.
function elementById(html, id) {
  const open = html.match(new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(open, `#${id} not found`);
  const tag = open[1];
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = open.index + open[0].length;
  for (let depth = 1, m; (m = re.exec(html));) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(open.index, m.index);
  }
  assert.fail(`#${id} is not closed`);
}

test('landing proof slots all exist once inside the element the script searches', () => {
  const js = src('apps/payguard/src/assets/landing.js');
  const html = src('apps/payguard/src/index.html');
  const slots = JSON.parse(js.match(/const SLOTS = (\[[^\]]*\]);/)[1].replaceAll("'", '"'));
  const scope = js.match(/const slot = \(name\) => \$\(`#([\w-]+) \[data-f=/)?.[1];
  assert.ok(scope, 'landing.js slot lookup scope not found; update this test with the new lookup');
  const within = elementById(html, scope);
  const count = (text, name) => text.split(`data-f="${name}"`).length - 1;
  for (const name of slots) {
    assert.equal(count(html, name), 1, `data-f="${name}" must appear exactly once on the page`);
    assert.equal(count(within, name), 1, `data-f="${name}" is outside #${scope}, where landing.js looks for it`);
  }
  const declared = new Set(slots);
  for (const [, name] of html.matchAll(/data-f="([\w-]+)"/g)) assert.ok(declared.has(name), `data-f="${name}" is never filled`);
  // The method section holds the clause and limitations; the original defect searched only #proof.
  assert.ok(!elementById(html, 'proof').includes('data-f="clause"'));
  assert.equal(count(elementById(html, 'method'), 'clause'), 1);
});
