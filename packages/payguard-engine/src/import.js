// Atomic application import for JSON and CSV (ADR-0004). Both formats converge on the same
// canonical PaymentApplication; only provenance locations differ.
import {
  SCHEMA_VERSIONS, DATA_CLASSIFICATION, CURRENCY, IMPORT_LIMITS, ID_PATTERN, CSV_IMPORT_COLUMNS,
} from '../../contracts/src/constants.js';
import { parseCents } from './money.js';
import { cmp, byKey, deepFreeze, isValidDate } from './canonical.js';

const ID_RE = new RegExp(ID_PATTERN);

export class ErrorList {
  constructor() { this.items = []; }
  add(code, message, loc = {}) {
    if (this.items.length < IMPORT_LIMITS.MAX_ERRORS_REPORTED) this.items.push({ code, message, ...loc });
  }
  get any() { return this.items.length > 0; }
}

export const fail = (errors) => ({ ok: false, errors: Array.isArray(errors) ? errors : errors.items });

/** field name, CSV column, kind. Order is the RawApplicationJson order. */
const APP_FIELDS = [
  ['schemaVersion', 'schema_version', 'schema'],
  ['dataClassification', 'data_classification', 'classification'],
  ['applicationId', 'application_id', 'id'],
  ['contractId', 'contract_id', 'id'],
  ['currency', 'currency', 'currency'],
  ['periodStart', 'period_start', 'date'],
  ['periodEnd', 'period_end', 'date'],
  ['reviewDate', 'review_date', 'date'],
  ['claimedCurrentDue', 'claimed_current_due', 'amount'],
];
const LINE_FIELDS = [
  ['lineId', 'line_id', 'id'],
  ['completedToDate', 'completed_to_date', 'amount'],
  ['storedToDate', 'stored_to_date', 'amount'],
];
const canonicalName = (name, kind) => (kind === 'amount' ? `${name}Cents` : name);

function decode(bytes, errors) {
  if (!(bytes instanceof Uint8Array)) { errors.add('INVALID_TYPE', 'Upload must be provided as bytes.'); return null; }
  if (bytes.byteLength > IMPORT_LIMITS.MAX_UPLOAD_BYTES) {
    errors.add('INPUT_TOO_LARGE', `Upload exceeds the ${IMPORT_LIMITS.MAX_UPLOAD_BYTES}-byte limit.`);
    return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes); // strips one leading BOM
  } catch {
    errors.add('INVALID_UTF8', 'Upload is not valid UTF-8 text.');
    return null;
  }
}

function checkMeta(meta, errors) {
  if (!meta || typeof meta !== 'object' || typeof meta.importBatchId !== 'string' || !ID_RE.test(meta.importBatchId)) {
    errors.add('INVALID_ID', 'Import batch id is missing or invalid.', { path: '/meta/importBatchId' });
  }
  if (!meta || typeof meta.sourceName !== 'string' || meta.sourceName.length > IMPORT_LIMITS.MAX_STRING_CHARS) {
    errors.add('STRING_TOO_LONG', 'Source name must be a string of at most 500 characters.', { path: '/meta/sourceName' });
  }
}

/** Validates one raw cell; returns the canonical value or undefined (error recorded). */
function cell(kind, name, raw, loc, errors) {
  const where = loc.path ?? `row ${loc.row}, column ${loc.column}`;
  if (raw === undefined) { errors.add('MISSING_FIELD', `Required field ${name} is missing (${where}).`, loc); return undefined; }
  if (typeof raw !== 'string') { errors.add('INVALID_TYPE', `Field ${name} must be a string (${where}).`, loc); return undefined; }
  if (raw.length > IMPORT_LIMITS.MAX_STRING_CHARS) { errors.add('STRING_TOO_LONG', `Field ${name} exceeds 500 characters (${where}).`, loc); return undefined; }
  switch (kind) {
    case 'schema':
      if (raw !== SCHEMA_VERSIONS.APPLICATION_IMPORT) { errors.add('UNSUPPORTED_SCHEMA_VERSION', `Unsupported schema version (${where}).`, loc); return undefined; }
      return raw;
    case 'classification':
      if (raw !== DATA_CLASSIFICATION) { errors.add('UNSUPPORTED_CLASSIFICATION', `Only SYNTHETIC data is accepted (${where}).`, loc); return undefined; }
      return raw;
    case 'currency':
      if (raw !== CURRENCY) { errors.add('UNSUPPORTED_CURRENCY', `Only USD is supported (${where}).`, loc); return undefined; }
      return raw;
    case 'id':
      if (!ID_RE.test(raw)) { errors.add('INVALID_ID', `Field ${name} is not a valid identifier (${where}).`, loc); return undefined; }
      return raw;
    case 'date':
      if (!isValidDate(raw)) { errors.add('INVALID_DATE', `Field ${name} must be a calendar date YYYY-MM-DD (${where}).`, loc); return undefined; }
      return raw;
    case 'amount': {
      const r = parseCents(raw);
      if (!r.ok) {
        const msg = r.code === 'AMOUNT_OUT_OF_RANGE' ? 'exceeds the 1000000000.00 maximum' : 'must be a non-negative decimal with at most two places, no signs, separators or exponents';
        errors.add(r.code, `Field ${name} ${msg} (${where}).`, loc);
        return undefined;
      }
      return r.value;
    }
    default: return undefined;
  }
}

