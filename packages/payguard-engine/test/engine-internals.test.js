// Engine-owned unit tests for internals that public inputs cannot reach under MONEY_LIMITS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { add, sub, retainageHalfUp, ArithmeticOverflow, formatCentsText } from '../src/money.js';
import { isValidDate, periodLabel } from '../src/canonical.js';
import { readCsv } from '../src/import.js';

test('checked arithmetic throws on unsafe results instead of losing precision', () => {
  assert.throws(() => add(Number.MAX_SAFE_INTEGER, 1), ArithmeticOverflow);
  assert.throws(() => sub(-Number.MAX_SAFE_INTEGER, 1), ArithmeticOverflow);
  assert.throws(() => add(0.5, 1), ArithmeticOverflow);
  assert.throws(() => retainageHalfUp(Number.MAX_SAFE_INTEGER, 10000), ArithmeticOverflow);
  assert.ok(Object.is(sub(5, 5), 0));
});

test('half-up retainage boundaries', () => {
  assert.equal(retainageHalfUp(5, 1000), 1);
  assert.equal(retainageHalfUp(4, 1000), 0);
  assert.equal(retainageHalfUp(15, 1000), 2);
  assert.equal(retainageHalfUp(14, 1000), 1);
  assert.equal(retainageHalfUp(7000000, 1000), 700000);
  assert.equal(retainageHalfUp(1, 10000), 1);
  assert.equal(retainageHalfUp(0, 0), 0);
});

test('formatting and calendar helpers', () => {
  assert.equal(formatCentsText(500000, true), '5,000.00');
  assert.equal(formatCentsText(-1, false), '-0.01');
  assert.equal(formatCentsText(100000000000, true), '1,000,000,000.00');
  assert.ok(isValidDate('2000-02-29'));
  assert.ok(!isValidDate('1900-02-29'));
  assert.equal(periodLabel('2026-10-01', '2026-10-31'), 'October 2026 (2026-10-01 to 2026-10-31)');
  assert.equal(periodLabel('2026-10-01', '2026-10-30'), '2026-10-01 to 2026-10-30');
});

test('CSV reader handles quotes and rejects malformed quoting', () => {
  assert.deepEqual(readCsv('a,"b ""q"", c\nd"\r\n').rows, [['a', 'b "q", c\nd']]);
  assert.equal(readCsv('a,"b"x\n').ok, false);
  assert.equal(readCsv('a,b"c\n').ok, false);
  assert.equal(readCsv('a\rb').ok, false);
});
