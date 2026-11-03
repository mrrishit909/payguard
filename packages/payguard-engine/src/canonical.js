// Canonical JSON, code-unit ordering, deep clone/freeze, SHA-256 via WebCrypto (ADR-0003).
import { ISO_DATE_PATTERN } from '../../contracts/src/constants.js';

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const byKey = (key) => (x, y) => cmp(x[key], y[key]);

/** JSON-safe deep clone: drops undefined, normalises -0, detaches from caller objects. */
export const clone = (v) => JSON.parse(JSON.stringify(v));

export function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort(cmp)) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

/** @param {unknown} v @param {number} [indent] */
export const canonicalJson = (v, indent) => JSON.stringify(sortKeys(v), null, indent);

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DATE_RE = new RegExp(ISO_DATE_PATTERN);

/** Calendar-valid 'YYYY-MM-DD' without Date objects (timezone-free). */
export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

/** 'October 2026' if the period is exactly one full calendar month, else 'start to end'. */
export function periodLabel(start, end) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7) && start.slice(8) === '01';
  if (sameMonth && !isValidDate(`${end.slice(0, 8)}${String(Number(end.slice(8)) + 1).padStart(2, '0')}`)) {
    return `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)} (${start} to ${end})`;
  }
  return `${start} to ${end}`;
}
