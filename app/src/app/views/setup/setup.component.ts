import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RokuService, RokuDeviceInfo } from '../../services/roku.service';
import { ProxyService, ProxyDevice } from '../../services/proxy.service';
import { TvService, TvType, DiscoveredTv } from '../../services/tv.service';

@Component({
  selector: 'app-setup',
  imports: [FormsModule],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.scss'
})
export class SetupComponent implements OnInit {
  ipAddress = '';
  loading = false;
  error: { type: string; message: string } | null = null;
  deviceInfo: RokuDeviceInfo | null = null;

  proxyAvailable = false;
  discovering = false;
  discoveredDevices: ProxyDevice[] = [];

  proxyUrl: string;
  showProxyConfig = false;
  browserOrigin = '';

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

  constructor(
    private roku: RokuService,
    public proxy: ProxyService,
    private tv: TvService,
    private router: Router,
  ) {
    this.proxyUrl = proxy.getProxyUrl();
    this.tvType = tv.type;
    this.tvIpAddress = tv.ip ?? '';
    if (typeof window !== 'undefined') {
      this.browserOrigin = window.location.origin;
    }
  }

  ngOnInit(): void {
    const savedIp = this.roku.getSavedIp();
    if (savedIp) {
      this.ipAddress = savedIp;
      this.tryConnect();
    }

    // Check if proxy is available for auto-discovery
    this.proxy.isAvailable().subscribe(available => {
      this.proxyAvailable = available;
    });
  }

  tryConnect(): void {
    if (!this.ipAddress.trim()) return;

    this.loading = true;
    this.error = null;
    this.deviceInfo = null;

    this.roku.connect(this.ipAddress.trim()).subscribe({
      next: (info) => {
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
    this.tryConnect();
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

  clearTvSettings(): void {
    this.tvType = 'none';
    this.tvIpAddress = '';
    this.tv.configure('none', null);
    this.tvSuccess = false;
    this.tvError = null;
    this.tvPairingRequired = false;
    this.discoveredTvs = [];
  }
}
