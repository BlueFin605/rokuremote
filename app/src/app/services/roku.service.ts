import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, timeout, catchError, throwError, Subject, concatMap, delay, of } from 'rxjs';
import { ProxyService } from './proxy.service';

export interface RokuDeviceInfo {
  name: string;
  model: string;
  supportsPrivateListening: boolean;
  ecpEnabled: boolean;
}

export interface RokuApp {
  id: string;
  name: string;
  version: string;
  iconUrl: string;
}

export type RokuKey =
  | 'Home' | 'Back' | 'Select'
  | 'Up' | 'Down' | 'Left' | 'Right'
  | 'Play' | 'Rev' | 'Fwd' | 'InstantReplay'
  | 'VolumeUp' | 'VolumeDown' | 'VolumeMute'
  | 'PowerOff' | 'PowerOn' | 'Info';

@Injectable({
  providedIn: 'root'
})
export class RokuService {
  private static readonly STORAGE_KEY = 'roku-ip';
  private static readonly TIMEOUT_MS = 3000;
  private static readonly THROTTLE_MS = 60;

  private rokuIp: string | null = null;
  private commandQueue = new Subject<{ key: string; action: 'keypress' | 'keydown' | 'keyup' }>();
  private connectionError = new Subject<void>();

  private rokuUrl(path: string, ip?: string): string {
    const proxyUrl = this.proxy.getProxyUrl();
    return `${proxyUrl}/roku/${path}?ip=${ip ?? this.rokuIp}`;
  }

  connectionLost$ = this.connectionError.asObservable();

  constructor(private http: HttpClient, private proxy: ProxyService) {
    this.rokuIp = localStorage.getItem(RokuService.STORAGE_KEY);
    this.initCommandQueue();
  }

  getSavedIp(): string | null {
    return this.rokuIp;
  }

  connect(ip: string): Observable<RokuDeviceInfo> {
    return this.http.get(this.rokuUrl('query/device-info', ip), {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
      map(xml => this.parseDeviceInfo(xml)),
      map(info => {
        this.rokuIp = ip;
        localStorage.setItem(RokuService.STORAGE_KEY, ip);
        return info;
      }),
      catchError(err => this.handleError(err))
    );
  }

  disconnect(): void {
    this.rokuIp = null;
    localStorage.removeItem(RokuService.STORAGE_KEY);
  }

  isConnected(): boolean {
    return this.rokuIp !== null;
  }

  keypress(key: RokuKey | string): void {
    this.commandQueue.next({ key, action: 'keypress' });
  }

  keydown(key: RokuKey | string): void {
    this.commandQueue.next({ key, action: 'keydown' });
  }

  keyup(key: RokuKey | string): void {
    this.commandQueue.next({ key, action: 'keyup' });
  }

  sendText(text: string): void {
    for (const char of text) {
      const encoded = encodeURIComponent(char);
      this.commandQueue.next({ key: `Lit_${encoded}`, action: 'keypress' });
    }
  }

  getApps(): Observable<RokuApp[]> {
    return this.http.get(this.rokuUrl('query/apps'), {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
      map(xml => this.parseApps(xml)),
      catchError(err => this.handleError(err)),
    );
  }

  getActiveApp(): Observable<string | null> {
    return this.http.get(this.rokuUrl('query/active-app'), {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
      map(xml => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'text/xml');
        const app = doc.getElementsByTagName('app')[0];
        return app?.getAttribute('id') ?? null;
      }),
      catchError(() => of(null)),
    );
  }

  getAppIconUrl(appId: string): string {
    return this.rokuUrl(`query/icon/${appId}`);
  }

  launchApp(appId: string): Observable<string> {
    return this.http.post(this.rokuUrl(`launch/${appId}`), null, {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
      catchError(err => this.handleError(err)),
    );
  }

  private parseApps(xml: string): RokuApp[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const appElements = doc.getElementsByTagName('app');
    const apps: RokuApp[] = [];

    for (let i = 0; i < appElements.length; i++) {
      const el = appElements[i];
      const id = el.getAttribute('id');
      const name = el.textContent?.trim();
      if (id && name) {
        apps.push({
          id,
          name,
          version: el.getAttribute('version') ?? '',
          iconUrl: this.getAppIconUrl(id),
        });
      }
    }

    return apps.sort((a, b) => a.name.localeCompare(b.name));
  }

  private initCommandQueue(): void {
    this.commandQueue.pipe(
      concatMap(cmd =>
        this.sendCommand(cmd.action, cmd.key).pipe(
          delay(RokuService.THROTTLE_MS),
          catchError(() => {
            this.connectionError.next();
            return of(null);
          }),
        )
      ),
    ).subscribe();
  }

  private sendCommand(action: string, key: string): Observable<string> {
    return this.http.post(this.rokuUrl(`${action}/${key}`), null, {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
    );
  }

  private parseDeviceInfo(xml: string): RokuDeviceInfo {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    const getText = (tag: string): string =>
      doc.getElementsByTagName(tag)[0]?.textContent ?? '';

    return {
      name: getText('friendly-device-name') || getText('default-device-name') || 'Roku',
      model: getText('model-name') || 'Unknown',
      supportsPrivateListening: getText('supports-private-listening') === 'true',
      ecpEnabled: getText('ecp-setting-mode') !== 'limited',
    };
  }

  private handleError(err: any): Observable<never> {
    if (err.name === 'TimeoutError') {
      return throwError(() => ({
        type: 'timeout' as const,
        message: 'Roku not found at this IP address. Check the IP and make sure your phone is on the same Wi-Fi.',
      }));
    }

    const body = err.error as string ?? '';
    if (body.includes('Limited mode') || body.includes('not allowed')) {
      return throwError(() => ({
        type: 'limited-mode' as const,
        message: 'Your Roku has External Control set to Limited.',
      }));
    }

    return throwError(() => ({
      type: 'unknown' as const,
      message: 'Could not connect to Roku. Check the IP address and try again.',
    }));
  }
}
