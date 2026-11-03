// Fixture loading helpers for reference tests. SYNTHETIC data only. No engine helpers used for
// expected values: expectations are literal integers in the tests or fixtures/payguard/manifest.json.
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'payguard');
export const enc = new TextEncoder();

export const readText = (name) => readFileSync(join(FIXTURES, name), 'utf8');
export const readJson = (name) => JSON.parse(readText(name));
export const readBytes = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)));

export const META = Object.freeze({ importBatchId: 'IB-TEST000000000001', sourceName: 'synthetic-upload' });

/** Fresh mutable copy of the PG-SYN-001 bundle. */
export const bundle = () => readJson('pg-syn-001.bundle.json');
/** Fresh mutable raw JSON application object. */
export const rawApp = () => readJson('pg-syn-001.application.json');

export const jsonBytes = (obj) => enc.encode(JSON.stringify(obj));

/** Builds CSV text from header + row objects (test-side writer, independent of the engine). */
export function csvText(columns, rows, eol = '\n') {
  const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c] ?? '')).join(','))].join(eol) + eol;
}

/** Minimal RFC 4180 reader for checking exports (test-side, independent of the engine). */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
