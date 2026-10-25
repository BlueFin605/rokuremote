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
  it('configure none clears the active Roku TV', () => {
    const tv = TestBed.inject(TvService);
    tv.configure('panasonic', '10.0.0.90');
    tv.configure('none', null);
    expect(tv.configured).toBeFalse();
  });
});
