// Browser QA for the built site, using an already-present Playwright library (nothing is installed).
// Not matched by plain `node --test`. Run after `node scripts/build.js`:
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node --test tests/e2e/browser-qa.mjs
// Serves dist/ in-process on 127.0.0.1 with a random port. No axe audit and no visual diffing here.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSiteServer } from '../../scripts/serve.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const tried = [process.env.PLAYWRIGHT_MODULE, 'playwright', join(dirname(process.execPath), '../lib/node_modules/playwright')].filter(Boolean);
  for (const c of tried) { try { return require(c); } catch { /* next */ } }
  throw new Error(`Playwright not found (tried ${tried.join(', ')}). Set PLAYWRIGHT_MODULE; this script installs nothing.`);
}

const id = (t) => `[data-testid="${t}"]`;
const sample = (n) => readFileSync(join(ROOT, 'fixtures/payguard', n));
let browser; let server; let BASE;

before(async () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'run node scripts/build.js first');
  server = createSiteServer(DIST);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  browser = await loadPlaywright().chromium.launch();
});
after(async () => { await browser?.close(); await new Promise((r) => (server ? server.close(r) : r())); });

/** Page whose console errors and uncaught exceptions are collected; `allow` lists expected error text. */
async function open(path, { allow = [], ...ctxOptions } = {}) {
  const ctx = await browser.newContext(ctxOptions);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !allow.some((a) => m.text().includes(a))) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  if (path) await page.goto(`${BASE}${path}`);
  return { page, ctx, errors, done: async () => { await ctx.close(); assert.deepEqual(errors, [], 'console errors'); } };
}

async function until(fn, what, timeout = 5000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last === true) return; } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.fail(`${what}; last value: ${JSON.stringify(last)}`);
}
const textOf = async (page, t) => (await page.locator(id(t)).first().innerText()).trim();
const expectText = (page, t, want) => until(async () => { const s = await textOf(page, t); return (want instanceof RegExp ? want.test(s) : s === want) || s; }, `${t} should be ${want}`);
const download = async (page, t) => {
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator(id(t)).click()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
};

test('landing proof renders every slot from the real engine; skip control and CTA work', async () => {
  const { page, done } = await open('/');
  await until(async () => (await page.locator('#proof').getAttribute('data-state')) === 'ready', 'proof ready');
  const slots = await page.$$eval('#main [data-f]', (els) => Object.fromEntries(els.map((e) => [e.dataset.f, e.textContent.trim()])));
  assert.equal(Object.keys(slots).length, 17);
  for (const [k, v] of Object.entries(slots)) assert.ok(v && !v.includes('…') && !v.includes('Calculating'), `slot ${k} not filled: ${v}`);
  assert.equal(slots.due, '45,000.00');
  assert.equal(slots.claimed, '50,000.00');
  assert.equal(slots.diff, '+5,000.00 difference');
  assert.equal(slots.posted, '40,500.00');
  assert.equal(slots.clause, 'Demo Exhibit B §3');
  assert.ok(await page.locator('[data-f="lines"] tr').count() >= 2);
  assert.ok(await page.locator(id('landing-limitations')).locator('li').count() > 1, 'engine limitations replace the static one');
  // Motion allowed: the skip control appears, then hides on click and moves focus to the document title.
  const skip = page.locator(id('proof-skip'));
  if (await skip.isVisible()) {
    await skip.click();
    await until(async () => !(await skip.isVisible()), 'skip hides');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'proof-title');
  }
  await until(async () => !(await skip.isVisible()), 'skip hides after the sequence');
  await page.locator(id('cta-open-review')).click();
  await page.waitForURL(/\/app\/$/);
  await done();
});

test('landing reduced motion: final figures, no skip control', async () => {
  const { page, done } = await open('/', { reducedMotion: 'reduce' });
  await expectText(page, 'proof-difference', '+5,000.00 difference');
  assert.equal(await page.locator(id('proof-skip')).isVisible(), false);
  assert.equal(await page.locator('#proof').getAttribute('class'), 'sheet', 'no alignment animation class');
  await done();
});

