import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Redirect HTTPS to HTTP — the app needs HTTP to reach the local ESP32 proxy
// without mixed-content restrictions. Skip on localhost (dev server).
if (window.location.protocol === 'https:' && window.location.hostname !== 'localhost') {
  window.location.replace(window.location.href.replace('https:', 'http:'));
} else {
  bootstrapApplication(AppComponent, appConfig)
    .catch((err) => console.error(err));
}
