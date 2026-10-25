import { Injectable } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

@Injectable({ providedIn: 'root' })
export class NativeBackgroundService {
  // Capacitor plugin proxies cannot be spied on directly; specs swap this field.
  private plugin: typeof ForegroundService = ForegroundService;
  private listener: PluginListenerHandle | null = null;

  private starting: Promise<void> | null = null;

  get available(): boolean { return Capacitor.getPlatform() === 'android'; }

  start(onStop: () => void): Promise<void> {
    if (!this.available) return Promise.resolve();
    // Idempotent: a start already in flight or completed is not repeated until stop().
    if (this.starting) return this.starting;
    if (this.listener) return Promise.resolve();
    this.starting = this.doStart(onStop);
    return this.starting;
  }

  private async doStart(onStop: () => void): Promise<void> {
    try {
      await this.plugin.requestPermissions();
      this.listener = await this.plugin.addListener('buttonClicked', () => onStop());
      await this.plugin.startForegroundService({
        id: 1,
        title: 'Private Listening',
        body: 'Streaming from your Roku',
        smallIcon: 'ic_stat_listening',
        buttons: [{ id: 1, title: 'Stop' }],
      });
    } catch (e) {
      console.warn('Foreground service unavailable', e);
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.available) return;
    // Let any in-flight start settle first so it cannot finish after we clean up.
    await this.starting; // doStart never rejects
    const listener = this.listener;
    this.listener = null;
    try { await listener?.remove(); } catch { /* ignore */ }
    try { await this.plugin.stopForegroundService(); } catch { /* not running */ }
  }
}
