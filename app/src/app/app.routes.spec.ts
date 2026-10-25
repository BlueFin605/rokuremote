import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { routes } from './app.routes';

function seed(ecpEnabled: boolean) {
  const roku = { id: 'a1', name: 'Lounge', ip: '10.0.0.1', ecpEnabled, deviceInfo: null, tv: { type: 'none', ip: null } };
  localStorage.setItem('rokus', JSON.stringify([roku]));
  localStorage.setItem('active-roku-id', 'a1');
}

describe('app routes', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
  });
  afterEach(() => localStorage.clear());

  const resolve = () => TestBed.runInInjectionContext(() => (routes[0].redirectTo as Function)({} as any));

  it('redirects to setup with nothing saved', () => {
    expect(resolve()).toBe('setup');
  });

  it('redirects to apps for an active Roku with ECP enabled', () => {
    seed(true);
    expect(resolve()).toBe('apps');
  });

  it('redirects to remote when ECP is disabled', () => {
    seed(false);
    expect(resolve()).toBe('remote');
  });
});
