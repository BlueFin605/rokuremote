import { test, expect, Page } from '@playwright/test';
import { routeRokuToMock, routeTvOk, seedRoku } from './helpers';

async function navigateToAudio(page: Page) {
  await seedRoku(page);
  await page.goto('/remote');
  await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });
  await page.click('button:has-text("Private Listening")');
  await expect(page).toHaveURL(/\/audio/);
}

test.describe('Private Listening (Audio View)', () => {
  test.beforeEach(async ({ page }) => {
    await routeRokuToMock(page);
    await routeTvOk(page);
    // Same-origin proxy mode would otherwise hit ng serve's SPA fallback and look 'available'.
    await page.route(/\/api\/status/, route => route.abort());
    await navigateToAudio(page);
  });

  test('should show proxy not found when proxy is not running', async ({ page }) => {
    await expect(page.getByText('Audio proxy not found')).toBeVisible({ timeout: 5000 });
  });

  test('should hint to check proxy settings or start roku-proxy', async ({ page }) => {
    await expect(page.getByText('make sure roku-proxy is running')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate back to remote', async ({ page }) => {
    await page.locator('.back-btn', { hasText: 'Remote' }).click();
    await expect(page).toHaveURL(/\/remote/);
  });
});
