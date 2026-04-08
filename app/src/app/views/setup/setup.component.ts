import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RokuService, RokuDeviceInfo } from '../../services/roku.service';
import { ProxyService, ProxyDevice } from '../../services/proxy.service';

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

  constructor(
    private roku: RokuService,
    public proxy: ProxyService,
    private router: Router,
  ) {
    this.proxyUrl = proxy.getProxyUrl();
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
        const dest = info.ecpEnabled ? '/apps' : '/remote';
        setTimeout(() => this.router.navigate([dest]), 1000);
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
}
