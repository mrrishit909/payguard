// Fixed-point USD cents: strict parse, checked arithmetic, half-up per-line retainage (ADR-0003).
import { DECIMAL_AMOUNT_PATTERN, MONEY_LIMITS } from '../../contracts/src/constants.js';

const AMOUNT_RE = new RegExp(DECIMAL_AMOUNT_PATTERN);

/** Thrown internally on unsafe integer results; converted to ARITHMETIC_OVERFLOW at the boundary. */
export class ArithmeticOverflow extends Error {}

const norm = (x) => (x === 0 ? 0 : x);

/** @param {number} x */
function checked(x) {
  if (!Number.isSafeInteger(x)) throw new ArithmeticOverflow('arithmetic overflow');
  return norm(x);
}

export const add = (a, b) => checked(checked(a) + checked(b));
export const sub = (a, b) => checked(checked(a) - checked(b));
export const sum = (values) => values.reduce((acc, v) => add(acc, v), 0);

/** Half-up to the cent of gross x bps / 10000, for gross >= 0. */
export function retainageHalfUp(grossCents, basisPoints) {
  if (grossCents < 0 || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > MONEY_LIMITS.MAX_BASIS_POINTS) {
    throw new ArithmeticOverflow('retainage input out of range');
  }
  const scaled = checked(checked(grossCents * basisPoints) + 5000);
  return norm(Math.floor(scaled / 10000));
}

/**
 * @param {unknown} text
 * @returns {{ ok: true, value: number } | { ok: false, code: string }}
 */
export function parseCents(text) {
  if (typeof text !== 'string') return { ok: false, code: 'INVALID_TYPE' };
  if (!AMOUNT_RE.test(text)) return { ok: false, code: 'INVALID_AMOUNT' };
  const [whole, frac = ''] = text.split('.');
  // Digit-only strings of <= 10 digits convert exactly; never Number(text) * 100.
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MONEY_LIMITS.MAX_INPUT_AMOUNT_CENTS) {
    return { ok: false, code: 'AMOUNT_OUT_OF_RANGE' };
  }
  return { ok: true, value: norm(cents) };
}

/** @param {number} cents @param {boolean} [grouped] */
export function formatCentsText(cents, grouped = false) {
  if (!Number.isSafeInteger(cents)) throw new TypeError('formatCents requires a safe integer');
  const neg = cents < 0;
  const abs = Math.abs(cents);
  let whole = String(Math.floor(abs / 100));
  if (grouped) whole = whole.replace(/\B(?=(\d{3})+$)/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}
