import { Component, ChangeDetectionStrategy, ElementRef, HostListener, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { RokuService } from '../../services/roku.service';
import { AudioPlayerService } from '../../services/audio-player.service';
import { ProxyService } from '../../services/proxy.service';

@Component({
  selector: 'app-roku-switcher',
  templateUrl: './roku-switcher.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './roku-switcher.component.scss',
})
export class RokuSwitcherComponent {
  open = false;
  @ViewChild('trigger') private trigger?: ElementRef<HTMLElement>;
  constructor(public roku: RokuService, private audioPlayer: AudioPlayerService, private proxy: ProxyService, private router: Router, private host: ElementRef<HTMLElement>) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: Event): void {
    if (this.open && !this.host.nativeElement.contains(e.target as Node)) this.open = false;
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    if (!this.open) return;
    this.open = false;
    this.trigger?.nativeElement.focus();
  }

  toggle(): void { this.open = !this.open; }

  select(id: string): void {
    this.open = false;
    if (id === this.roku.activeRoku?.id) return;
    if (this.audioPlayer.isPlaying) {
      this.audioPlayer.stop();
      this.proxy.stopListening().subscribe({ error: () => {} });
    }
    this.roku.selectRoku(id);
  }

  manage(): void {
    this.open = false;
    this.router.navigate(['/setup']);
  }
}
