import { test, expect, Page } from '@playwright/test';

async function connectToMock(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/setup');
  await page.fill('input#ip', 'localhost');
  await page.click('button:has-text("Connect")');
  await expect(page.locator('.dpad-btn.ok')).toBeVisible({ timeout: 5000 });
}

test.describe('Remote Control', () => {
  test.beforeEach(async ({ page }) => {
    await connectToMock(page);
  });

  test('should display all remote buttons', async ({ page }) => {
    await expect(page.locator('button:has-text("Back")')).toBeVisible();
    await expect(page.locator('button:has-text("Home")')).toBeVisible();
    await expect(page.locator('button:has-text("Apps")')).toBeVisible();
    await expect(page.locator('button:has-text("Power")')).toBeVisible();
    await expect(page.locator('.dpad-btn.ok')).toBeVisible();
    await expect(page.locator('button:has-text("Mute")')).toBeVisible();
    await expect(page.locator('button:has-text("Vol +")')).toBeVisible();
    await expect(page.locator('button:has-text("Vol −")')).toBeVisible();
  });

  test('should have d-pad directional buttons', async ({ page }) => {
    const dpad = page.locator('.dpad');
    await expect(dpad.locator('.up')).toBeVisible();
    await expect(dpad.locator('.down')).toBeVisible();
    await expect(dpad.locator('.left')).toBeVisible();
    await expect(dpad.locator('.right')).toBeVisible();
  });

  test('should remain connected after clicking a button', async ({ page }) => {
    await page.click('button:has-text("Home")');
    // If the request fails, the disconnected banner would appear
    await page.waitForTimeout(500);
    await expect(page.locator('.banner')).not.toBeVisible();
  });

  test('should have a text input field', async ({ page }) => {
    await expect(page.locator('input[placeholder="Type text..."]')).toBeVisible();
  });

  test('should clear text input after sending', async ({ page }) => {
    await page.fill('input[placeholder="Type text..."]', 'Hello');
    await page.click('button:has-text("Send")');
    await expect(page.locator('input[placeholder="Type text..."]')).toHaveValue('');
  });

  test('should navigate to apps page', async ({ page }) => {
    await page.click('button:has-text("Apps")');
    await expect(page).toHaveURL(/\/apps/);
  });

  test('should navigate to private listening page', async ({ page }) => {
    await page.click('button:has-text("Private Listening")');
    await expect(page).toHaveURL(/\/audio/);
  });

  test('should disconnect and return to setup', async ({ page }) => {
    await page.click('button:has-text("Disconnect")');
    await expect(page).toHaveURL(/\/setup/);
  });
});
