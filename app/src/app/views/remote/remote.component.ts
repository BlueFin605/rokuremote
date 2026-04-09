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
  }

  press(key: RokuKey): void {
    this.roku.keypress(key);
  }

  pressPower(): void {
    if (this.tv.configured) {
      this.tv.command('power');
    } else {
      this.roku.keypress('PowerOff');
    }
  }

  pressMute(): void {
    if (this.tv.configured) {
      this.tv.command('mute');
    } else {
      this.roku.keypress('VolumeMute');
    }
  }

  pressHdmi(input: 1 | 2 | 3 | 4): void {
    this.tv.command(`hdmi${input}` as TvAction);
  }

  sendText(): void {
    if (this.textInput.trim()) {
      this.roku.sendText(this.textInput);
      this.textInput = '';
    }
  }

  startVolumeRepeat(direction: 'up' | 'down'): void {
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

  openAudio(): void {
    this.router.navigate(['/audio']);
  }

  openSetup(): void {
    this.router.navigate(['/setup']);
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
