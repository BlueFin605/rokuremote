import { Injectable, InjectionToken, inject } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';
import { BehaviorSubject } from 'rxjs';
import { APP_VERSION } from '../version';
import { NativeInfoService } from './native-info.service';

export interface LatestBundle { version: string; url: string; minNativeVersion: string; }
export type UpdateState = 'none' | 'available' | 'native-required';
export const LATEST_URL = 'https://roku.bluefin605.com/android/bundles/latest.json';

export function versionNumber(v: string): number {
  const n = parseInt(v.split('.').pop() ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

/** Seam over CapacitorHttp.get (plugin proxy cannot be spied on in tests). */
export const HTTP_GET = new InjectionToken<(opts: { url: string }) => Promise<{ status: number; data: unknown }>>('HTTP_GET', {
  providedIn: 'root',
  factory: () => (opts) => CapacitorHttp.get(opts),
});

/** Installed bundle version (overridable in tests). */
export const INSTALLED_VERSION = new InjectionToken<string>('INSTALLED_VERSION', {
  providedIn: 'root',
  factory: () => APP_VERSION,
});

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly http = inject(HTTP_GET);
  private readonly native = inject(NativeInfoService);
  private readonly installed = inject(INSTALLED_VERSION);

  latest: LatestBundle | null = null;
  state: UpdateState = 'none';
  readonly changes$ = new BehaviorSubject<UpdateState>('none');

  async check(): Promise<void> {
    if (!this.native.isNative) return;
    try {
      const res = await this.http({ url: LATEST_URL + '?t=' + Date.now() });
      const d = res.data as Partial<LatestBundle> | null;
      if (res.status !== 200 || !d || typeof d !== 'object'
        || typeof d.version !== 'string' || typeof d.url !== 'string' || typeof d.minNativeVersion !== 'string') {
        return this.set(null, 'none');
      }
      const latest = d as LatestBundle;
      if (versionNumber(latest.version) <= versionNumber(this.installed)) return this.set(null, 'none');
      const nativeVer = versionNumber((await this.native.getAppVersion()) ?? '');
      this.set(latest, nativeVer < versionNumber(latest.minNativeVersion) ? 'native-required' : 'available');
    } catch {
      this.set(null, 'none');
    }
  }

  private set(latest: LatestBundle | null, state: UpdateState): void {
    this.latest = latest;
    this.state = state;
    this.changes$.next(state);
  }
}
