import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RokuService, RokuKey } from '../../services/roku.service';
import { TvService, TvAction } from '../../services/tv.service';

@Component({
  selector: 'app-remote',
  imports: [FormsModule],
  templateUrl: './remote.component.html',
  styleUrl: './remote.component.scss'
})
export class RemoteComponent implements OnInit, OnDestroy {
  textInput = '';
  disconnected = false;
  tvError = false;
  private volumeRepeatTimer: ReturnType<typeof setInterval> | null = null;
  private subs: Subscription[] = [];
  private audioCtx: AudioContext | null = null;

  get ecpEnabled(): boolean {
    return this.roku.ecpEnabled;
  }

  get tvConfigured(): boolean {
    return this.tv.configured;
  }

  constructor(
    private roku: RokuService,
    private tv: TvService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.subs.push(
      this.roku.connectionLost$.subscribe(() => {
        this.disconnected = true;
      }),
      this.tv.connectionError$.subscribe(() => {
        this.tvError = true;
        setTimeout(() => this.tvError = false, 2000);
      }),
    );
  }

  ngOnDestroy(): void {
    this.stopVolumeRepeat();
    this.subs.forEach(s => s.unsubscribe());
    this.audioCtx?.close();
  }

  press(key: RokuKey): void {
    this.playClick();
    this.roku.keypress(key);
  }

  pressPower(): void {
    this.playClick();
    if (this.tv.configured) {
      this.tv.command('power');
    } else {
      this.roku.wake();
    }
  }

  pressMute(): void {
    this.playClick();
    if (this.tv.configured) {
      this.tv.command('mute');
    } else {
      this.roku.keypress('VolumeMute');
    }
  }

  pressHdmi(input: 1 | 2 | 3 | 4): void {
    this.playClick();
    this.tv.command(`hdmi${input}` as TvAction);
  }

  sendText(): void {
    if (this.textInput.trim()) {
      this.playClick();
      this.roku.sendText(this.textInput);
      this.textInput = '';
    }
  }

  startVolumeRepeat(direction: 'up' | 'down'): void {
    this.playClick();
    if (this.tv.configured) {
      const action: TvAction = direction === 'up' ? 'volume_up' : 'volume_down';
      this.tv.command(action);
      this.volumeRepeatTimer = setInterval(() => this.tv.command(action), 150);
    } else {
      const key: RokuKey = direction === 'up' ? 'VolumeUp' : 'VolumeDown';
      this.roku.keypress(key);
      this.volumeRepeatTimer = setInterval(() => this.roku.keypress(key), 150);
    }
  }

  stopVolumeRepeat(): void {
    if (this.volumeRepeatTimer) {
      clearInterval(this.volumeRepeatTimer);
      this.volumeRepeatTimer = null;
    }
  }

  openApps(): void {
    this.router.navigate(['/apps']);
  }

  private playClick(): void {
    try {
      this.audioCtx ??= new AudioContext();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.06);
    } catch {
      // audio unavailable
    }
    navigator.vibrate?.(12);
  }

  openAudio(): void {
    this.router.navigate(['/audio']);
  }

  rebootRoku(): void {
    this.roku.reboot();
  }

  openSetup(): void {
    this.router.navigate(['/setup']);
  }

  openVersions(): void {
    this.router.navigate(['/versions']);
  }

  reconnect(): void {
    this.disconnected = false;
    this.router.navigate(['/setup']);
  }

  disconnect(): void {
    this.roku.disconnect();
    this.router.navigate(['/setup']);
  }
}
