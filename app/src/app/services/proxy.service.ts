import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, timeout, catchError, of, delay } from 'rxjs';
import { DemoModeService } from './demo-mode.service';

export interface ProxyDevice {
  ip: string;
  name: string;
  model: string;
}

export interface ProxyStatus {
  state: 'idle' | 'connecting' | 'authenticating' | 'streaming' | 'error';
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProxyService {
  private static readonly STORAGE_KEY = 'proxy-url';
  private static readonly DEFAULT_URL = 'http://roku-proxy';
  private static readonly LEGACY_DEFAULT_URL = 'http://roku-proxy.local';
  private static readonly MOCK_DELAY_MS = 220;
  private proxyUrl: string;
  private mockStatus: ProxyStatus = { state: 'idle' };

  constructor(private http: HttpClient, private demoMode: DemoModeService) {
    const savedUrl = localStorage.getItem(ProxyService.STORAGE_KEY);
    this.proxyUrl = savedUrl ?? ProxyService.detectDefaultUrl();

    // Seamlessly migrate older default to the new router DNS hostname.
    if (this.proxyUrl === ProxyService.LEGACY_DEFAULT_URL) {
      this.proxyUrl = ProxyService.DEFAULT_URL;
      localStorage.setItem(ProxyService.STORAGE_KEY, this.proxyUrl);
    }
  }

  /** If served from the ESP32 (same-origin API available), use relative paths. Otherwise use hostname default. */
  private static detectDefaultUrl(): string {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      // Same-origin when served from ESP32: mDNS name or local IP on port 80
      if ((host === 'roku-proxy' || host === 'roku-proxy.local' || host.match(/^192\.168\./)) && window.location.port === '') {
        return '';
      }
    }
    return ProxyService.DEFAULT_URL;
  }

  private apiBase(): string {
    if (!this.proxyUrl) {
      return '/api';
    }

    if (this.shouldUseApiPrefix(this.proxyUrl)) {
      return `${this.proxyUrl}/api`;
    }

    return this.proxyUrl;
  }

  private shouldUseApiPrefix(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      // Desktop Aspire/C++ proxy exposes routes at root (/roku, /status, ...).
      if (host === 'localhost' || host === '127.0.0.1') {
        return false;
      }
    } catch {
      // If URL parsing fails, fall back to the long-standing /api behavior.
    }

    return true;
  }

  getApiBase(): string {
    return this.apiBase();
  }

  getProxyUrl(): string {
    return this.proxyUrl;
  }

  getDefaultUrl(): string {
    return ProxyService.DEFAULT_URL;
  }

  setProxyUrl(url: string): void {
    this.proxyUrl = url;
    localStorage.setItem(ProxyService.STORAGE_KEY, url);
  }

  resetToDefault(): void {
    this.setProxyUrl(ProxyService.detectDefaultUrl());
  }

  isAvailable(): Observable<boolean> {
    if (this.demoMode.enabled) {
      return of(true).pipe(delay(ProxyService.MOCK_DELAY_MS));
    }
    return this.http.get<ProxyStatus>(`${this.apiBase()}/status`).pipe(
      timeout(2000),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  discover(): Observable<ProxyDevice[]> {
    if (this.demoMode.enabled) {
      return of([
        { ip: '192.168.1.24', name: 'Living Room Roku (Demo)', model: 'Roku Ultra' },
        { ip: '192.168.1.51', name: 'Bedroom Roku (Demo)', model: 'Roku Streaming Stick' },
      ]).pipe(delay(ProxyService.MOCK_DELAY_MS));
    }
    return this.http.get<ProxyDevice[]>(`${this.apiBase()}/discover`).pipe(
      timeout(5000),
    );
  }

  startListening(rokuIp: string): Observable<void> {
    if (this.demoMode.enabled) {
      this.mockStatus = { state: 'streaming' };
      return of(void 0).pipe(delay(ProxyService.MOCK_DELAY_MS));
    }
    return this.http.post<void>(`${this.apiBase()}/start?roku=${rokuIp}`, null).pipe(
      timeout(5000),
    );
  }

  stopListening(): Observable<void> {
    if (this.demoMode.enabled) {
      this.mockStatus = { state: 'idle' };
      return of(void 0).pipe(delay(ProxyService.MOCK_DELAY_MS));
    }
    return this.http.post<void>(`${this.apiBase()}/stop`, null).pipe(
      timeout(3000),
    );
  }

  getStatus(): Observable<ProxyStatus> {
    if (this.demoMode.enabled) {
      return of(this.mockStatus).pipe(delay(ProxyService.MOCK_DELAY_MS));
    }
    return this.http.get<ProxyStatus>(`${this.apiBase()}/status`).pipe(
      timeout(3000),
    );
  }

  getAudioStreamUrl(): string {
    // On ESP32, audio is served on a dedicated HTTP server (main port + 1)
    // to avoid blocking the main server thread during long-lived streams.
    // On the desktop proxy, audio is on the same port (cpp-httplib is multi-threaded).
    if (this.isEsp32Origin()) {
      return `${window.location.protocol}//${window.location.hostname}:81/api/audio`;
    }
    return `${this.apiBase()}/audio`;
  }

  private isEsp32Origin(): boolean {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname;
    return host === 'roku-proxy' || host === 'roku-proxy.local' || !!host.match(/^192\.168\./);
  }
}
