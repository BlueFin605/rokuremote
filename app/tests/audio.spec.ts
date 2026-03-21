import { test, expect, Page } from '@playwright/test';

async function navigateToAudio(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/setup');
  await page.fill('input#ip', 'localhost');
  await page.click('button:has-text("Connect")');
  await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });
  await page.click('button:has-text("Private Listening")');
  await expect(page).toHaveURL(/\/audio/);
}

test.describe('Private Listening (Audio View)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToAudio(page);
  });

  test('should display audio proxy URL input', async ({ page }) => {
    await expect(page.locator('input#proxy-url')).toBeVisible();
  });

  test('should show proxy not found when proxy is not running', async ({ page }) => {
    // Default proxy URL is localhost:8080 — no proxy running
    await expect(page.getByText('Audio proxy not found')).toBeVisible({ timeout: 5000 });
  });

  test('should show start button hint with command', async ({ page }) => {
    await expect(page.locator('code', { hasText: 'roku-proxy' })).toBeVisible({ timeout: 5000 });
  });

  test('should navigate back to remote', async ({ page }) => {
    await page.locator('.back-btn').click();
    await expect(page).toHaveURL(/\/remote/);
  });
});
