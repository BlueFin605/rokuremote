import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, timeout, catchError, throwError, Subject, concatMap, delay, of } from 'rxjs';
import { ProxyService } from './proxy.service';
import { DemoModeService } from './demo-mode.service';

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
  private static readonly SHORT_DELAY_MS = 180;
  private static readonly LONG_DELAY_MS = 700;
  private static readonly MOCK_DELAY_MS = 180;

  private static readonly ECP_KEY = 'roku-ecp-enabled';
  private static readonly DEVICE_INFO_KEY = 'roku-device-info';

  private rokuIp: string | null = null;
  private commandQueue = new Subject<{ key: string; action: 'keypress' | 'keydown' | 'keyup' }>();
  private connectionError = new Subject<void>();
  private _ecpEnabled = true;
  private activeAppId: string | null = null;

  private rokuUrl(path: string, ip?: string): string {
    const proxyUrl = this.proxy.getProxyUrl();
    const base = proxyUrl ? `${proxyUrl}/api` : '/api';
    return `${base}/roku/${path}?ip=${ip ?? this.rokuIp}`;
  }

  connectionLost$ = this.connectionError.asObservable();

  get ecpEnabled(): boolean {
    return this._ecpEnabled;
  }

  constructor(private http: HttpClient, private proxy: ProxyService, private demoMode: DemoModeService) {
    this.rokuIp = localStorage.getItem(RokuService.STORAGE_KEY);
    this._ecpEnabled = localStorage.getItem(RokuService.ECP_KEY) !== 'false';
    this.initCommandQueue();
  }

  getSavedIp(): string | null {
    return this.rokuIp;
  }

  connect(ip: string): Observable<RokuDeviceInfo> {
    if (this.demoMode.enabled) {
      const info: RokuDeviceInfo = {
        name: 'Demo Roku',
        model: 'Roku Ultra',
        supportsPrivateListening: true,
        ecpEnabled: true,
      };
      this.rokuIp = ip;
      this._ecpEnabled = true;
      localStorage.setItem(RokuService.STORAGE_KEY, ip);
      localStorage.setItem(RokuService.ECP_KEY, 'true');
      localStorage.setItem(RokuService.DEVICE_INFO_KEY, JSON.stringify(info));
      return of(info).pipe(delay(RokuService.MOCK_DELAY_MS));
    }

    return this.http.get(this.rokuUrl('query/device-info', ip), {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
      map(xml => this.parseDeviceInfo(xml)),
      map(info => {
        this.rokuIp = ip;
        this._ecpEnabled = info.ecpEnabled;
        localStorage.setItem(RokuService.STORAGE_KEY, ip);
        localStorage.setItem(RokuService.ECP_KEY, String(info.ecpEnabled));
        localStorage.setItem(RokuService.DEVICE_INFO_KEY, JSON.stringify(info));
        return info;
      }),
      catchError(err => this.handleError(err))
    );
  }

  getCachedDeviceInfo(): RokuDeviceInfo | null {
    const stored = localStorage.getItem(RokuService.DEVICE_INFO_KEY);
    if (!stored) return null;
    try {
      return JSON.parse(stored) as RokuDeviceInfo;
    } catch {
      return null;
    }
  }

  disconnect(): void {
    this.rokuIp = null;
    localStorage.removeItem(RokuService.STORAGE_KEY);
    localStorage.removeItem(RokuService.DEVICE_INFO_KEY);
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

  // Best-effort wake sequence for uncertain power state.
  // PowerOn may wake supported Roku models; Home helps bring UI to foreground.
  wake(): void {
    this.keypress('PowerOn');
    this.keypress('Home');
  }

  // Roku restart sequence: Navigate through Settings > System > System restart menu.
  // Step 1: Home (get to dashboard)
  // Step 2: Left (move focus to left menu)
  // Step 3: Up multiple times (scroll to Settings)
  // Step 4: Select (enter Settings)
  // Step 5: Up (navigate to System)
  // Step 6: Select (enter System)
  // Step 7: Up/Down (navigate to System restart)
  // Step 8-9: Select twice (enter and confirm restart)
  reboot(): void {
    const sequence: string[] = [
      'Home',      // Step 1: Guarantee starting point (dashboard)
      'long-delay',
      'Left',      // Step 2: Move focus to left menu
      'short-delay',
      'Up', 'short-delay',
      'Up', 'short-delay',
      'Up',  // Step 3: Scroll to Settings (adjust count if needed for your Roku OS)
      'short-delay',
      'Select',    // Step 4: Enter Settings
      'short-delay',
      'Up',        // Step 5: Navigate to System
      'short-delay',
      'Select',    // Step 6: Enter System
      'short-delay',
      'Down', 'short-delay',
      'Down',  // Step 7: Navigate to System restart (may need adjustment)
      'short-delay',
      'Select',    // Step 8: Enter restart prompt
      'short-delay',
      'Select',    // Step 9: Confirm restart
    ];

    for (const key of sequence) {
      this.keypress(key);
    }
  }

  sendText(text: string): void {
    for (const char of text) {
      const encoded = encodeURIComponent(char);
      this.commandQueue.next({ key: `Lit_${encoded}`, action: 'keypress' });
    }
  }

  getApps(): Observable<RokuApp[]> {
    if (this.demoMode.enabled) {
      const apps: RokuApp[] = [
        { id: '12', name: 'Netflix', version: '1.0.0', iconUrl: '' },
        { id: '13', name: 'YouTube', version: '1.0.0', iconUrl: '' },
        { id: '14', name: 'Disney+', version: '1.0.0', iconUrl: '' },
        { id: '15', name: 'Hulu', version: '1.0.0', iconUrl: '' },
        { id: '16', name: 'Apple TV', version: '1.0.0', iconUrl: '' },
      ];
      return of(apps).pipe(delay(RokuService.MOCK_DELAY_MS));
    }

    return this.http.get(this.rokuUrl('query/apps'), {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
      map(xml => this.parseApps(xml)),
      catchError(err => this.handleError(err)),
    );
  }

  getActiveApp(): Observable<string | null> {
    if (this.demoMode.enabled) {
      return of(this.activeAppId).pipe(delay(RokuService.MOCK_DELAY_MS));
    }

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
    if (this.demoMode.enabled) {
      this.activeAppId = appId;
      return of('OK').pipe(delay(RokuService.MOCK_DELAY_MS));
    }

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
    const delayMs = this.delayForPseudoKey(action, key);
    if (delayMs !== null) {
      return of('OK').pipe(delay(delayMs));
    }

    if (this.demoMode.enabled) {
      return of('OK').pipe(delay(RokuService.THROTTLE_MS));
    }

    return this.http.post(this.rokuUrl(`${action}/${key}`), null, {
      responseType: 'text',
    }).pipe(
      timeout(RokuService.TIMEOUT_MS),
    );
  }

  private delayForPseudoKey(action: string, key: string): number | null {
    if (action !== 'keypress') return null;

    if (key === 'short-delay') return RokuService.SHORT_DELAY_MS;
    if (key === 'long-delay') return RokuService.LONG_DELAY_MS;

    return null;
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
