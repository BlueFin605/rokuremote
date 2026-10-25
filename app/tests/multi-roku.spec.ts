import { test, expect, Page } from '@playwright/test';

// The app talks to the Roku through the proxy (default http://roku-proxy/api/roku/<path>?ip=<ip>).
// That proxy is not running in the test environment, so forward those calls straight to the mock
// Roku (port 8060) to keep the tests deterministic. Any IP maps to the same mock.
const MOCK = 'http://localhost:8060';

async function routeRokuToMock(page: Page) {
  await page.route(/\/api\/roku\//, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/roku/, '');
    const response = await route.fetch({ url: `${MOCK}${path}` });
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'access-control-allow-origin': '*' },
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
    await page.click('app-roku-switcher .current');
    await expect(page.locator('app-roku-switcher .menu li')).toHaveCount(3); // two Rokus + Manage
    await page.locator('app-roku-switcher .menu li').first().click();
    await expect(page.locator('app-roku-switcher .current')).toContainText('Roku');
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
    await page.route(/\/api\/roku\/query\/device-info\?ip=localhost/, route => route.abort());
    await page.goto('/');
    await expect(page.locator('[data-testid=unreachable-banner]')).toContainText("Couldn't reach", { timeout: 8000 });
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
