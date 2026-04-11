import { Routes } from '@angular/router';
import { SetupComponent } from './views/setup/setup.component';
import { RemoteComponent } from './views/remote/remote.component';
import { LauncherComponent } from './views/launcher/launcher.component';
import { AudioComponent } from './views/audio/audio.component';
import { VersionsComponent } from './views/versions/versions.component';
import { connectedGuard } from './guards/connected.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'setup', pathMatch: 'full' },
  { path: 'setup', component: SetupComponent },
  { path: 'remote', component: RemoteComponent, canActivate: [connectedGuard] },
  { path: 'apps', component: LauncherComponent, canActivate: [connectedGuard] },
  { path: 'audio', component: AudioComponent, canActivate: [connectedGuard] },
  { path: 'versions', component: VersionsComponent },
];
