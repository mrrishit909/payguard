# PayGuard static demo: build, local preview, hosting and rollback

Status: **PREPARED, NOT DEPLOYED.** No provider CLI or API has been called. There is no public URL. Do not deploy until Codex confirms the Cloudflare account and the zero-spend settings.

## Build
```
node scripts/build.js            # -> dist/ (also: npm run build)
```
`dist/` contains only these items:
- `index.html` (overview), `app/index.html` (review workspace), `404.html` and `assets/*` from `apps/payguard/src`.
- `packages/payguard-engine/src/*` and `packages/contracts/src/*`, loaded unchanged as browser ES modules.
- The five synthetic files listed in `scripts/site-config.js` (`FIXTURE_FILES`), placed in `fixtures/payguard/`.
- `_headers` (security headers) and `build-manifest.json` (bytes and SHA-256 for each file).

Docs, tests, `.git`, prompts, package manifests and fixture expectations are excluded, and `tests/payguard-app/site.test.js` checks this. Every URL is relative except the links in `404.html`. Those are root-absolute, so deploy at the domain root.

## Local preview
```
node scripts/serve.js dist 4173  # http://127.0.0.1:4173/  (Ctrl+C stops it)
```
The preview server binds to 127.0.0.1 only and accepts only GET and HEAD requests. It serves files from `dist/` and nothing else. It refuses dot segments, encoded traversal, backslashes, NUL bytes and unknown file types, and it sends the same CSP and security headers as `_headers`. It keeps no state and writes nothing to disk.

## Hosting (Cloudflare static assets, prepared only)
- Config file: `deploy/cloudflare/wrangler.jsonc`. It serves assets only, with no Worker script and no KV, D1 or R2 bindings.
- Headers: `dist/_headers`. CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; ...; frame-ancestors 'none'`.
- Once authorized, the deploy steps are: run the build, check `build-manifest.json`, then upload `dist/` through the approved channel. Before reporting anything as live, verify the live URL in a browser on desktop and at 390px.

## Rollback
1. Each release is one `dist/` built from one commit. Record the commit SHA and the SHA-256 of `build-manifest.json` with the release.
2. To roll back, check out the last accepted commit, run `node scripts/build.js`, confirm its manifest hash matches the recorded value, and redeploy that `dist/`. Alternatively, use the provider's "roll back to previous deployment" control once Codex has approved it.
3. The site has no server state, so a rollback needs no data migration, and visitor state (in-memory only) is unaffected.
4. Emergency stop: remove the custom route or disable the project in the provider dashboard. No data is lost because none is stored.

## CI
`docs/ci-templates/payguard-ci.yml` is an inactive template. Do not copy it to `.github/workflows/` before the Actions billing gate clears.
