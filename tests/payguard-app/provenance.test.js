// Report provenance: only the bundled sample control path may be labelled bundled synthetic;
// any user-chosen file is unverified whatever its name or fields claim. Node-level only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as engine from '../../packages/payguard-engine/src/index.js';
import { IMPORT_LIMITS, SCHEMA_VERSIONS, APPLICATION_ORIGIN, APPLICATION_ORIGIN_LABEL, REAL_DATA_WARNING, SYNTHETIC_LABEL, CSV_EXPORT_COLUMNS } from '../../packages/contracts/src/index.js';
import { LIMITATIONS } from '../../packages/payguard-engine/src/report.js';
import { createWorkflow } from '../../apps/payguard/src/assets/workflow.js';
import { parseCsv } from '../payguard-reference/helpers.js';

const BUNDLED = 'BUNDLED_SYNTHETIC_SAMPLE';
const UNVERIFIED = 'UNVERIFIED_LOCAL_FILE';
const LEGACY = 'UNVERIFIED_LEGACY_REPORT';
const fx = (n) => new URL(`../../fixtures/payguard/${n}`, import.meta.url);
const bytesOf = (n) => new Uint8Array(readFileSync(fx(n)));
const json = (n) => JSON.parse(readFileSync(fx(n), 'utf8'));
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.value; };
const SAMPLES = Object.freeze({ json: 'pg-syn-001.application.json', csv: 'pg-syn-001.application.csv' });

function setup(extra = {}) {
  let t = 0;
  const loaded = [];
  const wf = createWorkflow({
    engine, limits: IMPORT_LIMITS, now: () => `2026-11-04T10:${String(t++).padStart(2, '0')}:00Z`,
    samples: SAMPLES, loadSample: async (name) => { loaded.push(name); return bytesOf(name); }, ...extra,
  });
  ok(wf.setSeed(json('pg-syn-001.bundle.json'), json('pg-syn-001.corrected-waiver.document.json')));
  return { wf, loaded };
}

/** Asserts the JSON and CSV exports of run `i` carry exactly this origin, its label and the warning. */
function assertExports(wf, i, origin) {
  const ex = ok(wf.exportReport(i, 'json'));
  const raw = JSON.parse(ex.text);
  assert.equal(raw.reportSchemaVersion, 'payguard.report.v2');
  assert.equal(raw.applicationOrigin, origin);
  assert.equal(raw.originLabel, APPLICATION_ORIGIN_LABEL[origin]);
  assert.equal(raw.originWarning, REAL_DATA_WARNING);
  assert.ok(!('dataClassification' in raw) && !('syntheticLabel' in raw), 'v2 report makes no unconditional synthetic claim');
  assert.ok(!ex.text.includes(SYNTHETIC_LABEL), 'the bundled-sample synthetic label is not stamped on the report');
  assert.deepEqual(ok(engine.parseReportJson(ex.text)), ex.report, 'v2 round-trips');

  const rows = parseCsv(ok(wf.exportReport(i, 'csv')).text);
  const [header, ...body] = rows;
  assert.deepEqual(header, [...CSV_EXPORT_COLUMNS]);
  assert.ok(!header.includes('data_classification'));
  const col = (c) => header.indexOf(c);
  assert.ok(body.every((r) => r[col('report_schema_version')] === 'payguard.report-csv.v2'));
  assert.ok(body.every((r) => r[col('application_origin')] === origin), 'every CSV row carries the origin');
  const meta = (m) => body.find((r) => r[col('record_type')] === 'META' && r[col('metric')] === m)?.[col('text')];
  assert.equal(meta('originLabel'), APPLICATION_ORIGIN_LABEL[origin]);
  assert.equal(meta('originWarning'), REAL_DATA_WARNING);
  assert.equal(meta('syntheticLabel'), undefined);
  return ex.report;
}

