import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, timeout, catchError, of } from 'rxjs';

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
  private static readonly DEFAULT_URL = 'http://roku-proxy.local';
  private proxyUrl: string;

  constructor(private http: HttpClient) {
    this.proxyUrl = localStorage.getItem(ProxyService.STORAGE_KEY) ?? ProxyService.detectDefaultUrl();
  }

  /** If served from the ESP32 (same-origin API available), use relative paths. Otherwise use mDNS default. */
  private static detectDefaultUrl(): string {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      // Same-origin when served from ESP32: mDNS name or local IP on port 80
      if (host === 'roku-proxy.local' || (host.match(/^192\.168\./) && window.location.port === '')) {
        return '';
      }
    }
    return ProxyService.DEFAULT_URL;
  }

  private apiBase(): string {
    return this.proxyUrl ? `${this.proxyUrl}/api` : '/api';
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
    return this.http.get<ProxyStatus>(`${this.apiBase()}/status`).pipe(
      timeout(2000),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  discover(): Observable<ProxyDevice[]> {
    return this.http.get<ProxyDevice[]>(`${this.apiBase()}/discover`).pipe(
      timeout(5000),
    );
  }

  startListening(rokuIp: string): Observable<void> {
    return this.http.post<void>(`${this.apiBase()}/start?roku=${rokuIp}`, null).pipe(
      timeout(5000),
    );
  }

  stopListening(): Observable<void> {
    return this.http.post<void>(`${this.apiBase()}/stop`, null).pipe(
      timeout(3000),
    );
  }

  getStatus(): Observable<ProxyStatus> {
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
    return host === 'roku-proxy.local' || !!host.match(/^192\.168\./);
  }
}
