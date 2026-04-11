import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DemoModeService } from '../../services/demo-mode.service';

interface VersionInfo {
  gitRefName?: string;
  gitSha?: string;
  builtAtUtc?: string;
  publishMode?: 'release' | 'branch' | string;
  firmwarePath?: string;
  firmwareLatestPath?: string;
  firmwarePaths?: Record<string, string>;
  firmwareLatestPaths?: Record<string, string>;
  firmwareVersion?: string;
}

@Component({
  selector: 'app-versions',
  templateUrl: './versions.component.html',
  styleUrl: './versions.component.scss'
})
export class VersionsComponent implements OnInit {
  loading = true;
  siteInfo: VersionInfo | null = null;
  selectedFirmwareInfo: VersionInfo | null = null;
  latestFirmwareInfo: VersionInfo | null = null;
  latestFirmwarePath = '/firmware/latest/esp32s3';

  constructor(
    private http: HttpClient,
    private router: Router,
    public demoMode: DemoModeService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.siteInfo = await this.readJson('/version.json');

    const preferredPath = this.normalizePath(this.siteInfo?.firmwarePath ?? '/firmware/latest/esp32s3');
    this.latestFirmwarePath = this.normalizePath(this.siteInfo?.firmwareLatestPath ?? '/firmware/latest/esp32s3');
    this.selectedFirmwareInfo = await this.readJson(`${preferredPath}/version.json`);

    if (preferredPath !== this.latestFirmwarePath) {
      this.latestFirmwareInfo = await this.readJson(`${this.latestFirmwarePath}/version.json`);
    }

    this.loading = false;
  }

  goBack(): void {
    this.router.navigate(['/setup']);
  }

  firmwareBasePath(info: VersionInfo | null, fallback: string): string {
    return this.normalizePath(info?.firmwarePath ?? fallback);
  }

  firmwareFileUrl(basePath: string, relativeFile: string): string {
    return `${this.origin()}${this.normalizePath(basePath)}/${relativeFile}`;
  }

  shortSha(sha: string | undefined): string {
    if (!sha) return 'unknown';
    return sha.slice(0, 7);
  }

  githubVersion(info: VersionInfo | null): string {
    if (!info) return 'unknown';
    if (info.firmwareVersion) return info.firmwareVersion;

    const ref = info.gitRefName?.trim();
    const sha = info.gitSha?.trim();
    if (ref && sha) return `${ref}@${this.shortSha(sha)}`;
    if (ref) return ref;
    if (sha) return this.shortSha(sha);
    return 'unknown';
  }

  private origin(): string {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }

  private normalizePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed.startsWith('/')) return `/${trimmed}`;
    return trimmed;
  }

  private async readJson(path: string): Promise<VersionInfo | null> {
    try {
      const url = `${path}?t=${Date.now()}`;
      return await firstValueFrom(this.http.get<VersionInfo>(url));
    } catch {
      return null;
    }
  }
}