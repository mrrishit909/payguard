// PORTABLE PLAYWRIGHT SCENARIOS. NOT RUN by the implementer. Not matched by `node --test`.
// Requires an already-approved @playwright/test and a preview at BASE_URL
// (node scripts/serve.js dist 4173). Example: BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const id = (t) => `[data-testid="${t}"]`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.__errors = errors;
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

test('landing proof shows engine-calculated $5,000 difference and links to the workspace', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.locator(id('proof-document'))).toHaveAttribute('data-state', 'ready');
  await expect(page.locator(id('proof-difference'))).toHaveText('+5,000.00 difference');
  await expect(page.locator(id('synthetic-label'))).toContainText('SYNTHETIC DEMO DATA');
  await page.locator(id('cta-open-review')).click();
  await expect(page).toHaveURL(/\/app\/$/);
});

test('full reviewer journey with keyboard', async ({ page }) => {
  await page.goto(`${BASE}/app/`);
  await expect(page.locator(id('empty-state'))).toBeVisible();
  await page.locator(id('load-sample-csv')).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(id('difference'))).toHaveText('+5,000.00');
  await expect(page.locator(id('calculated-due'))).toHaveText('45,000.00');
  await expect(page.locator(id('readiness'))).toHaveText(/Not ready/);
  await page.locator(id('findings-search')).fill('waiver');
  await expect(page.locator(id('findings-count'))).toHaveText(/Showing 1 of 3/);
  await page.locator(id('finding-MISSING_REQUIRED_SIGNED_WAIVER')).click();
  await expect(page.locator(id('rejected-candidates'))).toContainText('DOC-WV-OCT-UNSIGNED');
  await expect(page.locator(id('rejected-candidates'))).toContainText('DOC-WV-SEP-SIGNED');
  await expect(page).toHaveURL(/finding=MISSING_REQUIRED_SIGNED_WAIVER/);
  await page.locator(id('findings-clear')).click();
  await page.locator(id('findings-sort')).selectOption('code');
  await page.locator(id('review-disposition')).selectOption('CORRECTION_SUBMITTED');
  await page.locator(id('review-note')).fill('<script>alert(1)</script>');
  await page.locator(id('review-submit')).click();
  await expect(page.locator(id('review-history'))).toContainText('<script>alert(1)</script>');
  await page.locator(id('claim-input')).fill('45000.00');
  await page.locator(id('stage-claim')).click();
  await page.locator(id('attach-waiver')).click();
  await page.locator(id('rerun')).click();
  await expect(page.locator(id('difference'))).toHaveText('0.00');
  await expect(page.locator(id('readiness'))).toHaveText(/No blocking findings/);
  await expect(page.locator(id('findings-gone'))).toContainText('Required signed waiver');
  await page.locator(id('findings-severity')).selectOption('BLOCKING');
  await expect(page.locator(id('findings-empty'))).toBeVisible();
  await page.locator(id('run-select')).selectOption('1');
  await expect(page.locator(id('difference'))).toHaveText('+5,000.00');
  const [json] = await Promise.all([page.waitForEvent('download'), page.locator(id('export-json')).click()]);
  expect(json.suggestedFilename()).toBe('payguard-PG-A-003-run-1.json');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.locator(id('export-csv')).click()]);
  expect(csv.suggestedFilename()).toBe('payguard-PG-A-003-run-1.csv');
  await page.goBack();
  await expect(page.locator(id('run-select'))).toHaveValue('2');
});

test('invalid and oversize upload keep the previous report', async ({ page }) => {
  await page.goto(`${BASE}/app/`);
  await page.locator(id('load-sample-json')).click();
  await expect(page.locator(id('difference'))).toHaveText('+5,000.00');
  await page.locator(id('import-file')).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.locator(id('error-panel'))).toContainText('previous report (run 1) is unchanged');
  await page.locator(id('import-file')).setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.alloc(1_048_577, 0x41) });
  await expect(page.locator(id('error-list'))).toContainText('INPUT_TOO_LARGE');
  await expect(page.locator(id('difference'))).toHaveText('+5,000.00');
});

test('390px mobile: no horizontal page overflow, ledger scrolls in its region', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/app/']) {
    await page.goto(`${BASE}${path}`);
    if (path === '/app/') await page.locator(id('load-sample-json')).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
  await expect(page.locator(id('ledger-region'))).toBeVisible();
});

test('reduced motion: final state, no skip control', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await expect(page.locator(id('proof-difference'))).toHaveText('+5,000.00 difference');
  await expect(page.locator(id('proof-skip'))).toBeHidden();
  await ctx.close();
});
