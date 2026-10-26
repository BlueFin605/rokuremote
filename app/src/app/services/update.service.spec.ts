import { TestBed } from '@angular/core/testing';
import { HTTP_GET, INSTALLED_VERSION, LATEST_URL, UpdateService, versionNumber } from './update.service';
import { NativeInfoService } from './native-info.service';

describe('UpdateService', () => {
  let get: jasmine.Spy;
  let native: { isNative: boolean; getAppVersion: jasmine.Spy };

  function setup(opts: { isNative?: boolean; installed?: string; nativeVersion?: string | null } = {}) {
    native = {
      isNative: opts.isNative ?? true,
      getAppVersion: jasmine.createSpy().and.resolveTo(opts.nativeVersion ?? '1.0.10'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: HTTP_GET, useValue: get },
        { provide: NativeInfoService, useValue: native },
        { provide: INSTALLED_VERSION, useValue: opts.installed ?? '1.0.5' },
      ],
    });
    return TestBed.inject(UpdateService);
  }
  const ok = (data: unknown) => get.and.resolveTo({ status: 200, data });
  const bundle = (version: string, min = '1.0.1') => ({ version, url: 'u', minNativeVersion: min });

  beforeEach(() => { get = jasmine.createSpy('get'); });

  it('versionNumber parses last segment', () => {
    expect(versionNumber('1.0.42')).toBe(42);
    expect(versionNumber('dev')).toBe(0);
  });

  it('newer -> available', async () => {
    ok(bundle('1.0.6')); const s = setup(); await s.check();
    expect(s.state).toBe('available');
    expect(s.latest?.version).toBe('1.0.6');
    expect(get.calls.first().args[0].url).toContain(LATEST_URL + '?t=');
  });
  it('same -> none', async () => { ok(bundle('1.0.5')); const s = setup(); await s.check(); expect(s.state).toBe('none'); });
  it('older -> none', async () => { ok(bundle('1.0.4')); const s = setup(); await s.check(); expect(s.state).toBe('none'); });
  it('min native above installed -> native-required', async () => {
    ok(bundle('1.0.6', '1.0.20')); const s = setup({ nativeVersion: '1.0.10' }); await s.check();
    expect(s.state).toBe('native-required');
  });
  it('fetch rejects -> none', async () => {
    get.and.rejectWith(new Error('x')); const s = setup(); await s.check(); expect(s.state).toBe('none');
  });
  it('404 / html body -> none', async () => {
    get.and.resolveTo({ status: 404, data: '<html>' }); let s = setup(); await s.check(); expect(s.state).toBe('none');
  });
  it('html body with 200 -> none', async () => {
    ok('<html></html>'); const s = setup(); await s.check(); expect(s.state).toBe('none');
  });
  it('not native -> no fetch, none', async () => {
    const s = setup({ isNative: false }); await s.check();
    expect(get).not.toHaveBeenCalled(); expect(s.state).toBe('none');
  });
  it('emits on changes$', async () => {
    ok(bundle('1.0.6')); const s = setup(); await s.check();
    expect(s.changes$.value).toBe('available');
  });
});
