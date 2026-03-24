import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Show a prompt if loaded over HTTPS — the app needs HTTP to reach the local proxy.
if (window.location.protocol === 'https:' && window.location.hostname !== 'localhost') {
  const httpUrl = window.location.href.replace('https:', 'http:');
  document.body.innerHTML = `
    <div style="background:#1a1a2e;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;padding:2rem;text-align:center">
      <div style="max-width:400px">
        <h2 style="margin-bottom:1rem">HTTPS Detected</h2>
        <p style="margin-bottom:1.5rem;opacity:0.8">This app needs HTTP (not HTTPS) to communicate with the local Roku proxy. Tap the link below to switch.</p>
        <a href="${httpUrl}" style="color:#9b6de3;font-size:1.2rem;text-decoration:underline">Switch to HTTP</a>
      </div>
    </div>`;
} else {
  bootstrapApplication(AppComponent, appConfig)
    .catch((err) => console.error(err));
}
