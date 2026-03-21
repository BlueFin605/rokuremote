import { test, expect } from '@playwright/test';

test.describe('Setup / Connect', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/setup');
  });

  test('should show setup page with IP input', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('RokuRemote');
    await expect(page.locator('input#ip')).toBeVisible();
    await expect(page.getByText('Find your Roku')).toBeVisible();
  });

  test('should connect to mock Roku and show device info', async ({ page }) => {
    await page.fill('input#ip', 'localhost');
    await page.click('button:has-text("Connect")');

    await expect(page.getByText('Mock Roku')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to remote after connecting', async ({ page }) => {
    await page.fill('input#ip', 'localhost');
    await page.click('button:has-text("Connect")');

    // Wait for the d-pad OK button on the remote view
    await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/remote/);
  });

  test('should auto-connect on revisit with saved IP', async ({ page }) => {
    await page.fill('input#ip', 'localhost');
    await page.click('button:has-text("Connect")');
    await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });

    // Reload — should auto-connect
    await page.goto('/');
    await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });
  });
});
