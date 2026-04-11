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
  private static readonly FIRMWARE_BASE_URL = 'https://roku.bluefin605.com';

  loading = true;
  siteInfo: VersionInfo | null = null;
  selectedFirmwareInfo: VersionInfo | null = null;
  latestFirmwareInfo: VersionInfo | null = null;
  selectedFirmwarePath = '/firmware/latest';
  latestFirmwarePath = '/firmware/latest';

  constructor(
    private http: HttpClient,
    private router: Router,
    public demoMode: DemoModeService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.siteInfo = await this.readJson('/version.json');

    const preferredPath = this.normalizePath(this.siteInfo?.firmwarePath ?? '/firmware/latest');
    const preferredLatestPath = this.normalizePath(this.siteInfo?.firmwareLatestPath ?? '/firmware/latest');

    const selectedFirmware = await this.loadFirmwareInfo(preferredPath);
    if (selectedFirmware) {
      this.selectedFirmwarePath = selectedFirmware.path;
      this.selectedFirmwareInfo = selectedFirmware.info;
    }

    if (preferredPath !== preferredLatestPath) {
      const latestFirmware = await this.loadFirmwareInfo(preferredLatestPath);
      if (latestFirmware) {
        this.latestFirmwarePath = latestFirmware.path;
        this.latestFirmwareInfo = latestFirmware.info;
      } else {
        this.latestFirmwarePath = preferredLatestPath;
      }
    } else {
      this.latestFirmwarePath = this.selectedFirmwarePath;
      this.latestFirmwareInfo = this.selectedFirmwareInfo;
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
    return `${VersionsComponent.FIRMWARE_BASE_URL}${this.normalizePath(basePath)}/${relativeFile}`;
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

  private normalizePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed.startsWith('/')) return `/${trimmed}`;
    return trimmed;
  }

  private async loadFirmwareInfo(startPath: string): Promise<{ path: string; info: VersionInfo } | null> {
    const candidates = this.firmwareMetadataCandidates(startPath);
    for (const candidate of candidates) {
      const info = await this.readJson(`${candidate}/version.json`);
      if (info) {
        return { path: candidate, info };
      }
    }
    return null;
  }

  private firmwareMetadataCandidates(startPath: string): string[] {
    const normalized = this.normalizePath(startPath);
    const parent = normalized.replace(/\/(esp32s3|esp32)$/i, '');

    const candidates = [normalized];
    if (parent !== normalized) {
      candidates.push(parent);
    } else {
      candidates.push(`${normalized}/esp32s3`);
      candidates.push(`${normalized}/esp32`);
    }

    return [...new Set(candidates)];
  }

  private async readJson(path: string): Promise<VersionInfo | null> {
    try {
      const url = `${VersionsComponent.FIRMWARE_BASE_URL}${path}?t=${Date.now()}`;
      const result = await firstValueFrom(this.http.get<VersionInfo>(url));
      return result;
    } catch {
      return null;
    }
  }
}