test('landing fallbacks explain the failure in plain words and never show raw exceptions', async () => {
  const raw = /TypeError|Cannot set|null|undefined|Landing slots missing/;
  // 1. A sample file is unavailable.
  {
    const { page, ctx, done } = await open(null, { allow: ['404'] });
    await ctx.route('**/fixtures/payguard/pg-syn-001.bundle.json', (r) => r.fulfill({ status: 404, body: 'gone' }));
    await page.goto(`${BASE}/`);
    await until(async () => (await page.locator('#proof').getAttribute('data-state')) === 'error', 'error state');
    const msg = await textOf(page, 'proof-error');
    assert.match(msg, /could not be calculated\. Sample file pg-syn-001\.bundle\.json could not be loaded \(HTTP 404\)\./);
    assert.doesNotMatch(msg, raw);
    assert.equal(await page.locator(`${id('proof-error')} a[href="./app/"]`).count(), 1);
    await expectText(page, 'proof-difference', 'Not calculated');
    await done();
  }
  // 2. An unexpected script failure (a slot removed from the page): generic text, details only in the console.
  {
    const { page, ctx, errors, done } = await open(null, { allow: ['PayGuard landing proof failed'] });
    await ctx.route(`${BASE}/`, async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, body: (await res.text()).replace('data-f="clause"', 'data-x="clause"') });
    });
    await page.goto(`${BASE}/`);
    await until(async () => (await page.locator('#proof').getAttribute('data-state')) === 'error', 'error state');
    const msg = await textOf(page, 'proof-error');
    assert.match(msg, /An unexpected error stopped the calculation in this browser\..*Open the review workspace/);
    assert.doesNotMatch(msg, raw);
    assert.doesNotMatch(await page.locator('#proof').innerText(), raw);
    assert.deepEqual(errors, []);
    await done();
  }
});

test('reviewer journey by keyboard: filters, evidence labels, review note, correction, rerun, history, exports', async () => {
  const { page, done } = await open('/app/');
  await page.locator(id('empty-state')).waitFor();
  await page.locator(id('load-sample-csv')).focus();
  await page.keyboard.press('Enter');
  await expectText(page, 'difference', '+5,000.00');
  await expectText(page, 'calculated-due', '45,000.00');
  await expectText(page, 'claimed-due', '50,000.00');
  await expectText(page, 'readiness', /Not ready/);
  assert.match(await textOf(page, 'source-name'), /CSV/);

  // Filters.
  await page.locator(id('findings-search')).fill('waiver');
  await expectText(page, 'findings-count', /Showing 1 of 3/);
  await page.locator(id('findings-clear')).click();
  await expectText(page, 'findings-count', /3 of 3|Showing 3/);
  await page.locator(id('findings-severity')).selectOption('BLOCKING');
  await until(async () => (await page.locator(`${id('findings-list')} button.finding`).count()) === 2, 'two blocking findings');
  await page.locator(id('findings-clear')).click();
  await page.locator(id('findings-sort')).selectOption('code');

  // Evidence: readable USD labels beside formatted dollars.
  await page.locator(id('finding-CLAIMED_DUE_MISMATCH')).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/finding=/);
  const kv = async (t) => page.$$eval(`${id(t)} > dt`, (dts) => dts.map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  const observed = await kv('evidence-observed');
  const expected = await kv('evidence-expected');
  assert.deepEqual(observed, [['Claimed current due (current period), USD', '50,000.00'], ['Difference, claimed minus calculated, USD', '+5,000.00']]);
  assert.deepEqual(expected, [['Calculated current due (current period), USD', '45,000.00'], ['Tolerance, USD', '0.00']]);
  await page.locator(id('finding-PENDING_CHANGE_ORDER_CONTEXT')).click();
  for (const [k] of [...await kv('evidence-observed'), ...await kv('evidence-expected')]) assert.doesNotMatch(k, /Cents/);
  await page.locator(id('finding-MISSING_REQUIRED_SIGNED_WAIVER')).click();
  await expectText(page, 'rejected-candidates', /DOC-WV-OCT-UNSIGNED[\s\S]*DOC-WV-SEP-SIGNED/);
  await expectText(page, 'evidence-clause', /Demo Exhibit B §3 \(illustrative contract condition, not law\)/);

  // Acknowledge with an HTML-looking note: shown as text, never parsed.
  const note = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  await page.locator(id('review-disposition')).selectOption('ACKNOWLEDGED');
  await page.locator(id('review-note')).fill(note);
  await page.locator(id('review-submit')).click();
  await expectText(page, 'review-history', /Acknowledged/);
  assert.ok((await textOf(page, 'review-history')).includes(note));
  assert.equal(await page.locator(`${id('review-history')} img, ${id('review-history')} script`).count(), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);

  // Correct the claim, attach the corrected waiver, rerun.
  await page.locator(id('claim-input')).fill('45000');
  await page.locator(id('stage-claim')).click();
  await page.locator(id('attach-waiver')).click();
  await expectText(page, 'staged', /45000|45,000/);
  await page.locator(id('rerun')).click();
  await expectText(page, 'difference', '0.00');
  await expectText(page, 'readiness', /No blocking findings/);
  await expectText(page, 'findings-gone', /Required signed waiver/);
  await page.locator(id('findings-severity')).selectOption('BLOCKING');
  await page.locator(id('findings-empty')).waitFor();
  await page.locator(id('findings-clear')).click();
  const run2 = JSON.parse((await download(page, 'export-json')).text);
  assert.equal(run2.totals.claimDiscrepancyCents, 0);
  assert.equal(run2.readiness, 'NO_BLOCKING_FINDINGS');

  // Run 1 is unchanged in history and exports raw integer cents.
  await page.locator(id('run-select')).selectOption('1');
  await expectText(page, 'difference', '+5,000.00');
  await page.locator(id('older-run-note')).waitFor();
  const json = await download(page, 'export-json');
  assert.equal(json.name, 'payguard-PG-A-003-run-1.json');
  const rep = JSON.parse(json.text);
  assert.equal(rep.totals.calculatedCurrentDueCents, 4500000);
  assert.equal(rep.totals.claimDiscrepancyCents, 500000);
  assert.deepEqual(rep.findings.find((f) => f.code === 'CLAIMED_DUE_MISMATCH').observed, { claimedCurrentDueCents: 5000000, claimDiscrepancyCents: 500000 });
  assert.ok(rep.reviewEvents.some((e) => e.note === note && e.disposition === 'ACKNOWLEDGED'));
  const csv = await download(page, 'export-csv');
  assert.equal(csv.name, 'payguard-PG-A-003-run-1.csv');
  assert.match(csv.text, /"TOTAL",[^\n]*"claimDiscrepancy",[^\n]*"5000\.00"/);
  await page.goBack();
  await until(async () => (await page.locator(id('run-select')).inputValue()) === '2', 'back returns to run 2');
  await done();
});

