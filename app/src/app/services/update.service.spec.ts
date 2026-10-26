import { TestBed } from '@angular/core/testing';
import { HTTP_GET, INSTALLED_VERSION, LATEST_URL, UPDATER_PLUGIN, UpdateService, versionNumber } from './update.service';
import { NativeInfoService } from './native-info.service';

describe('UpdateService', () => {
  let get: jasmine.Spy;
  let native: { isNative: boolean; getAppVersion: jasmine.Spy };

  function setup(opts: { isNative?: boolean; installed?: string; nativeVersion?: string | null; plugin?: unknown } = {}) {
    native = {
      isNative: opts.isNative ?? true,
      getAppVersion: jasmine.createSpy().and.resolveTo(opts.nativeVersion ?? '1.0.10'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: HTTP_GET, useValue: get },
        { provide: NativeInfoService, useValue: native },
        { provide: INSTALLED_VERSION, useValue: opts.installed ?? '1.0.5' },
        ...(opts.plugin ? [{ provide: UPDATER_PLUGIN, useValue: opts.plugin }] : []),
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
  it('native version equal to minNativeVersion -> available', async () => {
    ok(bundle('1.0.6', '1.0.10')); const s = setup({ nativeVersion: '1.0.10' }); await s.check();
    expect(s.state).toBe('available');
  });
  it('minNativeVersion 1.0.0 with native 1.0.5 -> available', async () => {
    ok(bundle('1.0.6', '1.0.0')); const s = setup({ nativeVersion: '1.0.5' }); await s.check();
    expect(s.state).toBe('available');
  });
  it('unknown native version with min above 0 -> native-required', async () => {
    ok(bundle('1.0.6', '1.0.3')); const s = setup(); native.getAppVersion.and.resolveTo(null); await s.check();
    expect(s.state).toBe('native-required');
  });
  it('dev build never offers an update', async () => {
    ok(bundle('1.0.6')); const s = setup({ installed: 'dev' }); await s.check();
    expect(s.state).toBe('none');
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

  describe('apply', () => {
    let plugin: { download: jasmine.Spy; set: jasmine.Spy; notifyAppReady: jasmine.Spy; addListener: jasmine.Spy };
    let remove: jasmine.Spy;
    let onDownload: (e: { percent: number }) => void;

    async function ready(check = true) {
      remove = jasmine.createSpy('remove');
      plugin = {
        download: jasmine.createSpy('download').and.resolveTo({ id: 'b1', version: '1.0.6' }),
        set: jasmine.createSpy('set').and.resolveTo(),
        notifyAppReady: jasmine.createSpy('notifyAppReady').and.resolveTo(),
        addListener: jasmine.createSpy('addListener').and.callFake(async (_n: string, cb: (e: { percent: number }) => void) => {
          onDownload = cb; return { remove };
        }),
      };
      ok({ version: '1.0.6', url: 'https://roku.bluefin605.com/android/bundles/1.0.6.zip', minNativeVersion: '1.0.1' });
      const s = setup({ plugin });
      if (check) await s.check();
      return s;
    }

    it('success: download then set with returned bundle, removes listener', async () => {
      const s = await ready();
      await s.apply();
      expect(plugin.download).toHaveBeenCalledWith({ url: 'https://roku.bluefin605.com/android/bundles/1.0.6.zip', version: '1.0.6' });
      expect(plugin.set).toHaveBeenCalledWith({ id: 'b1', version: '1.0.6' });
      expect(plugin.download).toHaveBeenCalledBefore(plugin.set);
      expect(remove).toHaveBeenCalled();
      expect(s.error$.value).toBeNull();
    });
    it('rejects a url outside the bundles path without downloading', async () => {
      const s = await ready(false);
      ok({ version: '1.0.6', url: 'https://evil.example.com/1.0.6.zip', minNativeVersion: '1.0.1' });
      await s.check();
      await s.apply();
      expect(plugin.download).not.toHaveBeenCalled();
      expect(s.error$.value).toBe('Update failed, try again');
      expect(s.progress$.value).toBeNull();
    });
    it('check() during a download does not change state', async () => {
      const s = await ready();
      let finish!: (b: unknown) => void;
      plugin.download.and.returnValue(new Promise(r => { finish = r; }));
      const p = s.apply();
      await new Promise(r => setTimeout(r));
      get.and.rejectWith(new Error('net'));
      await s.check();
      expect(s.state).toBe('available');
      expect(s.latest).not.toBeNull();
      finish({ id: 'b1' });
      await p;
    });
    it('does nothing unless state is available', async () => {
      const s = await ready(false);
      await s.apply();
      expect(plugin.download).not.toHaveBeenCalled();
    });
    it('failure: sets error, no set, progress null, listener removed', async () => {
      const s = await ready();
      plugin.download.and.rejectWith(new Error('boom'));
      await s.apply();
      expect(s.error$.value).toBe('Update failed, try again');
      expect(plugin.set).not.toHaveBeenCalled();
      expect(s.progress$.value).toBeNull();
      expect(remove).toHaveBeenCalled();
    });
    it('set failure also reports error', async () => {
      const s = await ready();
      plugin.set.and.rejectWith(new Error('x'));
      await s.apply();
      expect(s.error$.value).toBe('Update failed, try again');
    });
    it('second call during a download is ignored', async () => {
      const s = await ready();
      let finish!: (b: unknown) => void;
      plugin.download.and.returnValue(new Promise(r => { finish = r; }));
      const first = s.apply();
      await new Promise(r => setTimeout(r));
      await s.apply();
      expect(plugin.download).toHaveBeenCalledTimes(1);
      finish({ id: 'b1' });
      await first;
    });
    it('progress events propagate and start at 0', async () => {
      const s = await ready();
      let finish!: (b: unknown) => void;
      plugin.download.and.returnValue(new Promise(r => { finish = r; }));
      const p = s.apply();
      await new Promise(r => setTimeout(r));
      expect(s.progress$.value).toBe(0);
      onDownload({ percent: 42 });
      expect(s.progress$.value).toBe(42);
      finish({ id: 'b1' });
      await p;
    });
    it('clears previous error on retry', async () => {
      const s = await ready();
      plugin.download.and.rejectWith(new Error('boom'));
      await s.apply();
      plugin.download.and.resolveTo({ id: 'b1' });
      await s.apply();
      expect(s.error$.value).toBeNull();
    });
  });
});
