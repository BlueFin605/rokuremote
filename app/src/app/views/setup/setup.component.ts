import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Subscription } from 'rxjs';
import { SavedRoku } from '../../services/saved-roku';
import { RokuService, RokuDeviceInfo } from '../../services/roku.service';
import { ProxyService, ProxyDevice } from '../../services/proxy.service';
import { APP_VERSION } from '../../version';
import { ANDROID_APK_URL } from '../../services/android-links';
import { UpdateService } from '../../services/update.service';
import { UpdateButtonComponent } from '../../components/update-button/update-button.component';
import { NativeInfoService } from '../../services/native-info.service';
import { TvService, TvType, DiscoveredTv } from '../../services/tv.service';

@Component({
  selector: 'app-setup',
  imports: [FormsModule, UpdateButtonComponent],
  templateUrl: './setup.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './setup.component.scss'
})
export class SetupComponent implements OnInit, OnDestroy {
  readonly androidApkUrl = ANDROID_APK_URL;
  readonly appVersion = APP_VERSION;
  nativeVersion: string | null = null;
  readonly isNativeApp = Capacitor.isNativePlatform();
  readonly isAndroidBrowser = !Capacitor.isNativePlatform() && /Android/i.test(navigator.userAgent);

  ipAddress = '';
  loading = false;
  error: { type: string; message: string } | null = null;
  deviceInfo: RokuDeviceInfo | null = null;

  proxyAvailable = false;
  discovering = false;
  discoveredDevices: ProxyDevice[] = [];

  proxyUrl: string;
  showProxyConfig = false;
  showRebootConfig = false;
  browserOrigin = '';
  rebootShortDelayMs = 180;
  rebootLongDelayMs = 700;

  // TV settings
  showTvConfig = false;
  tvType: TvType;
  tvIpAddress: string;
  tvTesting = false;
  tvError: string | null = null;
  tvSuccess = false;
  tvPairingRequired = false;
  tvDiscovering = false;
  discoveredTvs: DiscoveredTv[] = [];

  formRokuId: string | null = null;
  editingId: string | null = null;
  editName = '';
  unreachable: { id: string; name: string; ip: string; message?: string } | null = null;
  private activeSub?: Subscription;

  get rokus() { return this.roku.rokus; }
  get activeId(): string | null { return this.roku.activeRoku?.id ?? null; }

  constructor(
    public roku: RokuService,
    public proxy: ProxyService,
    private tv: TvService,
    private router: Router,
    private nativeInfo: NativeInfoService,
    private update: UpdateService,
  ) {
    this.proxyUrl = proxy.getProxyUrl();
    this.tvType = tv.type;
    this.tvIpAddress = tv.ip ?? '';
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

    this.syncFromActive();
    this.activeSub = this.roku.activeChanged$.subscribe(() => this.syncFromActive());

    // Check if proxy is available for auto-discovery
    this.proxy.isAvailable().subscribe(available => {
      this.proxyAvailable = available;
    });
  }

  ngOnDestroy(): void {
    this.activeSub?.unsubscribe();
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
    const wasActive = id === this.roku.activeRoku?.id;
    if (this.unreachable?.id === id) this.unreachable = null;
    this.roku.removeRoku(id);
    if (wasActive) this.syncFromActive();
  }
  startRename(r: SavedRoku): void { this.editingId = r.id; this.editName = r.name; }
  commitRename(): void {
    if (this.editingId) this.roku.renameRoku(this.editingId, this.editName);
    this.editingId = null;
  }
  startAdd(): void { this.formRokuId = null; this.ipAddress = ''; this.deviceInfo = null; this.error = null; }

  private syncFromActive(): void {
    this.formRokuId = this.roku.activeRoku?.id ?? null;
    this.ipAddress = this.roku.getSavedIp() ?? '';
    this.deviceInfo = this.roku.getCachedDeviceInfo();
    this.tvType = this.tv.type;
    this.tvIpAddress = this.tv.ip ?? '';
    this.tvSuccess = false;
    this.tvError = null;
    this.tvPairingRequired = false;
    this.discoveredTvs = [];
  }

  saveRoku(): void {
    if (!this.ipAddress.trim()) return;

    this.loading = true;
    this.error = null;
    this.deviceInfo = null;

    this.roku.connect(this.ipAddress.trim(), { replaceId: this.formRokuId ?? undefined }).subscribe({
      next: (info) => {
        this.unreachable = null;
        this.formRokuId = this.roku.activeRoku?.id ?? null;
        this.deviceInfo = info;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err;
      },
    });
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
    this.ipAddress = device.ip;
    this.saveRoku();
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

  // --- TV Settings ---

  saveTvSettings(): void {
    if (this.tvType === 'none') {
      this.tv.configure('none', null);
      this.tvSuccess = false;
      this.tvError = null;
      this.tvPairingRequired = false;
      return;
    }

    if (!this.tvIpAddress.trim()) {
      this.tvError = 'Enter the TV IP address.';
      return;
    }

    this.tv.configure(this.tvType, this.tvIpAddress.trim());
    this.testTvConnection();
  }

  testTvConnection(): void {
    this.tvTesting = true;
    this.tvError = null;
    this.tvSuccess = false;
    this.tvPairingRequired = false;

    this.tv.testConnection().subscribe(result => {
      this.tvTesting = false;
      if (result.ok) {
        this.tvSuccess = true;
      } else if (result.pairingRequired) {
        this.tvPairingRequired = true;
        this.tvError = 'This TV requires pairing. Pairing support coming soon.';
      } else {
        this.tvError = 'TV not found at this IP. Check the address and make sure the TV is on.';
      }
    });
  }

  discoverTvs(): void {
    if (this.tvType === 'none') return;

    this.tvDiscovering = true;
    this.discoveredTvs = [];

    this.tv.discover(this.tvType).subscribe({
      next: (tvs) => {
        this.discoveredTvs = tvs;
        this.tvDiscovering = false;
      },
      error: () => {
        this.tvDiscovering = false;
      },
    });
  }

  selectTv(device: DiscoveredTv): void {
    this.tvIpAddress = device.ip;
    this.saveTvSettings();
  }

  onTvTypeChange(): void {
    // Reset status indicators when type changes, but keep the IP if one was entered
    this.tvSuccess = false;
    this.tvError = null;
    this.tvPairingRequired = false;
    this.discoveredTvs = [];

    if (this.tvType === 'none') {
      this.clearTvSettings();
    }
  }

  close(): void {
    const dest = this.roku.ecpEnabled ? '/apps' : '/remote';
    this.router.navigate([dest]);
  }

  openVersions(): void {
    this.router.navigate(['/versions']);
  }

  clearTvSettings(): void {
    this.tvType = 'none';
    this.tvIpAddress = '';
    this.tv.configure('none', null);
    this.tvSuccess = false;
    this.tvError = null;
    this.tvPairingRequired = false;
    this.discoveredTvs = [];
  }

  private loadRebootDelaySettings(): void {
    const delays = this.roku.getRebootDelays();
    this.rebootShortDelayMs = delays.shortMs;
    this.rebootLongDelayMs = delays.longMs;
  }
}