test('invalid JSON, impossible date and oversize upload each keep the previous report', async () => {
  const { page, done } = await open('/app/');
  await page.locator(id('load-sample-json')).click();
  await expectText(page, 'difference', '+5,000.00');
  const upload = (name, mimeType, buffer) => page.locator(id('import-file')).setInputFiles({ name, mimeType, buffer });
  const badDate = JSON.parse(sample('pg-syn-001.application.json'));
  badDate.periodEnd = '2026-02-30';
  for (const [name, type, buf, code] of [
    ['bad.json', 'application/json', Buffer.from('{'), null],
    ['bad-date.json', 'application/json', Buffer.from(JSON.stringify(badDate)), /date/i],
    ['big.csv', 'text/csv', Buffer.alloc(1_048_577, 0x41), /INPUT_TOO_LARGE/],
  ]) {
    await upload(name, type, buf);
    await expectText(page, 'error-panel', /previous report \(run 1\) is unchanged/);
    if (code) await expectText(page, 'error-list', code);
    await expectText(page, 'difference', '+5,000.00');
    assert.equal(await page.locator(`${id('run-select')} option`).count(), 1);
    await page.locator(id('error-dismiss')).click();
  }
  await done();
});

test('skip link used while the sample project is still loading does not break the workspace', async () => {
  const { page, ctx, done } = await open(null);
  await ctx.route('**/fixtures/payguard/pg-syn-001.bundle.json', async (r) => { await new Promise((ok) => setTimeout(ok, 400)); r.continue(); });
  await page.goto(`${BASE}/app/`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForURL(/#main$/);
  await page.locator(id('load-sample-json')).click();
  await expectText(page, 'difference', '+5,000.00');
  await done();
});

test('390px mobile: no page overflow; skip link is the first stop and reaches main', async () => {
  for (const path of ['/', '/app/']) {
    const { page, done } = await open(path, { viewport: { width: 390, height: 844 } });
    if (path === '/app/') {
      await page.locator(id('load-sample-json')).click();
      await expectText(page, 'difference', '+5,000.00');
      await page.locator(id('ledger-region')).waitFor();
    } else {
      await until(async () => (await page.locator('#proof').getAttribute('data-state')) === 'ready', 'proof ready');
      // Page overflow alone misses figures clipped inside the sheet; every proof element must fit it
      // once the entrance sequence (the slip slides in from the right) has finished.
      await until(async () => !(await page.locator('#proof').getAttribute('class')).includes('align-run'), 'alignment sequence ends');
      const spill = await page.evaluate(() => {
        const sheet = document.querySelector('#proof').getBoundingClientRect();
        return [...document.querySelectorAll('#proof *')].filter((e) => e.getClientRects().length)
          .map((e) => [e.tagName, e.textContent.trim().slice(0, 30), Math.round(e.getBoundingClientRect().right - sheet.right)])
          .filter(([, , over]) => over > 0);
      });
      assert.deepEqual(spill, [], 'proof content spills past the sheet');
      assert.ok((await page.locator('#proof').boundingBox()).width >= 340, 'sheet uses the column width');
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${path} overflows by ${overflow}px`);
    await page.evaluate(() => document.activeElement?.blur());
    await page.goto(`${BASE}${path}`);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), 'Skip to content');
    await page.keyboard.press('Enter');
    await page.waitForURL(/#main$/);
    await done();
  }
});
