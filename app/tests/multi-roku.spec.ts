import { test, expect, Page } from '@playwright/test';

// The app talks to the Roku through the proxy (default http://roku-proxy/api/roku/<path>?ip=<ip>).
// That proxy is not running in the test environment, so forward those calls straight to the mock
// Roku (port 8060) to keep the tests deterministic. Any IP maps to the same mock.
const MOCK = 'http://localhost:8060';

async function routeRokuToMock(page: Page) {
  await page.route(/\/api\/roku\//, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/roku/, '');
    let status: number, headers: Record<string, string>, body: Buffer;
    try {
      // Read the body up front: fulfilling with the live APIResponse races page navigation,
      // which disposes it ("Fetch response has been disposed").
      const response = await route.fetch({ url: `${MOCK}${path}` });
      status = response.status();
      headers = { ...response.headers(), 'access-control-allow-origin': '*' };
      body = await response.body();
    } catch (e) {
      // A request cancelled by navigation/teardown is harmless. A mock that is down is not:
      // fail the request so the test sees the failure.
      if (/disposed|closed|aborted|Target page|interrupted/i.test(String(e))) return;
      await route.abort().catch(() => {});
      return;
    }
    await route.fulfill({ status, headers, body }).catch(e => {
      if (!/handled|disposed|closed|aborted|Target page|interrupted|Route is/i.test(String(e))) throw e;
    });
  });
}

async function addRoku(page: Page, ip: string) {
  await page.goto('/setup');
  // The button only exists once at least one Roku is saved; don't wait on it otherwise.
  const addAnother = page.locator('button:has-text("Add another Roku")');
  if (await addAnother.count()) await addAnother.click();
  await page.fill('input#ip', ip);
  await page.click('button:has-text("Save / Add")');
  await expect(page.locator('.roku-status.success')).toBeVisible({ timeout: 5000 });
}

test.describe('Multiple Rokus', () => {
  test.beforeEach(async ({ page }) => {
    await routeRokuToMock(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('adds two Rokus and lists both on setup', async ({ page }) => {
    await addRoku(page, 'localhost');
    await addRoku(page, '127.0.0.1');
    await expect(page.locator('.roku-item')).toHaveCount(2);
  });

  test('switches Roku from the header dropdown', async ({ page }) => {
    await addRoku(page, 'localhost');
    await addRoku(page, '127.0.0.1');
    await page.goto('/remote');
    // Both Rokus share the mock, hence the same name: prove the switch via storage, not the label.
    const readActive = () => page.evaluate(() => {
      const rokus = JSON.parse(localStorage.getItem('rokus') || '[]');
      const id = localStorage.getItem('active-roku-id');
      const entry = rokus.find((r: any) => r.id === id);
      return { id, ip: entry?.ip as string | undefined };
    });
    const before = await readActive();
    expect(before.id).toBeTruthy();

    const items = page.locator('app-roku-switcher .menu li');
    await page.click('app-roku-switcher .current');
    await expect(items).toHaveCount(3); // two Rokus + Manage
    const activeIndexBefore = await items.evaluateAll(els => els.findIndex(e => e.classList.contains('active')));
    expect(activeIndexBefore).toBeGreaterThanOrEqual(0);
    await page.locator('app-roku-switcher .menu li:not(.active):not(.manage)').click();

    await expect.poll(async () => (await readActive()).id).not.toBe(before.id);
    const after = await readActive();
    expect(after.ip).toBeTruthy();
    expect(after.ip).not.toBe(before.ip);

    await page.click('app-roku-switcher .current');
    await expect(items).toHaveCount(3);
    const activeIndexAfter = await items.evaluateAll(els => els.findIndex(e => e.classList.contains('active')));
    expect(activeIndexAfter).toBeGreaterThanOrEqual(0);
    expect(activeIndexAfter).not.toBe(activeIndexBefore);
  });

  test('launch goes straight to the apps screen when a Roku is saved', async ({ page }) => {
    await addRoku(page, 'localhost');
    await page.goto('/');
    await expect(page).toHaveURL(/\/apps/);
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });
  });

  test('launch with nothing saved goes to setup', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/);
  });

  test('unreachable Roku lands on setup with an explanation', async ({ page }) => {
    await addRoku(page, 'localhost');
    // Playwright runs later-registered routes first, so this abort must be registered
    // after the forward-to-mock route from beforeEach to take precedence.
    await page.route(/\/api\/roku\/query\/device-info\?ip=localhost/, route => route.abort());
    await page.goto('/');
    const banner = page.locator('[data-testid=unreachable-banner]');
    await expect(banner).toContainText("Couldn't reach", { timeout: 8000 });
    await expect(banner).toContainText('localhost');
    await expect(page).toHaveURL(/\/setup/);
  });

  test('legacy single-Roku storage migrates and opens apps', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('roku-ip', 'localhost'));
    await page.goto('/');
    await expect(page).toHaveURL(/\/apps/);
    expect(await page.evaluate(() => localStorage.getItem('roku-ip'))).toBeNull();
  });
});
