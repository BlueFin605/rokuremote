# Plans — RokuRemote

What's not true yet. Each plan is a set of truth statements that are deleted when they become true in the running system.

---

## Dependency Graph

```
Plan 1: Project Scaffolding          ✅ COMPLETE
  └─► Plan 2: Infrastructure & Deployment   🔧 CODE COMPLETE (needs deploy)
  └─► Plan 3: Connect & Setup              ✅ COMPLETE
        └─► Plan 4: Remote Control          ✅ COMPLETE
              └─► Plan 5: App Launcher      ✅ COMPLETE
                    └─► Plan 6: Audio Proxy (Desktop)   ✅ COMPLETE (pending real Roku)
                          └─► Plan 7: Audio Proxy (ESP32)   🔧 CODE COMPLETE (needs hardware)
Plan 8: Progressive Web App          ✅ COMPLETE (pending real device verification)
Plan 9: ESP32 Self-Hosted UI         ✅ COMPLETE (needs hardware)
```

Plans 1-2 can run in parallel. Plan 3 depends on 1. Each subsequent plan depends on the previous.

---

## ~~Plan 1: Project Scaffolding~~ ✅ COMPLETE

All truth statements verified. Angular app in `app/`, builds clean, accessible from phone browser.

---

## Plan 2: Infrastructure & Deployment

**Status:** Code complete — needs `cdk deploy` (from deploy device) and GitHub secrets configured.

**Satisfies:** Design — Technology Choices, Verification (works in PRs, works in production)

**Ancestors:** None (can run in parallel with Plan 1)

**Note:** Mixed-content/CORS resolved two ways: (1) CloudFront `ViewerProtocolPolicy.ALLOW_ALL` so HTTP access works, and (2) the desktop proxy returns `Access-Control-Allow-Private-Network: true` so HTTPS access also works (Chrome Private Network Access). Both HTTP and HTTPS work from roku.bluefin605.com → localhost proxy.

### Truth Statements

