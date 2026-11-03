# PayGuard slice threat boundaries

Scope: a browser-only synthetic demo (ADR-0007). Assets: correctness of displayed financial results, integrity of review history and reports, the visitor's browser, and spreadsheet users who open exports. There is no real data, no accounts and no server.

| ID | Boundary | Threats | Controls (owner) | Verified by |
|---|---|---|---|---|
| TB-1 | Untrusted upload bytes → importer | Oversize/zip-bomb-like input, deep JSON, invalid UTF-8, floats/exponents, ambiguous decimals, unknown fields, duplicate IDs, partial import | Size check before decode; fatal UTF-8; row/string limits; strict grammar; reject-unknown; atomic Result (A02) | Engine unit tests (A02), reference malformed cases (A03), review (A04) |
| TB-2 | Canonical input → pure engine | Overflow, float drift, rounding errors, clock/timezone/locale/order dependence, input mutation altering snapshots, silent clipping/flooring | Safe-integer ceiling + checked ops; integer half-up; no Date/Intl; ID sort; deep-freeze/clone (A02); static guard (A01) | `tests/architecture`, A02 unit, A03 golden/invariance, Codex recalculation |
| TB-3 | Engine output / evidence text → UI | XSS through notes/titles/IDs, evidence text treated as instructions, misleading "compliant/approved" wording | Text-node rendering only, no `innerHTML`; no runtime AI; readiness vocabulary excludes compliance (A01 contracts, FE) | FE tests + axe (future), A04 |
| TB-4 | Export → spreadsheet / downstream | CSV formula injection, broken quoting/newlines, lossy money, missing synthetic label | Quote-all, `'` prefix on trigger chars for text, typed numeric cells, label mandatory, strict JSON round-trip (A02) | A03 injection fixtures, A04 |
| TB-5 | Browser state / public demo | Cross-visitor leakage, reset affecting others, stale-state confusion | No server persistence; per-browser storage with versioned key; reset local only (FE, ADR-0007) | Future E2E; deployment review (REL) |
| TB-6 | Build / CI / hosting supply chain | Malicious dependency, unreviewed skill, paid resource creation, untracked deploy | Zero dependencies (test-enforced); no CI before Actions gate; no provisioning (A01/REL/Codex) | `tests/architecture` dependency check; COST-LEDGER |
| TB-7 | Repository / fixture content | Real customer data, secrets, legal claims presented as fact | Synthetic-only classification, fictional names, illustrative rules, `.gitignore` for env files (A03, Codex) | A04 data review, Codex |

Out of scope for v1 (not claimed): multi-tenant isolation, authentication, PDF/zip parsing, legal deadline correctness, production hardening.
