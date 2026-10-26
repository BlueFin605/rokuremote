import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DemoModeService } from './services/demo-mode.service';
import { NativeInfoService } from './services/native-info.service';
import { UPDATER_PLUGIN } from './services/update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'roku-remote';

  private readonly native = inject(NativeInfoService);
  private readonly updater = inject(UPDATER_PLUGIN);

  constructor(public demoMode: DemoModeService) {
    // Confirms this bundle booted; without it the updater rolls back automatically.
    if (this.native.isNative) void this.updater.notifyAppReady().catch(() => undefined);
  }
}
