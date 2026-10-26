import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { APP_PLUGIN, NativeInfoService } from './native-info.service';

describe('NativeInfoService', () => {
  const make = (native: boolean, getInfo: jasmine.Spy) => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(native);
    TestBed.configureTestingModule({ providers: [{ provide: APP_PLUGIN, useValue: { getInfo } }] });
    return TestBed.inject(NativeInfoService);
  };

  it('returns the native app version when running natively', async () => {
    const getInfo = jasmine.createSpy('getInfo').and.resolveTo({ version: '1.0.12' });
    const svc = make(true, getInfo);
    expect(svc.isNative).toBeTrue();
    expect(await svc.getAppVersion()).toBe('1.0.12');
  });

  it('returns null without calling App.getInfo in a browser', async () => {
    const getInfo = jasmine.createSpy('getInfo');
    const svc = make(false, getInfo);
    expect(svc.isNative).toBeFalse();
    expect(await svc.getAppVersion()).toBeNull();
    expect(getInfo).not.toHaveBeenCalled();
  });

  it('returns null when App.getInfo throws', async () => {
    expect(await make(true, jasmine.createSpy().and.rejectWith(new Error('nope'))).getAppVersion()).toBeNull();
  });
});
