import { Page } from '@playwright/test';

// The app talks to the Roku through the proxy (default http://roku-proxy/api/roku/<path>?ip=<ip>).
// That proxy is not running in the test environment, so forward those calls straight to the mock
// Roku (port 8060) to keep the tests deterministic. Any IP maps to the same mock.
export const MOCK = 'http://localhost:8060';

export async function routeRokuToMock(page: Page) {
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

export async function routeTvOk(page: Page) {
  await page.route(/\/api\/tv\//, route => route.fulfill({
    status: 200,
    headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
    body: JSON.stringify({ volume: 10 }),
  }));
}

// Seed a saved Roku (pointing at the mock) and make it active, bypassing the setup UI.
// Seeds once per tab so later reloads/navigations keep whatever the app has done to storage.
export async function seedRoku(page: Page, opts: { name?: string; ip?: string; id?: string } = {}) {
  const name = opts.name ?? 'Mock Roku';
  const roku = {
    id: opts.id ?? 'mock-roku-1',
    name,
    ip: opts.ip ?? 'localhost',
    ecpEnabled: true,
    deviceInfo: { name, model: 'Roku Mock Device', supportsPrivateListening: true, ecpEnabled: true },
    tv: { type: 'none', ip: null },
  };
  await page.addInitScript(r => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('rokus', JSON.stringify([r]));
      localStorage.setItem('active-roku-id', r.id);
      sessionStorage.setItem('seeded', '1');
    }
  }, roku);
  return roku;
}
