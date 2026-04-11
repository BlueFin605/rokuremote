import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DemoModeService } from './services/demo-mode.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'roku-remote';

  constructor(public demoMode: DemoModeService) {}
}
