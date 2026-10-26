import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { RokuService } from '../../services/roku.service';
import { ProxyService, ProxyDevice } from '../../services/proxy.service';
import { APP_VERSION } from '../../version';
import { ANDROID_APK_URL } from '../../services/android-links';
import { UpdateService } from '../../services/update.service';
import { UpdateButtonComponent } from '../../components/update-button/update-button.component';
import { RokuCardComponent } from '../../components/roku-card/roku-card.component';
import { NativeInfoService } from '../../services/native-info.service';
import { SaveResult } from '../../services/roku-config.service';

@Component({
  selector: 'app-setup',
  imports: [FormsModule, UpdateButtonComponent, RokuCardComponent],
  templateUrl: './setup.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './setup.component.scss'
})
export class SetupComponent implements OnInit {
  readonly androidApkUrl = ANDROID_APK_URL;
  readonly appVersion = APP_VERSION;
  nativeVersion: string | null = null;
  readonly isNativeApp = Capacitor.isNativePlatform();
  readonly isAndroidBrowser = !Capacitor.isNativePlatform() && /Android/i.test(navigator.userAgent);

  adding = false;
  prefill: { ip: string; name: string } | null = null;
  loading = false;
  error: { type: string; message: string } | null = null;

  proxyAvailable = false;
  discovering = false;
  discoveredDevices: ProxyDevice[] = [];

  proxyUrl: string;
  showProxyConfig = false;
  showRebootConfig = false;
  browserOrigin = '';
  rebootShortDelayMs = 180;
  rebootLongDelayMs = 700;

  unreachable: { id: string; name: string; ip: string; message?: string } | null = null;

  get rokus() { return this.roku.rokus; }
  get activeId(): string | null { return this.roku.activeRoku?.id ?? null; }

  constructor(
    public roku: RokuService,
    public proxy: ProxyService,
    private router: Router,
    private nativeInfo: NativeInfoService,
    private update: UpdateService,
  ) {
    this.proxyUrl = proxy.getProxyUrl();
    if (typeof window !== 'undefined') {
      this.browserOrigin = window.location.origin;
    }
    this.unreachable = this.router.getCurrentNavigation()?.extras.state?.['unreachable'] ?? null;
    // Make the next /apps or /remote navigation re-run the startup reachability check.
    if (this.unreachable) this.roku.startupVerifiedId = null;
  }

  ngOnInit(): void {
    void this.update.check();
    void this.nativeInfo.getAppVersion().then(v => { this.nativeVersion = v; });
    this.loadRebootDelaySettings();

    // Check if proxy is available for auto-discovery
    this.proxy.isAvailable().subscribe(available => {
      this.proxyAvailable = available;
    });
  }

  useRoku(id: string): void { this.unreachable = null; this.roku.selectRoku(id); this.close(); }

  retryUnreachable(): void {
    if (!this.unreachable) return;
    this.loading = true;
    this.error = null;
    this.roku.connect(this.unreachable.ip).subscribe({
      next: () => { this.loading = false; this.unreachable = null; this.close(); },
      error: (err) => { this.loading = false; this.error = err; },
    });
  }
  dismissUnreachable(): void { this.unreachable = null; }

  deleteRoku(id: string): void {
    if (this.unreachable?.id === id) this.unreachable = null;
    this.roku.removeRoku(id);
  }

  startAdd(): void { this.prefill = null; this.adding = true; }
  cancelAdd(): void { this.adding = false; this.prefill = null; }

  onSaved(result: SaveResult): void {
    this.adding = false;
    this.prefill = null;
    if (this.unreachable?.id === result.id) this.unreachable = null;
  }

  discoverDevices(): void {
    this.discovering = true;
    this.discoveredDevices = [];
    this.error = null;

    this.proxy.discover().subscribe({
      next: (devices) => {
        this.discoveredDevices = devices;
        this.discovering = false;
      },
      error: () => {
        this.discovering = false;
        this.error = { type: 'unknown', message: 'Discovery failed.' };
      },
    });
  }

  selectDevice(device: ProxyDevice): void {
    this.prefill = { ip: device.ip, name: device.name };
    this.adding = true;
  }

  saveProxyUrl(): void {
    this.proxy.setProxyUrl(this.proxyUrl);
    this.recheckProxy();
  }

  resetProxyUrl(): void {
    this.proxy.resetToDefault();
    this.proxyUrl = this.proxy.getProxyUrl();
    this.recheckProxy();
  }

  saveRebootDelays(): void {
    this.roku.setRebootDelays({
      shortMs: this.rebootShortDelayMs,
      longMs: this.rebootLongDelayMs,
    });
    this.loadRebootDelaySettings();
  }

  resetRebootDelays(): void {
    this.roku.setRebootDelays({
      shortMs: 180,
      longMs: 700,
    });
    this.loadRebootDelaySettings();
  }

  private recheckProxy(): void {
    this.proxyAvailable = false;
    this.proxy.isAvailable().subscribe(available => {
      this.proxyAvailable = available;
    });
  }

  isSameOriginProxyMode(): boolean {
    return this.proxy.getProxyUrl() === '';
  }

  effectiveProxyTarget(): string {
    return this.isSameOriginProxyMode() ? this.browserOrigin : this.proxy.getProxyUrl();
  }

  close(): void {
    const dest = this.roku.ecpEnabled ? '/apps' : '/remote';
    this.router.navigate([dest]);
  }

  openVersions(): void {
    this.router.navigate(['/versions']);
  }

  private loadRebootDelaySettings(): void {
    const delays = this.roku.getRebootDelays();
    this.rebootShortDelayMs = delays.shortMs;
    this.rebootLongDelayMs = delays.longMs;
  }
}
