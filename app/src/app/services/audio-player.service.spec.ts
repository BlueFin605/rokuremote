import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AudioPlayerService } from './audio-player.service';
import { NativeBackgroundService } from './native-background.service';

describe('AudioPlayerService', () => {
  let service: AudioPlayerService;
  let native: jasmine.SpyObj<NativeBackgroundService>;

  beforeEach(() => {
    localStorage.clear();
    native = jasmine.createSpyObj<NativeBackgroundService>('NativeBackgroundService', ['start', 'stop']);
    native.start.and.resolveTo();
    native.stop.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NativeBackgroundService, useValue: native },
      ],
    });
    service = TestBed.inject(AudioPlayerService);
    // Never-resolving stream so start() does not touch the network.
    spyOn(window, 'fetch').and.returnValue(new Promise<Response>(() => {}));
  });

  it('stop() resolves even if the native stop rejects', async () => {
    native.stop.and.rejectWith(new Error('boom'));
    await expectAsync(service.stop()).toBeResolved();
  });

  it('start() after stop() does not call native.start until native.stop has resolved', async () => {
    let release!: () => void;
    native.stop.and.returnValue(new Promise<void>(res => { release = res; }));

    const stopping = service.stop();
    const starting = service.start('http://example.invalid/audio');
    await new Promise(r => setTimeout(r, 50));
    expect(native.stop).toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();

    release();
    await stopping;
    await starting;
    expect(native.start).toHaveBeenCalledTimes(1);

    native.stop.and.resolveTo();
    await service.stop();
  });

  describe('stream exit', () => {
    const streamDone = () => ({
      body: { getReader: () => ({ read: () => Promise.resolve({ done: true, value: undefined }) }) },
    }) as unknown as Response;
    const flush = () => new Promise(r => setTimeout(r, 30));

    it('stops (native.stop, isPlaying false) when the stream ends normally', async () => {
      (window.fetch as jasmine.Spy).and.resolveTo(streamDone());
      await service.start('http://example.invalid/audio');
      native.stop.calls.reset();
      await flush();
      expect(native.stop).toHaveBeenCalledTimes(1);
      expect(service.isPlaying).toBeFalse();
    });

    it('stops after the retries are exhausted', async () => {
      (window.fetch as jasmine.Spy).and.rejectWith(new Error('net'));
      spyOn(console, 'warn'); spyOn(console, 'error');
      await service.start('http://example.invalid/audio');
      native.stop.calls.reset();
      await new Promise(r => setTimeout(r, 3300));
      expect(native.stop).toHaveBeenCalledTimes(1);
      expect(service.isPlaying).toBeFalse();
    }, 10000);

    it('does not trigger another stop on abort', async () => {
      (window.fetch as jasmine.Spy).and.rejectWith(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      await service.start('http://example.invalid/audio');
      native.stop.calls.reset();
      await flush();
      expect(native.stop).not.toHaveBeenCalled();
    });
  });
});
