import { Injectable, InjectionToken, inject } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
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

export interface UpdaterBundle { id: string; version?: string }
export interface UpdaterPlugin {
  download(opts: { url: string; version: string }): Promise<UpdaterBundle>;
  set(bundle: UpdaterBundle): Promise<void>;
  notifyAppReady(): Promise<unknown>;
  addListener(event: 'download', cb: (e: { percent: number }) => void): Promise<{ remove(): Promise<void> }>;
}

/** Seam over CapacitorUpdater (thin wrapper: the plugin proxy cannot be spied on and must not be DI-probed). */
export const UPDATER_PLUGIN = new InjectionToken<UpdaterPlugin>('UPDATER_PLUGIN', {
  providedIn: 'root',
  factory: () => ({
    download: (o) => CapacitorUpdater.download(o),
    set: (b) => CapacitorUpdater.set(b),
    notifyAppReady: () => CapacitorUpdater.notifyAppReady(),
    addListener: (e, cb) => CapacitorUpdater.addListener(e, cb),
  }),
});

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly http = inject(HTTP_GET);
  private readonly native = inject(NativeInfoService);
  private readonly installed = inject(INSTALLED_VERSION);
  private readonly updater = inject(UPDATER_PLUGIN);

  latest: LatestBundle | null = null;
  state: UpdateState = 'none';
  readonly changes$ = new BehaviorSubject<UpdateState>('none');

  readonly progress$ = new BehaviorSubject<number | null>(null);
  readonly error$ = new BehaviorSubject<string | null>(null);

  async apply(): Promise<void> {
    if (this.state !== 'available' || !this.latest || this.progress$.value !== null) return;
    const latest = this.latest;
    this.error$.next(null);
    this.progress$.next(0);
    let listener: { remove(): Promise<void> } | null = null;
    try {
      listener = await this.updater.addListener('download', e => this.progress$.next(e.percent));
      const bundle = await this.updater.download({ url: latest.url, version: latest.version });
      await this.updater.set(bundle);
    } catch {
      this.error$.next('Update failed, try again');
    } finally {
      this.progress$.next(null);
      try { await listener?.remove(); } catch { /* ignore */ }
    }
  }

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
