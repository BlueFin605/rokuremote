import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AudioPlayerService } from './audio-player.service';
import { NativeBackgroundService } from './native-background.service';

// Captured before any jasmine.clock().install() so tests can still wait on real async work.
const realSetTimeout = window.setTimeout.bind(window);

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
    const settle = () => new Promise(r => realSetTimeout(r, 30));

    it('stops (native.stop, isPlaying false) when the stream ends normally', async () => {
      (window.fetch as jasmine.Spy).and.resolveTo(streamDone());
      await service.start('http://example.invalid/audio');
      native.stop.calls.reset();
      await flush();
      expect(native.stop).toHaveBeenCalledTimes(1);
      expect(service.isPlaying).toBeFalse();
    });

    it('stops after the retries are exhausted', async () => {
      jasmine.clock().install();
      try {
        (window.fetch as jasmine.Spy).and.rejectWith(new Error('net'));
        spyOn(console, 'warn'); spyOn(console, 'error');
        await service.start('http://example.invalid/audio');
        native.stop.calls.reset();
        for (let i = 0; i < 3; i++) {
          await settle();
          jasmine.clock().tick(1000);
        }
        await settle();
        expect(native.stop).toHaveBeenCalledTimes(1);
        expect(service.isPlaying).toBeFalse();
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('a stale session loop waking from its retry delay does not touch the new session', async () => {
      jasmine.clock().install();
      try {
        const fetchSpy = window.fetch as jasmine.Spy;
        fetchSpy.and.callFake((url: string) =>
          url === 'http://example.invalid/one' ? Promise.reject(new Error('net')) : new Promise<Response>(() => {}));
        spyOn(console, 'warn'); spyOn(console, 'error');
        await service.start('http://example.invalid/one');
        await settle(); // session 1 failed once and is sleeping in its retry delay
        await service.start('http://example.invalid/two'); // session 2
        await settle();
        native.stop.calls.reset();
        const callsBefore = fetchSpy.calls.count();
        for (let i = 0; i < 4; i++) {
          jasmine.clock().tick(1000);
          await settle();
        }
        expect(fetchSpy.calls.count()).toBe(callsBefore);
        expect(native.stop).not.toHaveBeenCalled();
        expect(service.isPlaying).toBeTrue();
        await service.stop();
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('does not trigger another stop on abort', async () => {
      (window.fetch as jasmine.Spy).and.rejectWith(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      await service.start('http://example.invalid/audio');
      native.stop.calls.reset();
      await flush();
      expect(native.stop).not.toHaveBeenCalled();
    });
  });
});
