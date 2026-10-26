import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RokuService } from './roku.service';
import { TvService } from './tv.service';

describe('TvService', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('roku-ip', '10.0.0.1'); // migrates to one Roku
    TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
  });
  it('is unconfigured until the active Roku has a TV', () => {
    const tv = TestBed.inject(TvService);
    expect(tv.configured).toBeFalse();
    expect(tv.type).toBe('none');
  });
  it('configure stores the TV on the active Roku and follows the active Roku', () => {
    const roku = TestBed.inject(RokuService);
    const tv = TestBed.inject(TvService);
    tv.configure('panasonic', '10.0.0.90');
    expect(tv.configured).toBeTrue();
    expect(roku.activeRoku!.tv).toEqual({ type: 'panasonic', ip: '10.0.0.90' });
    roku.connect('10.0.0.2').subscribe(); // second Roku starts with no TV
    TestBed.inject(HttpTestingController).expectOne(r => r.url.includes('ip=10.0.0.2')).flush('<device-info></device-info>');
    expect(tv.configured).toBeFalse();
    roku.selectRoku(roku.rokus[0].id);
    expect(tv.ip).toBe('10.0.0.90');
  });
  it('test is stateless: hits the given type/ip, not the active Roku TV', () => {
    const tv = TestBed.inject(TvService);
    const http = TestBed.inject(HttpTestingController);
    let result: unknown;
    tv.test('panasonic', '10.0.0.77').subscribe(r => (result = r));
    const req = http.expectOne(r => r.url.includes('/tv/volume'));
    expect(req.request.url).toContain('ip=10.0.0.77');
    expect(req.request.url).toContain('type=panasonic');
    req.flush({ volume: 5 });
    expect(result).toEqual({ ok: true });
  });
  it('test reports pairingRequired and plain failure', () => {
    const tv = TestBed.inject(TvService);
    const http = TestBed.inject(HttpTestingController);
    const results: unknown[] = [];
    tv.test('panasonic', '10.0.0.77').subscribe(r => results.push(r));
    http.expectOne(r => r.url.includes('/tv/volume')).flush('auth required', { status: 403, statusText: 'Forbidden' });
    tv.test('panasonic', '10.0.0.77').subscribe(r => results.push(r));
    http.expectOne(r => r.url.includes('/tv/volume')).flush('boom', { status: 500, statusText: 'x' });
    expect(results).toEqual([{ ok: false, pairingRequired: true }, { ok: false }]);
  });
  it('testConnection delegates to test with the current type/ip', () => {
    const tv = TestBed.inject(TvService);
    const http = TestBed.inject(HttpTestingController);
    tv.configure('panasonic', '10.0.0.90');
    tv.testConnection().subscribe();
    const req = http.expectOne(r => r.url.includes('/tv/volume'));
    expect(req.request.url).toContain('ip=10.0.0.90');
    req.flush({ volume: 1 });
  });
  it('configure none clears the active Roku TV', () => {
    const tv = TestBed.inject(TvService);
    tv.configure('panasonic', '10.0.0.90');
    tv.configure('none', null);
    expect(tv.configured).toBeFalse();
  });
});
