import { Injectable, InjectionToken, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/** Seam over the Capacitor App plugin (its proxy cannot be spied on directly in tests). */
export const APP_PLUGIN = new InjectionToken<{ getInfo(): Promise<{ version: string }> }>('APP_PLUGIN', {
  providedIn: 'root',
  factory: () => ({ getInfo: () => App.getInfo() }),
});

@Injectable({ providedIn: 'root' })
export class NativeInfoService {
  private readonly app = inject(APP_PLUGIN);
  readonly isNative = Capacitor.isNativePlatform();

  async getAppVersion(): Promise<string | null> {
    if (!this.isNative) return null;
    try { return (await this.app.getInfo()).version; } catch { return null; }
  }
}
