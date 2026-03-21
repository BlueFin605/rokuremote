import { test, expect, Page } from '@playwright/test';

async function navigateToApps(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/setup');
  await page.fill('input#ip', 'localhost');
  await page.click('button:has-text("Connect")');
  await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });
  await page.click('button:has-text("Apps")');
  await expect(page).toHaveURL(/\/apps/);
}

test.describe('App Launcher', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToApps(page);
  });

  test('should display app grid with 14 tiles', async ({ page }) => {
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tile')).toHaveCount(14);
  });

  test('should display app icons', async ({ page }) => {
    await expect(page.locator('.tile img').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display known app names', async ({ page }) => {
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tile .name', { hasText: 'Netflix' })).toBeVisible();
    await expect(page.locator('.tile .name', { hasText: 'YouTube' })).toBeVisible();
  });

  test('should filter apps by search', async ({ page }) => {
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });

    await page.fill('input[placeholder="Search apps..."]', 'net');
    await expect(page.locator('.tile')).toHaveCount(1);
    await expect(page.locator('.tile .name', { hasText: 'Netflix' })).toBeVisible();
  });

  test('should show no results for bad search', async ({ page }) => {
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });

    await page.fill('input[placeholder="Search apps..."]', 'zzzzz');
    await expect(page.locator('.tile')).toHaveCount(0);
    await expect(page.getByText('No apps match')).toBeVisible();
  });

  test('should launch app and return to remote', async ({ page }) => {
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.tile', { hasText: 'Netflix' }).click();
    await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/remote/);
  });

  test('should toggle edit mode', async ({ page }) => {
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });

    await page.click('button:has-text("Edit")');
    await expect(page.locator('button:has-text("Done")')).toBeVisible();
    await expect(page.locator('.tile.editing').first()).toBeVisible();

    await page.click('button:has-text("Done")');
    await expect(page.locator('button:has-text("Edit")')).toBeVisible();
    await expect(page.locator('.tile.editing')).toHaveCount(0);
  });

  test('should not launch app in edit mode', async ({ page }) => {
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 5000 });

    await page.click('button:has-text("Edit")');
    // Force click bypasses Playwright's stability check (tile is animating/wiggling)
    await page.locator('.tile', { hasText: 'Netflix' }).click({ force: true });
    // Should still be on apps page — edit mode blocks launching
    await expect(page).toHaveURL(/\/apps/);
  });

  test('should navigate back to remote', async ({ page }) => {
    await page.locator('.back-btn').click();
    await expect(page).toHaveURL(/\/remote/);
  });
});