/**
 * @param {Record<string, {raw: unknown, loc: object}>} appCells
 * @param {Record<string, {raw: unknown, loc: object}>[]} lineCells
 */
function build(appCells, lineCells, format, meta, byteLength, errors) {
  const app = {};
  for (const [name, , kind] of APP_FIELDS) {
    const c = appCells[name];
    app[canonicalName(name, kind)] = cell(kind, name, c?.raw, c?.loc ?? {}, errors);
  }
  if (lineCells.length === 0) errors.add('MISSING_FIELD', 'At least one application line is required.', format === 'json' ? { path: '/lines' } : {});
  if (lineCells.length > IMPORT_LIMITS.MAX_ROWS) {
    errors.add('TOO_MANY_ROWS', `At most ${IMPORT_LIMITS.MAX_ROWS} lines are allowed.`);
    return fail(errors);
  }
  const lines = lineCells.map((lc) => {
    const line = {};
    for (const [name, , kind] of LINE_FIELDS) line[canonicalName(name, kind)] = cell(kind, name, lc[name]?.raw, lc[name]?.loc ?? {}, errors);
    return line;
  });
  const seen = new Set();
  lines.forEach((l, i) => {
    if (l.lineId === undefined) return;
    if (seen.has(l.lineId)) errors.add('DUPLICATE_ID', `Line ${l.lineId} appears more than once.`, lineCells[i].lineId.loc);
    seen.add(l.lineId);
  });
  if (app.periodStart && app.periodEnd && app.periodEnd < app.periodStart) {
    errors.add('PERIOD_END_BEFORE_START', 'Period end is before period start.', appCells.periodEnd.loc);
  }
  checkMeta(meta, errors);
  if (errors.any) return fail(errors);

  const provenance = [];
  const prov = (entity, id, field, c) => provenance.push({
    ref: { entity, id, field }, sourceFormat: format, sourceId: meta.importBatchId,
    ...(c.loc.path !== undefined ? { jsonPointer: c.loc.path } : { row: c.loc.row, column: c.loc.column }),
    rawValue: c.raw,
  });
  for (const [name, , kind] of APP_FIELDS) prov('application', app.applicationId, canonicalName(name, kind), appCells[name]);
  lineCells.forEach((lc, i) => {
    for (const [name, , kind] of LINE_FIELDS) prov('applicationLine', lines[i].lineId, canonicalName(name, kind), lc[name]);
  });
  provenance.sort((a, b) => cmp(a.ref.entity, b.ref.entity) || cmp(a.ref.id, b.ref.id) || cmp(a.ref.field, b.ref.field));

  const { schemaVersion, dataClassification, ...application } = app;
  application.lines = lines.sort(byKey('lineId'));
  return {
    ok: true,
    value: deepFreeze({
      application,
      importBatch: { importBatchId: meta.importBatchId, sourceFormat: format, byteLength, sourceName: meta.sourceName },
      provenance,
    }),
  };
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function importJson(bytes, meta) {
  const errors = new ErrorList();
  const text = decode(bytes, errors);
  if (text === null) return fail(errors);
  let raw;
  try { raw = JSON.parse(text); } catch {
    errors.add('MALFORMED_JSON', 'Upload is not well-formed JSON.');
    return fail(errors);
  }
  if (!isPlain(raw)) { errors.add('INVALID_TYPE', 'Top level must be a JSON object.', { path: '' }); return fail(errors); }
  const appNames = new Set([...APP_FIELDS.map((f) => f[0]), 'lines']);
  for (const k of Object.keys(raw)) if (!appNames.has(k)) errors.add('UNKNOWN_FIELD', `Unknown field ${k.slice(0, 64)}.`, { path: `/${k.slice(0, 64)}` });
  if (!Array.isArray(raw.lines)) {
    errors.add(raw.lines === undefined ? 'MISSING_FIELD' : 'INVALID_TYPE', 'Field lines must be an array.', { path: '/lines' });
    return fail(errors);
  }
  if (raw.lines.length > IMPORT_LIMITS.MAX_ROWS) { errors.add('TOO_MANY_ROWS', `At most ${IMPORT_LIMITS.MAX_ROWS} lines are allowed.`, { path: '/lines' }); return fail(errors); }
  const appCells = {};
  for (const [name] of APP_FIELDS) if (name in raw) appCells[name] = { raw: raw[name], loc: { path: `/${name}` } };
  for (const [name] of APP_FIELDS) if (!(name in raw)) appCells[name] = { raw: undefined, loc: { path: `/${name}` } };
  const lineNames = new Set(LINE_FIELDS.map((f) => f[0]));
  const lineCells = raw.lines.map((line, i) => {
    const cells = {};
    if (!isPlain(line)) { errors.add('INVALID_TYPE', `Line ${i} must be an object.`, { path: `/lines/${i}` }); return cells; }
    for (const k of Object.keys(line)) if (!lineNames.has(k)) errors.add('UNKNOWN_FIELD', `Unknown field ${k.slice(0, 64)}.`, { path: `/lines/${i}/${k.slice(0, 64)}` });
    for (const [name] of LINE_FIELDS) cells[name] = { raw: line[name], loc: { path: `/lines/${i}/${name}` } };
    return cells;
  });
  return build(appCells, lineCells, 'json', meta, bytes.byteLength, errors);
}

/** RFC 4180 subset reader. Returns rows of cells or an error with a 0-based record index. */
export function readCsv(text) {
  const rows = []; let row = []; let c = ''; let quoted = false; let wasQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { c += '"'; i++; } else quoted = false;
      } else c += ch;
      continue;
    }
    if (ch === '"') {
      if (c !== '' || wasQuoted) return { ok: false, record: rows.length, message: 'Unexpected quote inside an unquoted cell' };
      quoted = true; wasQuoted = true;
    } else if (ch === ',') { row.push(c); c = ''; wasQuoted = false; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] !== '\n') return { ok: false, record: rows.length, message: 'Bare carriage return' };
      if (ch === '\r') i++;
      row.push(c); rows.push(row); row = []; c = ''; wasQuoted = false;
    } else {
      if (wasQuoted) return { ok: false, record: rows.length, message: 'Text after closing quote' };
      c += ch;
    }
  }
  if (quoted) return { ok: false, record: rows.length, message: 'Unterminated quoted cell' };
  if (c !== '' || row.length || wasQuoted) { row.push(c); rows.push(row); }
  return { ok: true, rows };
}

