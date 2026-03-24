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
  private static readonly DEFAULT_URL = 'http://roku-proxy.local:8080';
  private proxyUrl: string;

  constructor(private http: HttpClient) {
    this.proxyUrl = localStorage.getItem(ProxyService.STORAGE_KEY) || ProxyService.DEFAULT_URL;
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
    this.setProxyUrl(ProxyService.DEFAULT_URL);
  }

  isAvailable(): Observable<boolean> {
    return this.http.get<ProxyStatus>(`${this.proxyUrl}/status`).pipe(
      timeout(2000),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  discover(): Observable<ProxyDevice[]> {
    return this.http.get<ProxyDevice[]>(`${this.proxyUrl}/discover`).pipe(
      timeout(5000),
    );
  }

  startListening(rokuIp: string): Observable<void> {
    return this.http.post<void>(`${this.proxyUrl}/start?roku=${rokuIp}`, null).pipe(
      timeout(5000),
    );
  }

  stopListening(): Observable<void> {
    return this.http.post<void>(`${this.proxyUrl}/stop`, null).pipe(
      timeout(3000),
    );
  }

  getStatus(): Observable<ProxyStatus> {
    return this.http.get<ProxyStatus>(`${this.proxyUrl}/status`).pipe(
      timeout(3000),
    );
  }

  getAudioStreamUrl(): string {
    return `${this.proxyUrl}/audio`;
  }
}