- [x] A CDK project (C#) exists in the repository under an `infra/` directory.
- [x] Running `cdk deploy` creates an S3 bucket configured for static website content.
- [x] Running `cdk deploy` creates a CloudFront distribution that serves from the S3 bucket.
- [x] The CloudFront distribution serves over HTTPS.
- [x] A GitHub Actions workflow exists that, on push to `main`: builds the Angular app, uploads to S3, and invalidates the CloudFront cache.
- [ ] After a push to `main`, the deployed site is accessible from a phone browser via the CloudFront URL.
- [x] The deployed site can make HTTP requests to the Roku on the local network (CORS/mixed-content resolved).

### Deployment Steps (manual, one-time)

1. Install CDK CLI: `npm install -g aws-cdk`
2. From deploy device: `cd infra && cdk deploy`
3. Note the outputs: `BucketName`, `DistributionId`, `DistributionDomainName`
4. In GitHub repo settings, add secrets: `AWS_ROLE_ARN`, `S3_BUCKET_NAME`, `CLOUDFRONT_DISTRIBUTION_ID`
5. Create an IAM OIDC provider for GitHub Actions and a role with S3/CloudFront permissions
6. Push to `main` — workflow deploys automatically

---

## ~~Plan 3: Connect & Setup~~ ✅ COMPLETE

All truth statements verified. Setup view with IP entry, Limited mode detection, localStorage persistence, auto-reconnect. Proxy URL configurable via collapsible "Proxy Settings" section (default: `http://roku-proxy.local` for ESP32 mDNS, with reset-to-default button).

---

## ~~Plan 4: Remote Control~~ ✅ COMPLETE

All truth statements verified. D-pad, playback, volume (hold-to-repeat), text input, disconnect banner. Apps button conditionally hidden when ECP is in limited mode. Needs real Roku to verify end-to-end.

---

## ~~Plan 5: App Launcher~~ ✅ COMPLETE

All truth statements verified. Responsive app grid (auto-fill columns based on screen width), icons, search/filter, tap to launch (stays on apps view), drag-to-reorder with localStorage persistence. App launcher is the default post-connect view when ECP is fully enabled; hidden when ECP is in limited mode. Needs real Roku to verify end-to-end.

---

## ~~Plan 6: Audio Proxy (Desktop)~~ ✅ COMPLETE (pending real Roku verification)

All code is implemented and tested against the mock Roku. Two truth statements require a real Roku device to verify.

**Satisfies:** Flow 3, North Star #8-10, Design — Phase 3 (desktop-first development)

**Ancestors:** Plan 5

### Truth Statements

- [x] A C++ project exists in the repository (`proxy/`) that compiles and runs on macOS.
- [x] The proxy connects to `ws://<roku-ip>:8060/ecp-session` with the required headers.
- [x] The proxy completes the auth challenge-response (verified against mock Roku with matching algorithm).
- [x] **VERIFIED AGAINST MOCK:** The mock Roku responds with `status: "200"` to the auth request. Needs real Roku to confirm firmware compatibility.
- [x] The proxy sends `set-audio-output` with its own `IP:6970`.
- [x] **VERIFIED AGAINST MOCK:** Mock Roku sends RTP Opus packets to the proxy. Needs real Roku to confirm actual audio.
- [x] The proxy serves an HTTP API: `POST /start?roku=<ip>`, `POST /stop`, `GET /status`, `GET /audio`.
- [x] The proxy serves an SSDP discovery endpoint: `GET /discover`.
- [x] The Angular app has a "Private Listening" button that starts/stops the proxy and auto-plays audio. Audio view reads the globally configured proxy URL (set on the setup page).
- [x] Browser Opus decoding implemented via `opus-decoder` npm package (Wasm). Streams from `/audio`, decodes frames, plays via Web Audio API with scheduled playback.
- [x] Discovery wired into setup view. When proxy is available, "Discover Roku Devices" button appears above manual IP entry.
- [x] Proxy returns `Access-Control-Allow-Private-Network: true` header for Chrome PNA compliance (public origin → localhost/local network).
- [ ] **NEEDS REAL ROKU:** Audio plays through the phone's speaker/headphones with acceptable quality.
- [x] Stopping private listening cleanly tears down WebSocket, RTP, and audio playback.

### Test Coverage

- **Mock Roku** (`mock/roku-mock.mjs`): Full ECP mock + WebSocket auth + mock RTP Opus streaming. Install `ws` dep: `cd mock && npm install`.
- **Unit tests** (43 passing): `cd app && npx ng test --watch=false --browsers=ChromeHeadless`
- **E2E tests** (25 passing): `cd app && npx playwright test`
- **Proxy integration**: Verified proxy ↔ mock Roku full flow (auth, set-audio-output, streaming, stop).

---

## Plan 7: Audio Proxy (ESP32)

**Status:** Code complete. Needs ESP-IDF build environment + real hardware to verify.

**Satisfies:** Flow 3, North Star #8-10, Design — Phase 3 (ESP32 deployment)

**Ancestors:** Plan 6

### Implementation

ESP-IDF project in `esp32/` with all proxy functionality ported:
- **Wi-Fi**: STA mode with auto-reconnect and backoff (`wifi_manager.cpp`)
- **Auth**: mbedtls SHA1 + base64 replacing OpenSSL (`roku_auth.cpp`)
- **RTP/RTCP**: lwIP sockets + FreeRTOS tasks replacing std::thread (`rtp_receiver.cpp`)
- **WebSocket**: esp_websocket_client replacing IXWebSocket (`roku_session.cpp`)
- **HTTP API**: esp_http_server replacing cpp-httplib, same endpoint contract (`http_server.cpp`)
- **SSDP**: lwIP multicast + esp_http_client replacing std::regex + httplib (`ssdp_discovery.cpp`)
- **Audio buffer**: FreeRTOS queue (100 frames) replacing std::deque + mutex (`audio_buffer.h`)
- **Config**: Kconfig menuconfig for Wi-Fi credentials, HTTP port, RTP port

Build: `cd esp32 && idf.py set-target esp32 && idf.py menuconfig && idf.py build`
Flash: `idf.py -p /dev/ttyUSB0 flash monitor`

### Truth Statements

- [ ] **NEEDS ESP-IDF:** The C++ proxy code compiles for ESP32 using ESP-IDF.
- [ ] **NEEDS HARDWARE:** The ESP32 firmware can be flashed and boots successfully.
- [ ] **NEEDS HARDWARE:** The ESP32 connects to Wi-Fi and obtains an IP address.
- [ ] **NEEDS HARDWARE:** All proxy HTTP API endpoints (`/discover`, `/start`, `/stop`, `/status`, `/audio`) respond correctly from the ESP32.
- [ ] **NEEDS HARDWARE:** The ESP32 successfully completes WebSocket auth with the Roku.
- [ ] **NEEDS HARDWARE:** The ESP32 receives RTP Opus packets and serves audio to the phone browser.
- [ ] **NEEDS HARDWARE:** Audio quality and latency are acceptable for watching TV.
- [ ] The Angular app works identically whether the proxy is the desktop version or the ESP32 — no code changes needed in the Angular app.
- [ ] **NEEDS HARDWARE:** The ESP32 recovers from Wi-Fi disconnections and can be restarted without manual intervention.

---

## ~~Plan 8: Progressive Web App (PWA)~~ ✅ COMPLETE (pending real device verification)

All code and configuration is in place. Uses `@angular/service-worker` (not `@angular/pwa` schematic) with equivalent functionality. Only real device testing remains.

**Satisfies:** North Star #11-13, Design — Phase 4 (PWA)

**Ancestors:** Plan 1

### Truth Statements

- [x] Running `ng add @angular/pwa` (or equivalent manual setup) has been applied to the Angular project. Used `@angular/service-worker` directly.
- [x] A `manifest.webmanifest` exists with app name, icons, `display: standalone`, and `orientation: portrait`.
- [x] App icons exist at 192x192 and 512x512 PNG sizes (plus 7 other sizes from 72–512px).
- [x] An Apple Touch Icon (180x180) exists and is linked in `index.html`.
- [x] `index.html` contains the required iOS meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`).
- [x] A service worker is registered that precaches the app shell and static assets (`ngsw-worker.js` via `provideServiceWorker` in `app.config.ts`).
- [x] The `ngsw-config.json` is configured to cache app shell, JS bundles, CSS, and icon assets.
- [ ] **NEEDS DEVICE:** On Android Chrome, visiting the deployed site offers an "Add to Home Screen" / install prompt.
- [ ] **NEEDS DEVICE:** On iOS Safari, using "Add to Home Screen" installs the app with the correct icon and name.
- [ ] **NEEDS DEVICE:** The installed app launches fullscreen (no browser address bar or navigation chrome).
- [x] The `theme_color` and `background_color` in the manifest match the app's visual design (`#1a1a2e`).
- [ ] **NEEDS DEVICE:** All existing functionality (remote, apps, audio) works identically in the installed PWA.

---

## ~~Plan 9: ESP32 Self-Hosted UI~~ ✅ COMPLETE (needs hardware verification)

All code and configuration is in place (commit 1b124e7 + follow-ups). Port changed from 8080 to 80. Only hardware flashing/testing remains.

**Satisfies:** North Star #11-13, Design — Phase 4 (PWA), resolves HTTPS mixed-content limitation

**Ancestors:** Plan 7, Plan 8

### Motivation

The CloudFront-hosted app is served over HTTPS, but the ESP32 proxy runs HTTP on the local network. Browsers block these mixed-content requests, and iOS forces HTTPS for PWAs added to the home screen. Serving the Angular app directly from the ESP32 makes everything same-origin over HTTP, eliminating mixed-content issues entirely.

### Approach

Embed the Angular production build (~270KB gzipped) directly in the ESP32 firmware binary. The ESP32 serves both the UI and API on port 80. No SPIFFS/LittleFS — files are compiled into the firmware for simplicity and atomic updates.

### Truth Statements

**API prefix migration:**
- [x] All ESP32 HTTP API routes are moved under an `/api/` prefix (`/api/discover`, `/api/start`, `/api/stop`, `/api/status`, `/api/audio`, `/api/roku/*`).
- [x] The Angular `ProxyService` and `RokuService` use `/api/` prefixed paths for all proxy requests (via `apiBase()` method).
- [x] When the app is served from the ESP32 (same-origin), the proxy URL defaults to empty string (relative paths).
- [x] When the app is served from CloudFront (cross-origin), the proxy URL remains configurable as before.

**Angular ESP32 build configuration:**
- [x] An `esp32` build configuration exists in `angular.json` that disables the service worker (service workers require HTTPS on non-localhost origins).
- [x] `ng build --configuration esp32` produces a production build without service worker files.
- [x] The `manifest.webmanifest` is still included (for "Add to Home Screen" on supported browsers).

**Build pipeline:**
- [x] A `prepare_web.sh` script exists that: builds Angular with the `esp32` configuration, gzips all text assets (JS, CSS, HTML, JSON, webmanifest, SVG), and generates a CMake include file listing all files to embed.
- [x] The ESP32 `CMakeLists.txt` embeds all prepared web files via `EMBED_FILES`.
- [x] The GitHub Actions `build-esp32` job builds Angular, runs `prepare_web.sh`, then builds the ESP32 firmware with embedded web files.

**Static file serving:**
- [x] The ESP32 HTTP server has a static file handler that serves embedded web assets with correct `Content-Type` headers.
- [x] Gzip-compressed files are served with `Content-Encoding: gzip` — the browser decompresses transparently.
- [x] Hashed filenames (JS/CSS with build hashes) are served with long-lived cache headers (`Cache-Control: public, max-age=31536000, immutable`).
- [x] `index.html` and `manifest.webmanifest` are served with `Cache-Control: no-cache`.
- [x] Any unrecognised path falls back to `index.html` (SPA routing support).

**Partition table:**
- [x] A custom partition table gives the factory app partition enough space for firmware + embedded web assets (~1.9MB on 4MB flash).
- [x] `sdkconfig.defaults` is updated to use the custom partition table.

**Verification:**
- [ ] **NEEDS HARDWARE:** Browsing to `http://<esp32-ip>/` loads the full Angular app served from the ESP32.
- [ ] **NEEDS HARDWARE:** All existing functionality (remote, apps, audio) works when served from the ESP32.
- [ ] **NEEDS HARDWARE:** The app can be added to the phone's home screen from `http://<esp32-ip>/` and launches fullscreen.
- [ ] The CloudFront-hosted version (`roku.bluefin605.com`) continues to work unchanged for users who configure a proxy URL manually.
