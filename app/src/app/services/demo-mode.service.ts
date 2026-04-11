import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class DemoModeService {
  private static readonly STORAGE_KEY = 'demo-mode-enabled';

  private readonly _enabled: boolean;
  private readonly _reason: string;

  constructor() {
    const resolved = this.resolveState();
    this._enabled = resolved.enabled;
    this._reason = resolved.reason;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get reason(): string {
    return this._reason;
  }

  private resolveState(): { enabled: boolean; reason: string } {
    if (typeof window === 'undefined') {
      return { enabled: false, reason: '' };
    }

    const host = window.location.hostname.toLowerCase();
    const isEsp32HostedOrigin =
      (host === 'roku-proxy' || host === 'roku-proxy.local' || /^192\.168\./.test(host)) &&
      window.location.port === '';

    // Never allow demo mode when the app is hosted directly by the ESP32.
    if (isEsp32HostedOrigin) {
      localStorage.setItem(DemoModeService.STORAGE_KEY, 'false');
      return { enabled: false, reason: '' };
    }

    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get('demo');
    if (queryValue === '1') {
      localStorage.setItem(DemoModeService.STORAGE_KEY, 'true');
      return { enabled: true, reason: 'enabled from URL query parameter' };
    }
    if (queryValue === '0') {
      localStorage.setItem(DemoModeService.STORAGE_KEY, 'false');
      return { enabled: false, reason: '' };
    }

    const stored = localStorage.getItem(DemoModeService.STORAGE_KEY);
    if (stored === 'true') {
      return { enabled: true, reason: 'enabled from local preference' };
    }
    if (stored === 'false') {
      return { enabled: false, reason: '' };
    }

    if (
      host === 'reokuremote.bluefin605.com' ||
      host === 'rokuremote.bluefin605.com'
    ) {
      return { enabled: true, reason: 'enabled for hosted bluefin demo domain' };
    }

    return { enabled: false, reason: '' };
  }
}