import { test, expect, Page } from '@playwright/test';
import { routeRokuToMock, routeTvOk } from './helpers';

// Setup drives the real UI: the empty-state Roku card. Edit/TV/multi-Roku flows live in multi-roku.spec.ts.
test.describe('Setup / Connect', () => {
  test.beforeEach(async ({ page }) => {
    await routeRokuToMock(page);
    await routeTvOk(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/setup');
  });

  async function connect(page: Page) {
    const card = page.getByTestId('new-roku-card');
    await card.getByTestId('card-roku-ip').fill('localhost');
    await card.getByTestId('card-save').click();
  }

  test('should show setup page with an empty Roku card', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('RokuRemote');
    await expect(page.getByTestId('new-roku-card').getByTestId('card-roku-ip')).toBeVisible();
    await expect(page.getByText("Find your Roku's IP")).toBeVisible();
  });

  test('should add the mock Roku and show its device name on the card', async ({ page }) => {
    await connect(page);
    await expect(page.locator('[data-testid^="roku-card-"]')).toContainText('Mock Roku', { timeout: 5000 });
  });

  test('should open the apps screen after tapping Use', async ({ page }) => {
    await connect(page);
    await page.locator('[data-testid^="use-"]').click();
    await expect(page).toHaveURL(/\/apps/);
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });
  });

  test('should auto-connect on revisit with saved Roku', async ({ page }) => {
    await connect(page);
    await expect(page.locator('[data-testid^="roku-card-"]')).toBeVisible({ timeout: 5000 });
    await page.goto('/');
    await expect(page).toHaveURL(/\/apps/);
  });
});
