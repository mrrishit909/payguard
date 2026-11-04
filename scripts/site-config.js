// Shared static-site configuration for build, local preview and hosting headers.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
});

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
});

/** Files copied into dist/ (relative to repo root -> relative to dist). Nothing else ships. */
export const COPY = Object.freeze([
  ['apps/payguard/src', '.'],
  ['packages/payguard-engine/src', 'packages/payguard-engine/src'],
  ['packages/contracts/src', 'packages/contracts/src'],
]);
export const FIXTURE_FILES = Object.freeze([
  'pg-syn-001.bundle.json',
  'pg-syn-001.application.json',
  'pg-syn-001.application.csv',
  'pg-syn-001.corrected-waiver.document.json',
  'pg-syn-001.corrected.application.json',
]);
