import { test, expect, Page } from '@playwright/test';

import { routeRokuToMock, routeTvOk } from './helpers';

// Add a Roku through the new-Roku card on /setup (shown as the empty card, or after "Add Roku").
async function addRoku(page: Page, ip: string, name?: string) {
  await page.goto('/setup');
  const addBtn = page.getByTestId('add-roku');
  if (await addBtn.count()) await addBtn.click();
  const card = page.getByTestId('new-roku-card');
  await card.getByTestId('card-roku-ip').fill(ip);
  if (name) await card.getByTestId('card-name').fill(name);
  await card.getByTestId('card-save').click();
  await expect(page.getByTestId('new-roku-card')).toHaveCount(0, { timeout: 5000 });
}

const storedRokus = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rokus') || '[]'));

test.describe('Multiple Rokus', () => {
  test.beforeEach(async ({ page }) => {
    await routeRokuToMock(page);
    await routeTvOk(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('adds two Rokus and lists both on setup', async ({ page }) => {
    await addRoku(page, 'localhost');
    await addRoku(page, '127.0.0.1');
    await expect(page.locator('[data-testid^="roku-card-"]')).toHaveCount(2);
    expect((await storedRokus(page)).map((r: any) => r.ip)).toEqual(['localhost', '127.0.0.1']);
  });

  test('edits a Roku name and IP from its card', async ({ page }) => {
    await addRoku(page, 'localhost');
    const [r] = await storedRokus(page);
    await page.goto('/setup');
    await page.getByTestId(`edit-${r.id}`).click();
    await page.getByTestId('card-name').fill('Living Room');
    await page.getByTestId('card-roku-ip').fill('127.0.0.1');
    await page.getByTestId('card-save').click();
    const card = page.getByTestId(`roku-card-${r.id}`);
    await expect(card).toContainText('Living Room');
    await expect(card).toContainText('127.0.0.1');
    const [after] = await storedRokus(page);
    expect(after.name).toBe('Living Room');
    expect(after.ip).toBe('127.0.0.1');
  });

  test('cancelling an edit keeps the Roku unchanged', async ({ page }) => {
    await addRoku(page, 'localhost');
    const [r] = await storedRokus(page);
    await page.goto('/setup');
    await page.getByTestId(`edit-${r.id}`).click();
    await page.getByTestId('card-name').fill('Should Not Stick');
    await page.getByTestId('card-cancel').click();
    await expect(page.getByTestId('card-edit')).toHaveCount(0);
    await expect(page.getByTestId(`roku-card-${r.id}`)).not.toContainText('Should Not Stick');
    const [after] = await storedRokus(page);
    expect(after.name).toBe(r.name);
  });

  test('sets a Panasonic TV on a Roku card and shows it in the TV row', async ({ page }) => {
    await addRoku(page, 'localhost');
    const [r] = await storedRokus(page);
    await page.goto('/setup');
    const card = page.getByTestId(`roku-card-${r.id}`);
    await expect(card).toContainText('No TV');
    await page.getByTestId(`edit-${r.id}`).click();
    await page.getByTestId('card-tv-type').selectOption('panasonic');
    await page.getByTestId('card-tv-ip').fill('192.168.1.50');
    await page.getByTestId('card-save').click();
    await expect(page.getByTestId('card-edit')).toHaveCount(0, { timeout: 5000 });
    await expect(card).toContainText('Panasonic Viera 192.168.1.50');
    const [after] = await storedRokus(page);
    expect(after.tv).toEqual({ type: 'panasonic', ip: '192.168.1.50' });
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

    const items = page.locator('app-roku-switcher .menu li button');
    await page.click('app-roku-switcher .current');
    await expect(items).toHaveCount(3); // two Rokus + Manage
    const activeIndexBefore = await items.evaluateAll(els => els.findIndex(e => e.parentElement!.classList.contains('active')));
    expect(activeIndexBefore).toBeGreaterThanOrEqual(0);
    await page.locator('app-roku-switcher .menu li:not(.active):not(.manage) button').click();

    await expect.poll(async () => (await readActive()).id).not.toBe(before.id);
    const after = await readActive();
    expect(after.ip).toBeTruthy();
    expect(after.ip).not.toBe(before.ip);

    await page.click('app-roku-switcher .current');
    await expect(items).toHaveCount(3);
    const activeIndexAfter = await items.evaluateAll(els => els.findIndex(e => e.parentElement!.classList.contains('active')));
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
