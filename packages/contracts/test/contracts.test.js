import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/index.js';

// Literal values copied from docs/specs/PAYGUARD-VERTICAL-SLICE.md, not from the module.

test('import limits match the slice specification', () => {
  assert.equal(C.IMPORT_LIMITS.MAX_UPLOAD_BYTES, 1048576);
  assert.equal(C.IMPORT_LIMITS.MAX_ROWS, 5000);
  assert.equal(C.IMPORT_LIMITS.MAX_STRING_CHARS, 500);
  assert.ok(C.IMPORT_LIMITS.MAX_REVIEW_NOTE_CHARS > 500, 'note limit is a documented, bounded exception');
});

test('v1 is USD-only, cents-denominated and synthetic-only', () => {
  assert.equal(C.CURRENCY, 'USD');
  assert.equal(C.MONEY_UNIT, 'USD_CENTS');
  assert.equal(C.DATA_CLASSIFICATION, 'SYNTHETIC');
  assert.match(C.SYNTHETIC_LABEL, /SYNTHETIC/);
  assert.match(C.SYNTHETIC_LABEL, /not legal advice/);
});

test('money ceiling keeps every intermediate product within safe integers', () => {
  const maxLineGross = 2 * C.MONEY_LIMITS.MAX_INPUT_AMOUNT_CENTS; // completed + stored
  assert.ok(Number.isSafeInteger(maxLineGross * C.MONEY_LIMITS.MAX_BASIS_POINTS + 5000));
  assert.ok(Number.isSafeInteger(maxLineGross * C.IMPORT_LIMITS.MAX_ROWS * 2));
  assert.equal(C.MONEY_LIMITS.MAX_BASIS_POINTS, 10000);
});

test('decimal grammar accepts strict amounts and rejects ambiguous forms', () => {
  const re = new RegExp(C.DECIMAL_AMOUNT_PATTERN);
  for (const ok of ['0', '0.05', '45000.00', '66000', '999999999.99', '1.5', '1000000000',
    '1000000000.0', '1000000000.00']) assert.ok(re.test(ok), ok);
  for (const bad of ['', '-1.00', '+1', '1e3', '1.234', '45,000.00', '45 000', '01.00', 'NaN',
    'Infinity', '.5', '5.', ' 5', '1000000000.01', '1000000000.1', '1000000001', '9999999999', '٤٥']) {
    assert.ok(!re.test(bad), `should reject ${JSON.stringify(bad)}`);
  }
  // Grammar max ($1,000,000,000.00) equals the cents ceiling exactly.
  assert.equal(C.MONEY_LIMITS.MAX_INPUT_AMOUNT_CENTS, 100000000000);
});

test('date and id grammars are strict', () => {
  const date = new RegExp(C.ISO_DATE_PATTERN);
  assert.ok(date.test('2026-10-31'));
  for (const bad of ['2026-10-31T00:00:00Z', '10/31/2026', '2026-1-3']) assert.ok(!date.test(bad), bad);
  const id = new RegExp(C.ID_PATTERN);
  for (const ok of ['PG-C-001', 'PG-A-003', 'L1', 'CO-P-01', 'IB-0123456789abcdef']) assert.ok(id.test(ok), ok);
  for (const bad of ['', ' L1', 'L1 ', '<script>', '=1+1', '-L1', 'a'.repeat(65)]) assert.ok(!id.test(bad), bad);
});

test('status enums contain exactly the specified values', () => {
  assert.deepEqual(Object.values(C.CHANGE_ORDER_STATUS).sort(), ['APPROVED', 'PENDING', 'REJECTED']);
  assert.deepEqual(Object.values(C.PAYMENT_STATUS).sort(), ['POSTED', 'UNPOSTED', 'VOID']);
  assert.deepEqual(Object.values(C.RULE_OUTCOME).sort(), ['NOT_CONFIGURED', 'NOT_SATISFIED', 'SATISFIED']);
});

test('required finding codes exist and readiness never claims compliance', () => {
  assert.equal(C.FINDING_CODES.MISSING_REQUIRED_SIGNED_WAIVER, 'MISSING_REQUIRED_SIGNED_WAIVER');
  assert.equal(C.FINDING_CODES.CLAIMED_DUE_MISMATCH, 'CLAIMED_DUE_MISMATCH');
  for (const v of [...Object.values(C.READINESS), ...Object.values(C.REVIEW_DISPOSITION)]) {
    assert.doesNotMatch(v, /COMPLIANT|APPROVED|ACCEPTED|RESOLVED|DISMISSED/);
  }
});

test('rule identities are unique and versioned', () => {
  const ids = Object.values(C.CALCULATION_RULES).map((r) => r.ruleId);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of Object.values(C.CALCULATION_RULES)) assert.ok(Number.isInteger(r.ruleVersion) && r.ruleVersion > 0);
  assert.deepEqual(Object.values(C.RULE_KIND), ['REQUIRED_SIGNED_DOCUMENT']);
});

test('CSV column sets are unique and formula triggers match the spec', () => {
  for (const cols of [C.CSV_IMPORT_COLUMNS, C.CSV_EXPORT_COLUMNS]) assert.equal(new Set(cols).size, cols.length);
  assert.equal(C.CSV_EXPORT_COLUMNS[0], 'record_type');
  assert.deepEqual([...C.CSV_FORMULA_TRIGGER_PREFIXES].sort(), ['\t', '\r', '+', '-', '=', '@'].sort());
});

test('all exported contract objects are deeply frozen', () => {
  /** @param {unknown} v @param {string} path */
  const check = (v, path) => {
    if (v && typeof v === 'object') {
      assert.ok(Object.isFrozen(v), `${path} must be frozen`);
      for (const [k, child] of Object.entries(v)) check(child, `${path}.${k}`);
    }
  };
  for (const [name, value] of Object.entries(C)) check(value, name);
});
