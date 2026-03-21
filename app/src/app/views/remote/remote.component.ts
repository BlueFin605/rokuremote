import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RokuService, RokuKey } from '../../services/roku.service';

@Component({
  selector: 'app-remote',
  imports: [FormsModule],
  templateUrl: './remote.component.html',
  styleUrl: './remote.component.scss'
})
export class RemoteComponent implements OnInit, OnDestroy {
  textInput = '';
  disconnected = false;
  private volumeRepeatTimer: ReturnType<typeof setInterval> | null = null;
  private sub?: Subscription;

  constructor(
    private roku: RokuService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.sub = this.roku.connectionLost$.subscribe(() => {
      this.disconnected = true;
    });
  }

  ngOnDestroy(): void {
    this.stopVolumeRepeat();
    this.sub?.unsubscribe();
  }

  press(key: RokuKey): void {
    this.roku.keypress(key);
  }

  sendText(): void {
    if (this.textInput.trim()) {
      this.roku.sendText(this.textInput);
      this.textInput = '';
    }
  }

  startVolumeRepeat(key: 'VolumeUp' | 'VolumeDown'): void {
    this.roku.keypress(key);
    this.volumeRepeatTimer = setInterval(() => this.roku.keypress(key), 150);
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

  reconnect(): void {
    this.disconnected = false;
    this.router.navigate(['/setup']);
  }

  disconnect(): void {
    this.roku.disconnect();
    this.router.navigate(['/setup']);
  }
}
