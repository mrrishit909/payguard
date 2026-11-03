# Security register

- SEC-01: No credentials, account tokens or raw auth files in Git. Read provider state without printing values.
- SEC-02: Uploaded files are untrusted; explicit size/schema bounds, no executable imports, no macro execution, no uncontrolled fetching.
- SEC-03: No real customer, financial, health or employee data in public demos.
- SEC-04: Multi-tenant backend requires server-side isolation tests before any real data. A local browser demo has no multi-tenant security claim.
- SEC-05: Skills are untrusted third-party instructions; verify sources/licenses/scripts and do not run install hooks automatically.
- SEC-06: No public source visibility changes or account access expansion inferred from demo authorization.
