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
    let order: string[];

    beforeEach(() => {
      spyOn(Capacitor, 'getPlatform').and.returnValue('android');
      order = [];
      remove = jasmine.createSpy('remove').and.resolveTo();
      requestPermissions = plugin.requestPermissions.and.callFake((async () => { order.push('perm'); return { display: 'granted' }; }) as any);
      plugin.addListener.and.callFake((async (_e: string, fn: () => void) => {
        clickHandler = fn;
        return { remove };
      }) as any);
      startFg = plugin.startForegroundService.and.callFake((async () => { order.push('start'); }) as any);
      stopFg = plugin.stopForegroundService.and.callFake((async () => { order.push('stop'); }) as any);
    });

    it('requests permission, starts the service and routes the Stop button to the callback', async () => {
      const cb = jasmine.createSpy('onStop');
      await service.start(cb);
      expect(service.available).toBeTrue();
      expect(requestPermissions).toHaveBeenCalled();
      expect(order.indexOf('perm')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('perm')).toBeLessThan(order.indexOf('start'));
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

    it('stop() during a pending start leaves no running service or listener', async () => {
      let release!: (v: any) => void;
      requestPermissions.and.returnValue(new Promise(r => { release = r; }));
      const started = service.start(() => {});
      const stopped = service.stop();
      release({ display: 'granted' });
      await Promise.all([started, stopped]);
      expect(remove).toHaveBeenCalledTimes(plugin.addListener.calls.count());
      if (startFg.calls.count()) {
        expect(stopFg).toHaveBeenCalled();
        expect(order.lastIndexOf('stop')).toBeGreaterThan(order.lastIndexOf('start'));
      }
    });

    it('a second start() without stop() does not leak the first listener', async () => {
      await service.start(() => {});
      await service.start(() => {});
      expect(plugin.addListener.calls.count() - remove.calls.count()).toBeLessThanOrEqual(1);
      await service.stop();
      expect(remove).toHaveBeenCalledTimes(plugin.addListener.calls.count());
    });

    it('stop() still stops the service when listener.remove() throws', async () => {
      remove.and.rejectWith(new Error('boom'));
      await service.start(() => {});
      await service.stop();
      expect(stopFg).toHaveBeenCalled();
    });
  });
});
