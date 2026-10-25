# Multi-Roku, Android wrapper, background audio, smart startup

Date: 2026-10-25
Scope: `app/` (Angular) plus a new Capacitor Android project.

## Goals

1. Install and run on Android (the PWA cannot install: the app is served over
   plain `http://roku-proxy`, and Chrome on Android only offers install from
   secure contexts).
2. Private listening keeps playing when the screen locks or the user switches
   app.
3. Support several saved Rokus and switch between them.
4. Launching the app goes straight to the apps screen when a Roku is
   configured.

Out of scope: Play Store publishing, an iOS wrapper, simultaneous
private-listening streams to multiple Rokus.

## 1. Multiple Rokus and startup

### Data model

`RokuService` replaces the single `roku-ip` key with a saved list:

```ts
interface SavedRoku {
  id: string;            // stable uuid
  name: string;          // from device-info, user-renamable
  ip: string;
  ecpEnabled: boolean;
  deviceInfo: RokuDeviceInfo | null;
  tv: { type: TvType; ip: string | null };   // optional per-Roku TV
}
```

Stored under `rokus` (array) and `active-roku-id`. `TvService` reads its type
and IP from the active Roku instead of its own global keys.

**Migration (first run after upgrade):** if `roku-ip` exists and `rokus` does
not, create one entry from `roku-ip`, `roku-device-info`, `roku-ecp-enabled`
and the existing TV keys, set it active, then remove the old keys.

### Switching

- A dropdown in the header of the remote and apps screens shows the active
  Roku's name and lists the saved Rokus. A "Manage Rokus" item opens setup.
- Selecting a Roku sets `active-roku-id`; commands, the app list and the TV
  service then use that Roku's IP and TV config.
- Switching while private listening is running stops listening first (the
  stream targets one Roku).

### Setup screen

Becomes a list of saved Rokus plus an add/edit form. Discovery adds to the
list instead of replacing the saved Roku. Per Roku: rename, delete, and its
TV settings (type, IP, discover, test). Proxy and reboot-delay settings stay
global.

### Startup

- `''` redirects to `/apps` (or `/remote` when the active Roku has
  `ecpEnabled === false`, matching `SetupComponent.close()`) if an active
  Roku exists; otherwise to `/setup`.
- `connectedGuard` checks "has an active Roku" and no longer blocks on
  verification, so launch is instant.
- On arrival a background `device-info` check runs for the active Roku. If it
  fails, navigate to `/setup` with a banner above the Roku list:
  "Couldn't reach *{name}* ({ip})", with **Retry** and **Switch to another
  Roku** actions. The failed Roku is highlighted in the list. The banner
  clears once a check succeeds. The reason is carried in router state, so a
  manual visit to `/setup` shows no banner.

## 2. Android wrapper and background audio

- **Packaging:** Capacitor wraps the production Angular build into a
  sideloadable APK (`android/` at the repo root of `app/`). The WebView loads
  the bundled app from a local origin; the manifest allows cleartext HTTP so
  it can call `http://roku-proxy` (and LAN IPs). The web build is unchanged
  and still serves desktop and iOS.
- **Proxy URL default:** inside the native shell there is no same-origin
  proxy, so `ProxyService.detectDefaultUrl()` must return the
  `http://roku-proxy` default there (user-configurable as today).
- **Background audio:** add a native foreground service with a media
  notification (stop action), started by `AudioPlayerService.start()` and
  stopped by `stop()`, via an existing Capacitor foreground-service plugin.
  This keeps the process and WebView audio alive through screen lock and app
  switching. The existing hidden `<audio>`, MediaSession and wake-lock code
  stays for the browser build.
- **Risk and fallback:** WebView audio behaviour under screen lock can only
  be confirmed on a real device. If it still stutters or stops, fall back to
  decoding and playing the stream natively with ExoPlayer inside the service.
  That is a separate, larger change and is not part of this spec.

## 3. Testing

- Unit specs: list migration, active-Roku switching, TV service reading the
  active Roku's config, guard and startup redirect, failure-banner state.
- Playwright e2e against the mock server (second instance on another port):
  add a second Roku, switch, launch straight to `/apps`, unreachable Roku
  lands on setup with the banner.
- Android: manual device check by Dean for install, cleartext calls to the
  proxy, and audio through screen lock / app switch (not automatable here).
- Run `ng lint` and tests for the touched package before closing tickets.