test('origin vocabulary: warning says real data is not detected or prevented', () => {
  assert.deepEqual(Object.values(APPLICATION_ORIGIN), [BUNDLED, UNVERIFIED, LEGACY]);
  assert.match(REAL_DATA_WARNING, /does not detect or prevent real data/);
  assert.match(APPLICATION_ORIGIN_LABEL[UNVERIFIED], /^Unverified origin/);
  assert.match(APPLICATION_ORIGIN_LABEL[LEGACY], /^Unverified origin/);
  assert.match(APPLICATION_ORIGIN_LABEL[BUNDLED], /^Bundled synthetic sample/);
  assert.equal(SCHEMA_VERSIONS.REPORT, 'payguard.report.v2');
  assert.equal(SCHEMA_VERSIONS.REPORT_CSV, 'payguard.report-csv.v2');
  assert.ok(LIMITATIONS.some((l) => /does not detect or prevent real data/.test(l)));
  assert.ok(!LIMITATIONS.some((l) => /synthetic demonstration data only/i.test(l)));
});

for (const format of ['json', 'csv']) {
  test(`bundled ${format.toUpperCase()} sample control path is labelled bundled synthetic in run and exports`, async () => {
    const { wf, loaded } = setup();
    const run = ok(await wf.importSample(format));
    assert.deepEqual(loaded, [SAMPLES[format]], 'bytes come from the injected bundled loader');
    assert.equal(run.origin, BUNDLED);
    assert.equal(wf.state.origin, BUNDLED);
    assert.equal(run.trigger, `Bundled sample ${format.toUpperCase()}`);
    assert.equal(run.analysis.totals.calculatedCurrentDueCents, 4500000);
    assertExports(wf, 1, BUNDLED);
  });

  test(`arbitrary ${format.toUpperCase()} file is unverified despite spoofed synthetic classification and sample name`, async () => {
    const { wf, loaded } = setup();
    const sampleBytes = bytesOf(SAMPLES[format]);
    // Byte-identical to the bundled sample, same file name, dataClassification SYNTHETIC, plus an
    // attempted origin override on the file object: still a user-chosen local file.
    const spoof = { bytes: sampleBytes, size: sampleBytes.length, name: SAMPLES[format], origin: BUNDLED, applicationOrigin: BUNDLED };
    const run = ok(await wf.importFile(spoof));
    assert.deepEqual(loaded, [], 'the bundled loader is not involved');
    assert.equal(run.origin, UNVERIFIED);
    assert.equal(wf.state.origin, UNVERIFIED);
    assert.match(run.trigger, /unverified origin/);
    const report = assertExports(wf, 1, UNVERIFIED);
    // The file's own classification claim survives only as raw provenance, never as the label.
    assert.ok(report.provenance.some((p) => p.ref.field === 'dataClassification' && p.rawValue === 'SYNTHETIC'));

    // Same bytes through the bundled path: identical calculation, different recorded origin.
    const b = setup();
    const bundledRun = ok(await b.wf.importSample(format));
    assert.equal(bundledRun.semanticHash, run.semanticHash, 'origin does not change the calculation');
    assert.deepEqual(bundledRun.analysis.totals, run.analysis.totals);
  });
}

test('crafted files named or shaped like synthetic samples stay unverified', async () => {
  const { wf } = setup();
  const app = json('pg-syn-001.application.json');
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  for (const name of ['bundled-synthetic-sample.json', 'SYNTHETIC.json', '../fixtures/payguard/pg-syn-001.application.json']) {
    const bytes = enc({ ...app, dataClassification: 'SYNTHETIC' });
    assert.equal(ok(await wf.importFile({ bytes, size: bytes.length, name })).origin, UNVERIFIED, name);
  }
  const csvText = readFileSync(fx(SAMPLES.csv), 'utf8');
  const csv = new TextEncoder().encode(csvText);
  assert.equal(ok(await wf.importFile({ bytes: csv, size: csv.length, name: 'pg-syn-001.application.csv', readBytes: () => csv })).origin, UNVERIFIED);
  assert.ok(wf.state.runs.every((r) => r.origin === UNVERIFIED));
  // The classification input gate is unchanged: a file declaring anything else is still rejected.
  const real = enc({ ...app, dataClassification: 'REAL' });
  const e = await wf.importFile({ bytes: real, size: real.length, name: 'real.json' });
  assert.equal(e.ok, false);
  assert.equal(e.errors[0].code, 'UNSUPPORTED_CLASSIFICATION');
});

