import { Component, ChangeDetectionStrategy, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { UpdateService, UpdateState } from '../../services/update.service';
import { ANDROID_APK_URL } from '../../services/android-links';

@Component({
  selector: 'app-update-button',
  templateUrl: './update-button.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './update-button.component.scss',
})
export class UpdateButtonComponent implements OnInit, OnDestroy {
  @Input() compact = false;
  readonly apkUrl = ANDROID_APK_URL;
  state: UpdateState = 'none';
  progress: number | null = null;
  error: string | null = null;
  private subs: Subscription[] = [];

  constructor(public update: UpdateService) {}

  get version(): string { return this.update.latest?.version ?? ''; }

  ngOnInit(): void {
    this.subs.push(
      this.update.changes$.subscribe(s => { this.state = s; }),
      this.update.progress$.subscribe(p => { this.progress = p; }),
      this.update.error$.subscribe(e => { this.error = e; }),
    );
  }

  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  apply(): void { void this.update.apply(); }
}
