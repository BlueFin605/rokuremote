import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { NativeBackgroundService } from './native-background.service';

describe('NativeBackgroundService', () => {
  let service: NativeBackgroundService;
  let plugin: jasmine.SpyObj<any>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NativeBackgroundService);
    plugin = jasmine.createSpyObj('ForegroundService', ['requestPermissions', 'addListener', 'startForegroundService', 'stopForegroundService']);
    (service as any).plugin = plugin;
  });

  it('is unavailable on web and never calls the plugin', async () => {
        expect(service.available).toBeFalse();
    await service.start(() => {});
    await service.stop();
    expect(plugin.startForegroundService).not.toHaveBeenCalled();
    expect(plugin.stopForegroundService).not.toHaveBeenCalled();
  });

  describe('on android', () => {
    let remove: jasmine.Spy;
    let requestPermissions: jasmine.Spy;
    let startFg: jasmine.Spy;
    let stopFg: jasmine.Spy;
    let clickHandler: (() => void) | undefined;

    beforeEach(() => {
      spyOn(Capacitor, 'getPlatform').and.returnValue('android');
      remove = jasmine.createSpy('remove').and.resolveTo();
      requestPermissions = plugin.requestPermissions.and.resolveTo({ display: 'granted' } as any);
      plugin.addListener.and.callFake((async (_e: string, fn: () => void) => {
        clickHandler = fn;
        return { remove };
      }) as any);
      startFg = plugin.startForegroundService.and.resolveTo();
      stopFg = plugin.stopForegroundService.and.resolveTo();
    });

    it('requests permission, starts the service and routes the Stop button to the callback', async () => {
      const cb = jasmine.createSpy('onStop');
      await service.start(cb);
      expect(service.available).toBeTrue();
      expect(requestPermissions).toHaveBeenCalled();
      expect(startFg).toHaveBeenCalledWith({
        id: 1,
        title: 'Private Listening',
        body: 'Streaming from your Roku',
        smallIcon: 'ic_stat_listening',
        buttons: [{ id: 1, title: 'Stop' }],
      });
      expect(cb).not.toHaveBeenCalled();
      clickHandler!();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('stop() stops the service and removes the listener', async () => {
      await service.start(() => {});
      await service.stop();
      expect(stopFg).toHaveBeenCalled();
      expect(remove).toHaveBeenCalled();
    });
  });
});