export function importCsv(bytes, meta) {
  const errors = new ErrorList();
  const text = decode(bytes, errors);
  if (text === null) return fail(errors);
  const parsed = readCsv(text);
  if (!parsed.ok) {
    errors.add('MALFORMED_CSV', `Malformed CSV near record ${parsed.record}: ${parsed.message}.`, { row: parsed.record });
    return fail(errors);
  }
  const [header = [], ...data] = parsed.rows;
  if (data.length > IMPORT_LIMITS.MAX_ROWS) { errors.add('TOO_MANY_ROWS', `At most ${IMPORT_LIMITS.MAX_ROWS} data rows are allowed.`); return fail(errors); }
  const known = new Set(CSV_IMPORT_COLUMNS);
  const seenCols = new Set();
  for (const h of header) {
    if (seenCols.has(h)) errors.add('MALFORMED_CSV', `Duplicate column ${h.slice(0, 64)}.`, { row: 0, column: h.slice(0, 64) });
    seenCols.add(h);
    if (!known.has(h)) errors.add('UNKNOWN_COLUMN', `Unknown column ${h.slice(0, 64)}.`, { row: 0, column: h.slice(0, 64) });
  }
  for (const col of CSV_IMPORT_COLUMNS) if (!seenCols.has(col)) errors.add('MISSING_COLUMN', `Required column ${col} is missing.`, { row: 0, column: col });
  if (errors.any) return fail(errors);
  const index = Object.fromEntries(header.map((h, i) => [h, i]));
  data.forEach((r, i) => {
    if (r.length !== header.length) errors.add('MALFORMED_CSV', `Row ${i + 1} has ${r.length} cells; expected ${header.length}.`, { row: i + 1 });
  });
  if (errors.any) return fail(errors);
  const appCells = {};
  for (const [name, col] of APP_FIELDS) {
    appCells[name] = { raw: data[0]?.[index[col]], loc: { row: 1, column: col } };
    data.forEach((r, i) => {
      if (i > 0 && r[index[col]] !== data[0][index[col]]) {
        errors.add('INCONSISTENT_HEADER_VALUE', `Column ${col} differs from row 1.`, { row: i + 1, column: col });
      }
    });
  }
  const lineCells = data.map((r, i) => Object.fromEntries(LINE_FIELDS.map(([name, col]) => [name, { raw: r[index[col]], loc: { row: i + 1, column: col } }])));
  if (data.length === 0) for (const [name, col] of APP_FIELDS) appCells[name] = { raw: undefined, loc: { row: 1, column: col } };
  return build(appCells, lineCells, 'csv', meta, bytes.byteLength, errors);
}
