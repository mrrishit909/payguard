// Build output, local preview server and static UI-safety checks. Not a browser test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../scripts/build.js';
import { createSiteServer } from '../../scripts/serve.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'tests/payguard-app/.tmp-dist');

test('static UI never uses HTML sinks, remote URLs, storage or eval', () => {
  const dir = join(ROOT, 'apps/payguard/src');
  const files = readdirSync(dir, { recursive: true }).filter((f) => /\.(js|html|css)$/.test(f));
  for (const f of files) {
    const code = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/, `${f}: HTML/code sink`);
    assert.doesNotMatch(code, /https?:\/\/(?!127\.0\.0\.1)/, `${f}: remote URL`);
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/, `${f}: persistent storage`);
    if (f.endsWith('.html')) assert.doesNotMatch(code, /\sstyle=|<script>(?!<\/script>)|\son[a-z]+=/i, `${f}: inline style/script/handler blocked by CSP`);
  }
  for (const f of files.filter((x) => x.endsWith('.html') && !x.startsWith('404'))) {
    const code = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(code.toLowerCase(), />[^<]*\b(compliant|approved by|accepted by)\b/, `${f}: forbidden outcome wording`);
  }
});

test('build ships only public assets, engine, contracts and sample fixtures', () => {
  rmSync(OUT, { recursive: true, force: true });
  const { manifest } = build(OUT);
  const paths = manifest.files.map((f) => f.path);
  for (const p of ['index.html', 'app/index.html', '404.html', '_headers', 'assets/app.js', 'assets/workflow.js', 'packages/payguard-engine/src/index.js', 'packages/contracts/src/index.js', 'fixtures/payguard/pg-syn-001.bundle.json']) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
  for (const p of paths) {
    assert.doesNotMatch(p, /(^|\/)(\.|docs\/|tests?\/|README|AGENTS|PROGRAM|COST|SECURITY|PROJECT|package\.json|manifest\.json)/, `unexpected ${p}`);
  }
  assert.ok(manifest.totalBytes < 300_000, `static output ${manifest.totalBytes} bytes`);
  assert.match(readFileSync(join(OUT, '_headers'), 'utf8'), /Content-Security-Policy: default-src 'none'; script-src 'self'/);
});

test('preview server: MIME, headers, traversal and dotfile blocking', async (t) => {
  if (!existsSync(join(OUT, 'index.html'))) build(OUT);
  const server = createSiteServer(OUT);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); rmSync(OUT, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, init) => fetch(base + p, { redirect: 'manual', ...init });

  const home = await get('/');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await get('/app')).status, 301);
  assert.equal((await get('/app/')).status, 200);
  assert.equal((await get('/assets/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await get('/fixtures/payguard/pg-syn-001.application.csv')).headers.get('content-type'), 'text/csv; charset=utf-8');
  const engine = await get('/packages/payguard-engine/src/index.js');
  assert.equal(engine.status, 200);
  for (const bad of ['/../package.json', '/%2e%2e/package.json', '/assets/%2e%2e/%2e%2e/README.md', '/.git/config', '/assets/.hidden', '/%00', '/..%5cpackage.json']) {
    const r = await get(bad);
    assert.equal(r.status === 404 || r.status === 400, true, `${bad} -> ${r.status}`);
    assert.doesNotMatch(await r.text(), /"name": "payguard"|\[core\]/);
  }
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await get('/', { method: 'POST' })).status, 405);
});
