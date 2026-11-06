import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ProxyService } from './proxy.service';

describe('ProxyService.getAudioStreamUrl', () => {
  function make(proxyUrl: string): ProxyService {
    localStorage.setItem('proxy-url', proxyUrl);
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    return TestBed.inject(ProxyService);
  }
  afterEach(() => localStorage.removeItem('proxy-url'));

  it('uses the ESP32 audio port (81) for the default roku-proxy host from a non-ESP32 origin (native shell)', () => {
    expect(make('http://roku-proxy').getAudioStreamUrl()).toBe('http://roku-proxy:81/api/audio');
  });

  it('keeps the same port for a desktop proxy with an explicit port', () => {
    expect(make('http://192.168.1.5:8080').getAudioStreamUrl()).toBe('http://192.168.1.5:8080/api/audio');
  });
});