test('corrections keep the origin of the application they correct', async () => {
  const bundled = setup().wf;
  ok(await bundled.importSample('json'));
  ok(bundled.stageClaim('45000.00'));
  assert.equal(ok(await bundled.rerun()).origin, BUNDLED);
  assertExports(bundled, 2, BUNDLED);

  const local = setup().wf;
  const b = bytesOf(SAMPLES.json);
  ok(await local.importFile({ bytes: b, size: b.length, name: SAMPLES.json }));
  ok(local.stageClaim('45000.00'));
  ok(local.stageWaiver());
  const r2 = ok(await local.rerun());
  assert.equal(r2.origin, UNVERIFIED);
  assert.equal(r2.analysis.readiness, 'NO_BLOCKING_FINDINGS');
  assertExports(local, 2, UNVERIFIED);

  // A later local import replaces a bundled one and its origin.
  ok(await bundled.importFile({ bytes: b, size: b.length, name: SAMPLES.json }));
  assert.equal(bundled.state.origin, UNVERIFIED);
  assert.deepEqual(bundled.state.runs.map((r) => r.origin), [BUNDLED, BUNDLED, UNVERIFIED]);
  assertExports(bundled, 1, BUNDLED);
  assertExports(bundled, 3, UNVERIFIED);
});

test('importSample accepts only the configured sample keys and needs the bundled loader', async () => {
  const { wf, loaded } = setup();
  for (const key of ['xml', '__proto__', 'constructor', 'pg-syn-001.application.json', undefined]) {
    const r = await wf.importSample(key);
    assert.equal(r.ok, false, String(key));
    assert.equal(r.errors[0].code, 'NOT_READY');
  }
  assert.deepEqual(loaded, []);
  assert.equal(wf.state.runs.length, 0);
  const bare = createWorkflow({ engine, limits: IMPORT_LIMITS, now: () => '2026-11-04T10:00:00Z' });
  ok(bare.setSeed(json('pg-syn-001.bundle.json')));
  assert.equal((await bare.importSample('json')).ok, false, 'no loader, no bundled label');
});

test('engine report origin: defaults to unverified and refuses legacy or unknown origins', async () => {
  const { wf } = setup();
  const run = ok(await wf.importSample('json'));
  const args = { analysis: run.analysis, semanticHash: run.semanticHash, generatedAt: '2026-11-04T10:00:00Z' };
  assert.equal(engine.buildReport(args).applicationOrigin, UNVERIFIED, 'no caller claim means unverified');
  assert.equal(engine.buildReport({ ...args, applicationOrigin: BUNDLED }).applicationOrigin, BUNDLED);
  for (const bad of [LEGACY, 'SYNTHETIC', 'REAL', null]) {
    assert.throws(() => engine.buildReport({ ...args, applicationOrigin: bad }), TypeError, String(bad));
  }
});

/** A payguard.report.v1 text as the previous release wrote it, from a v2 report. */
function asV1(report) {
  const { applicationOrigin, originLabel, originWarning, ...rest } = structuredClone(report);
  return JSON.stringify({
    ...rest, reportSchemaVersion: 'payguard.report.v1', dataClassification: 'SYNTHETIC', syntheticLabel: SYNTHETIC_LABEL,
    limitations: [
      'Synthetic demonstration data only; fictional parties and illustrative contract conditions, not law or legal advice.',
      'Readiness reflects configured rules only; NO_BLOCKING_FINDINGS is not approval, acceptance or compliance.',
      'No legal deadlines, lien dates or customer outcomes are evaluated.',
      'Evidence is metadata only; document contents are not parsed or verified.',
    ],
  });
}

