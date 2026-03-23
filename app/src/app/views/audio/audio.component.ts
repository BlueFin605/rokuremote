import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { interval, Subscription, switchMap } from 'rxjs';
import { ProxyService, ProxyStatus } from '../../services/proxy.service';
import { RokuService } from '../../services/roku.service';
import { AudioPlayerService } from '../../services/audio-player.service';

@Component({
  selector: 'app-audio',
  imports: [FormsModule, TitleCasePipe],
  templateUrl: './audio.component.html',
  styleUrl: './audio.component.scss'
})
export class AudioComponent implements OnInit, OnDestroy {
  proxyUrl: string;
  proxyAvailable = false;
  proxyStatus: ProxyStatus = { state: 'idle' };
  checking = true;
  error: string | null = null;
  private pollSub?: Subscription;
  private wasStreaming = false;

  constructor(
    private proxy: ProxyService,
    private roku: RokuService,
    private audioPlayer: AudioPlayerService,
    private router: Router,
  ) {
    this.proxyUrl = proxy.getProxyUrl();
  }

  get isPlaying(): boolean {
    return this.audioPlayer.isPlaying;
  }

  get maxLatencyMs(): number {
    return Math.round(this.audioPlayer.maxLatency * 1000);
  }

  onLatencyChange(ms: number): void {
    this.audioPlayer.maxLatency = ms / 1000;
  }

  ngOnInit(): void {
    this.checkProxy();
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  checkProxy(): void {
    this.checking = true;
    this.error = null;
    this.proxy.setProxyUrl(this.proxyUrl);
    this.proxy.isAvailable().subscribe(available => {
      this.proxyAvailable = available;
      this.checking = false;
      if (available) {
        this.startPolling();
      }
    });
  }

  startListening(): void {
    this.error = null;
    const rokuIp = this.roku.getSavedIp();
    if (!rokuIp) {
      this.error = 'No Roku connected. Go back and connect first.';
      return;
    }

    this.proxy.startListening(rokuIp).subscribe({
      next: () => {},
      error: () => {
        this.error = 'Failed to start private listening.';
      },
    });
  }

  stopListening(): void {
    this.audioPlayer.stop();
    this.proxy.stopListening().subscribe({
      next: () => {},
      error: () => {
        this.error = 'Failed to stop.';
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/remote']);
  }

  private startPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = interval(1000).pipe(
      switchMap(() => this.proxy.getStatus()),
    ).subscribe({
      next: (status) => {
        this.proxyStatus = status;

        // Auto-start audio playback when proxy reaches streaming state
        if (status.state === 'streaming' && !this.wasStreaming) {
          this.wasStreaming = true;
          this.audioPlayer.start(this.proxy.getAudioStreamUrl());
        }

        // Reset when streaming stops
        if (status.state !== 'streaming') {
          this.wasStreaming = false;
        }
      },
      error: () => {
        this.proxyAvailable = false;
      },
    });
  }
}
