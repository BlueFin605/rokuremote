import { Injectable } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

@Injectable({ providedIn: 'root' })
export class NativeBackgroundService {
  // Capacitor plugin proxies cannot be spied on directly; specs swap this field.
  private plugin: typeof ForegroundService = ForegroundService;
  private listener: PluginListenerHandle | null = null;

  get available(): boolean { return Capacitor.getPlatform() === 'android'; }

  async start(onStop: () => void): Promise<void> {
    if (!this.available) return;
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
    }
  }

  async stop(): Promise<void> {
    if (!this.available) return;
    await this.listener?.remove();
    this.listener = null;
    try { await this.plugin.stopForegroundService(); } catch { /* not running */ }
  }
}