test('legacy v1 reports are read but their synthetic flags are not treated as origin', async () => {
  const { wf } = setup();
  ok(await wf.importSample('json'));
  const v2 = ok(wf.report(1));
  assert.equal(v2.applicationOrigin, BUNDLED);
  const v1Text = asV1(v2);

  const up = ok(engine.parseReportJson(v1Text));
  assert.equal(up.reportSchemaVersion, 'payguard.report.v2');
  assert.equal(up.applicationOrigin, LEGACY, 'even a report of the bundled sample is unverified once read from v1');
  assert.equal(up.originLabel, APPLICATION_ORIGIN_LABEL[LEGACY]);
  assert.equal(up.originWarning, REAL_DATA_WARNING);
  assert.ok(!('dataClassification' in up) && !('syntheticLabel' in up));
  assert.deepEqual(up.limitations, [...LIMITATIONS]);
  assert.deepEqual(up.totals, v2.totals, 'figures are preserved');
  assert.equal(up.semanticHash, v2.semanticHash);

  // Re-export of an upgraded report stays legacy-unverified in JSON and CSV.
  const again = ok(engine.parseReportJson(engine.serializeReportJson(up)));
  assert.deepEqual(again, up);
  const rows = parseCsv(engine.serializeReportCsv(up));
  assert.ok(rows.slice(1).every((r) => r[rows[0].indexOf('application_origin')] === LEGACY));

  // v1 schema is still strict, and v1-only fields are not accepted inside v2.
  const v1 = JSON.parse(v1Text);
  for (const [label, mutate] of Object.entries({
    'v1 without synthetic label': (o) => { delete o.syntheticLabel; },
    'v1 with other classification': (o) => { o.dataClassification = 'REAL'; },
    'v1 with v2 limitations': (o) => { o.limitations = [...LIMITATIONS]; },
    'v1 with origin field': (o) => { o.applicationOrigin = BUNDLED; },
    'v1 with altered total': (o) => { o.totals.calculatedCurrentDueCents += 1; },
  })) {
    const c = structuredClone(v1); mutate(c);
    assert.equal(engine.parseReportJson(JSON.stringify(c)).ok, false, label);
  }
  const v2WithV1Flags = { ...JSON.parse(engine.serializeReportJson(v2)), dataClassification: 'SYNTHETIC', syntheticLabel: SYNTHETIC_LABEL };
  assert.equal(engine.parseReportJson(JSON.stringify(v2WithV1Flags)).ok, false);
});

// "Not uploaded" is claimed in the UI only because of these source facts; keep them true.
test('app source: chosen files are read locally and the only network call fetches bundled samples', () => {
  const dir = new URL('../../apps/payguard/src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => /\.(js|html)$/.test(f));
  const src = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]));
  const fetchers = files.filter((f) => /\bfetch\s*\(/.test(src[f]));
  assert.deepEqual(fetchers, ['assets/fixtures.js']);
  assert.equal(src['assets/fixtures.js'].match(/\bfetch\s*\(/g).length, 1);
  assert.match(src['assets/fixtures.js'], /fetch\(new URL\(name, FIXTURE_BASE\), \{ credentials: 'same-origin' \}\)/);
  for (const f of files) {
    assert.doesNotMatch(src[f], /XMLHttpRequest|sendBeacon|WebSocket|EventSource|<form[^>]*\baction=|formaction/i, f);
  }
  assert.match(src['assets/app.js'], /readBytes: async \(\) => new Uint8Array\(await file\.arrayBuffer\(\)\)/);
  assert.equal((src['assets/app.js'].match(/form\.addEventListener\('submit', \(e\) => \{\s*e\.preventDefault\(\);/g) ?? []).length, 2);
  assert.match(src['app/index.html'], /Files you choose are read in this tab and not uploaded/);
  // Sample buttons use the bundled path; the file picker uses importFile.
  assert.match(src['assets/app.js'], /wf\.importSample\(format\)/);
  assert.doesNotMatch(src['assets/app.js'], /importFile\(\{ bytes/);
  assert.match(src['assets/landing.js'], /wf\.importSample\('json'\)/);
});
