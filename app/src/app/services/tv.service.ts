import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, concatMap, delay, of, catchError, timeout, map } from 'rxjs';
import { ProxyService } from './proxy.service';
import { DemoModeService } from './demo-mode.service';

export type TvType = 'panasonic' | 'none';

export type TvAction =
  | 'volume_up' | 'volume_down' | 'mute'
  | 'power'
  | 'hdmi1' | 'hdmi2' | 'hdmi3' | 'hdmi4';

export interface DiscoveredTv {
  ip: string;
  name: string;
}

@Injectable({
  providedIn: 'root'
})
export class TvService {
  private static readonly TYPE_KEY = 'tv-type';
  private static readonly IP_KEY = 'tv-ip';
  private static readonly TIMEOUT_MS = 3000;
  private static readonly THROTTLE_MS = 60;
  private static readonly MOCK_DELAY_MS = 200;

  private tvType: TvType;
  private tvIp: string | null;
  private commandQueue = new Subject<TvAction>();
  private connectionError = new Subject<void>();

  connectionError$ = this.connectionError.asObservable();

  constructor(private http: HttpClient, private proxy: ProxyService, private demoMode: DemoModeService) {
    this.tvType = (localStorage.getItem(TvService.TYPE_KEY) as TvType) || 'none';
    this.tvIp = localStorage.getItem(TvService.IP_KEY);
    this.initCommandQueue();
  }

  get configured(): boolean {
    return this.tvType !== 'none' && !!this.tvIp;
  }

  get type(): TvType {
    return this.tvType;
  }

  get ip(): string | null {
    return this.tvIp;
  }

  configure(type: TvType, ip: string | null): void {
    this.tvType = type;
    this.tvIp = ip;
    if (type === 'none' || !ip) {
      localStorage.removeItem(TvService.TYPE_KEY);
      localStorage.removeItem(TvService.IP_KEY);
      this.tvType = 'none';
      this.tvIp = null;
    } else {
      localStorage.setItem(TvService.TYPE_KEY, type);
      localStorage.setItem(TvService.IP_KEY, ip);
    }
  }

  command(action: TvAction): void {
    this.commandQueue.next(action);
  }

  getVolume(): Observable<number> {
    if (this.demoMode.enabled) {
      return of(24).pipe(delay(TvService.MOCK_DELAY_MS));
    }
    return this.http.get<{ volume: number }>(this.tvUrl('volume')).pipe(
      timeout(TvService.TIMEOUT_MS),
      map(res => res.volume),
      catchError(() => {
        this.connectionError.next();
        return of(-1);
      }),
    );
  }

  testConnection(): Observable<{ ok: boolean; pairingRequired?: boolean }> {
    if (this.demoMode.enabled) {
      return of({ ok: true }).pipe(delay(TvService.MOCK_DELAY_MS));
    }
    return this.http.get<{ volume: number }>(this.tvUrl('volume')).pipe(
      timeout(TvService.TIMEOUT_MS),
      map(() => ({ ok: true })),
      catchError(err => {
        const body = err.error as string ?? '';
        if (body.includes('auth') || body.includes('encrypt') || body.includes('403')) {
          return of({ ok: false, pairingRequired: true });
        }
        return of({ ok: false });
      }),
    );
  }

  discover(type?: TvType): Observable<DiscoveredTv[]> {
    if (this.demoMode.enabled) {
      const tvType = type ?? this.tvType;
      if (tvType === 'none') {
        return of([]).pipe(delay(TvService.MOCK_DELAY_MS));
      }
      return of([
        { ip: '192.168.1.90', name: 'Panasonic Viera (Demo)' },
      ]).pipe(delay(TvService.MOCK_DELAY_MS));
    }

    const base = this.proxy.getProxyUrl()
      ? `${this.proxy.getProxyUrl()}/api`
      : '/api';
    const tvType = type ?? this.tvType;
    return this.http.get<DiscoveredTv[]>(
      `${base}/tv/discover?type=${tvType}`
    ).pipe(
      timeout(5000),
    );
  }

  private tvUrl(path: string): string {
    const base = this.proxy.getProxyUrl()
      ? `${this.proxy.getProxyUrl()}/api`
      : '/api';
    return `${base}/tv/${path}?ip=${this.tvIp}&type=${this.tvType}`;
  }

  private initCommandQueue(): void {
    this.commandQueue.pipe(
      concatMap(action =>
        this.sendCommand(action).pipe(
          delay(TvService.THROTTLE_MS),
          catchError(() => {
            this.connectionError.next();
            return of(null);
          }),
        )
      ),
    ).subscribe();
  }

  private sendCommand(action: TvAction): Observable<string> {
    if (this.demoMode.enabled) {
      return of(`mocked:${action}`).pipe(delay(TvService.THROTTLE_MS));
    }

    return this.http.post(this.tvUrl(`keypress/${action}`), null, {
      responseType: 'text',
    }).pipe(
      timeout(TvService.TIMEOUT_MS),
    );
  }
}
