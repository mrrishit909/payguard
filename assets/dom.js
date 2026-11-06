// Minimal DOM builder. Every string becomes a text node; there is no HTML parsing path.

/**
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]  `on*` functions become listeners; booleans toggle.
 * @param {...any} children  strings/numbers (as text), nodes, arrays, null/false (skipped).
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'testid') el.setAttribute('data-testid', v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

/** Replace all children of `el` (text-safe). */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Shared reduced-motion flag, re-evaluated live. */
export function motionPreference(onChange) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', () => onChange?.(mq.matches));
  return mq;
}
