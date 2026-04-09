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
Plan 10: TV Protocol Handler (Proxy)
  └─► Plan 11: TV Control UI (Angular)
        └─► Plan 12: TV Pairing (Proxy + Angular)
```

Plans 1-2 can run in parallel. Plan 3 depends on 1. Each subsequent plan depends on the previous. Plans 10-12 can begin independently of Plans 7-9 (hardware-pending).

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

All truth statements verified. Setup view with IP entry, Limited mode detection, localStorage persistence, auto-reconnect. Proxy URL configurable via collapsible "Proxy Settings" section (preferred: `http://roku-proxy/`, fallback: `http://roku-proxy.local/`, with reset-to-default button).

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

Build: `cd esp32 && idf.py set-target esp32s3 && idf.py menuconfig && idf.py build`
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

---

## Plan 10: TV Protocol Handler (Proxy)

**Satisfies:** Design — Phase 6 (TV Control), Flow TV-Control B (command routing, proxy side), Flow TV-Control C (extensibility)

**Ancestors:** Plan 4 (proxy exists and serves `/api/roku/*` endpoints)

### Scope

**Covers:**
- `TvHandler` abstract base class with factory method
- `PanasonicHandler` implementing unencrypted Viera SOAP commands
- SOAP envelope construction for both NRC and DMR endpoints
- Proxy HTTP endpoints: `/api/tv/keypress/<action>`, `/api/tv/volume`, `/api/tv/discover`
- Panasonic SSDP discovery (`urn:panasonic-com:service:p00NetworkControl:1`)
- Desktop proxy implementation
- ESP32 proxy implementation (same interface, ESP-IDF HTTP client)

**Does not cover:**
- 2018+ encryption and pairing (Plan 12: TV Pairing)
- Angular app changes (Plan 11: TV Control UI)
- Other TV brands (future plans, same `TvHandler` pattern)

### Enables

Once this exists:
- **Plan 11** can proceed — the proxy endpoints are available for the Angular app to call
- Unencrypted Panasonic TVs (pre-2018) can be controlled end-to-end once Plan 11 is also complete
- The `TvHandler` abstraction is in place for future TV brands — adding one means implementing a new subclass

### Prerequisites

- Desktop proxy compiles and runs (Plan 4, complete)
- ESP32 firmware compiles (Plan 7, code complete)
- Panasonic TV on the same network for manual testing (or mock SOAP server)

### North Star

Send a generic TV command from an HTTP request and have the proxy translate it into the correct SOAP call, transparently. The caller never sees SOAP, NRC codes, or URNs.

### Done Criteria

#### TvHandler Abstraction
- The proxy shall define a `TvHandler` abstract base class with methods: `sendKey`, `getVolume`, `discover`
- The proxy shall provide a `TvHandler::create(type)` factory that returns the correct handler for the given TV type
- When an unsupported TV type is requested, the factory shall return an error (not crash)

#### Panasonic SOAP Implementation
- The `PanasonicHandler` shall construct valid SOAP envelopes with the correct URN for each endpoint
  - NRC endpoint: `urn:panasonic-com:service:p00NetworkControl:1` at `/nrc/control_0`
  - DMR endpoint: `urn:schemas-upnp-org:service:RenderingControl:1` at `/dmr/control_0`
- The `PanasonicHandler` shall send SOAP requests to the TV on port 55000 with `Content-Type: text/xml; charset="utf-8"` and the correct `SOAPAction` header
- When `sendKey` is called with a generic action, the handler shall map it to the correct NRC key code:

  | Action | NRC Code |
  |---|---|
  | `volume_up` | `NRC_VOLUP-ONOFF` |
  | `volume_down` | `NRC_VOLDOWN-ONOFF` |
  | `mute` | `NRC_MUTE-ONOFF` |
  | `power` | `NRC_POWER-ONOFF` |
  | `hdmi1` | `NRC_HDMI1-ONOFF` |
  | `hdmi2` | `NRC_HDMI2-ONOFF` |
  | `hdmi3` | `NRC_HDMI3-ONOFF` |
  | `hdmi4` | `NRC_HDMI4-ONOFF` |

- When `getVolume` is called, the handler shall send a `GetVolume` request to the DMR endpoint and return the current level (0-100)
- If the TV is unreachable or returns an error, the handler shall return an error status (not crash or hang)

#### Proxy HTTP Endpoints
- The proxy shall expose `POST /api/tv/keypress/<action>?ip=<ip>&type=<type>` that delegates to the appropriate `TvHandler`
- The proxy shall expose `GET /api/tv/volume?ip=<ip>&type=<type>` that returns JSON `{"volume": <0-100>}`
- The proxy shall expose `GET /api/tv/discover?type=panasonic` that returns JSON `[{"ip":"...","name":"..."}]`
- All TV endpoints shall include CORS headers (same as existing Roku endpoints)
- When the `ip` or `type` parameter is missing, the proxy shall return 400 with a JSON error message
- When the TV is unreachable, the proxy shall return 502 with a JSON error message (same pattern as Roku)

#### SSDP Discovery
- When `type=panasonic`, the discovery shall send an SSDP M-SEARCH with `ST: urn:panasonic-com:service:p00NetworkControl:1`
- The discovery shall extract the TV's IP from the SSDP `LOCATION` header response
- The discovery shall attempt to fetch device info from the TV to populate the device name

#### ESP32 Parity
- The ESP32 firmware shall expose the same `/api/tv/*` endpoints with the same contract as the desktop proxy
- The ESP32 `PanasonicHandler` shall use `esp_http_client` for SOAP requests (replacing `httplib`)

### Constraints

- **No pairing/encryption** — this plan handles unencrypted SOAP only. Pairing is Plan 12.
- **Keypress approach for volume** — use `X_SendKey` with NRC codes, not `SetVolume` on the DMR endpoint. Design decision: simpler, works on all models. `GetVolume` on DMR is read-only for status.
- **3-second timeout** on all SOAP requests — same as Roku ECP timeout.

### References

- [Design — Phase 6: TV Control](design.md) — architecture, contracts, protocol translation table
- [Findings — Panasonic TV APIs](findings-panasonic.md) — SOAP format, NRC key codes, endpoint URNs
- [florianholzapfel/panasonic-viera](https://github.com/florianholzapfel/panasonic-viera) — Python reference implementation
- [cpp-httplib](https://github.com/yhirose/cpp-httplib) — HTTP client used in desktop proxy (for SOAP requests)

### Error Policy

TV errors should not affect Roku control. When a TV command fails:
1. Return the error to the caller (HTTP 502 or 504)
2. Do not retry automatically — let the app decide
3. Log the error for debugging (desktop: stdout, ESP32: `ESP_LOGE`)

---

## Plan 11: TV Control UI (Angular)

**Satisfies:** Design — Phase 6 (Angular App Changes), Flow TV-Control A (setup), Flow TV-Control B (command routing, app side), North Star #5-10, #23

**Ancestors:** Plan 10 (proxy TV endpoints must exist)

### Scope

**Covers:**
- `TvService` with independent command queue
- Command routing in `RemoteComponent` (TV vs. Roku)
- Volume/mute press-and-hold dispatching to TV when configured
- Power button routing to TV when configured
- HDMI input buttons (visible only when TV configured)
- TV settings section on the setup page (type dropdown, IP entry, connection test)
- TV discovery via proxy SSDP

**Does not cover:**
- Proxy-side protocol handling (Plan 10)
- Pairing UI for 2018+ models (Plan 12)
- Volume slider or level indicator (future enhancement using `GET /api/tv/volume`)

### Enables

Once this exists:
- End-to-end TV control works for pre-2018 Panasonic TVs (with Plan 10)
- **Plan 12** can add pairing UI to the setup page
- Users without a TV configured see no changes — existing remote works identically

### Prerequisites

- Plan 10 complete — proxy serves `/api/tv/*` endpoints
- Existing `RemoteComponent`, `RokuService`, and setup page (Plans 3-4, complete)

### North Star

Press volume on the phone, TV volume changes. Press power, TV turns on/off. No extra screens, no mode switches, no configuration visible during normal use. If no TV is configured, the remote works exactly as before.

### Done Criteria

#### TvService
- The `TvService` shall store TV type and IP in localStorage (keys: `tv-type`, `tv-ip`)
- The `TvService` shall expose a `configured` property that returns `true` when both type and IP are saved
- The `TvService` shall have its own command queue, independent of `RokuService`'s queue
  - TV commands shall not block or delay Roku commands
- The `TvService` shall throttle commands at 60ms intervals (same as `RokuService`)
- The `TvService` shall construct URLs as `${base}/tv/keypress/${action}?ip=${tvIp}&type=${tvType}`
- When a TV command fails, the `TvService` shall emit on a `connectionError$` observable (same pattern as `RokuService`)

#### Command Routing
- When a TV is configured, the `RemoteComponent` shall route volume up/down to `TvService.command('volume_up'/'volume_down')`
- When a TV is configured, the `RemoteComponent` shall route mute to `TvService.command('mute')`
- When a TV is configured, the `RemoteComponent` shall route power to `TvService.command('power')`
- When no TV is configured, volume/mute/power shall route to `RokuService.keypress()` as before (fallback)
- D-pad, playback, apps, and text input shall always route to `RokuService` regardless of TV configuration

#### Volume Press-and-Hold
- The existing `startVolumeRepeat` / `stopVolumeRepeat` pattern shall dispatch to `TvService` when a TV is configured
- The repeat interval shall remain 150ms (same as current Roku volume repeat)

#### HDMI Input Buttons
- When a TV is configured, the remote shall show an input row with buttons: HDMI 1, HDMI 2, HDMI 3, HDMI 4
- Each HDMI button shall call `TvService.command('hdmi1')` through `TvService.command('hdmi4')`
- When no TV is configured, the HDMI input row shall be hidden

#### Setup Page — TV Settings
- The setup page shall include a collapsible "TV Settings" section (same pattern as "Proxy Settings")
- The TV Settings section shall contain a TV type dropdown with options: "None", "Panasonic Viera"
- When a type other than "None" is selected, a TV IP text field shall appear
- The setup page shall include a "Discover" button that calls `GET /api/tv/discover?type=<type>` via the proxy
  - When TVs are found, show a selectable list (same pattern as Roku discovery)
- When the user saves TV settings, the app shall test the connection by calling `GET /api/tv/volume?ip=<ip>&type=<type>`
  - If the TV responds: show success, save settings
  - If the TV returns an auth error: show "This TV requires pairing" with guidance (pairing UI added in Plan 12)
  - If the TV is unreachable: show "TV not found at this IP"
- When TV type is set to "None", the app shall clear TV settings from localStorage

#### Failure Handling
- When a TV command fails, the remote shall show a brief error indicator (not a modal or navigation)
- While the TV is unreachable, Roku control shall continue working without interruption
- If no TV is configured and the user has never opened TV settings, no TV-related UI shall be visible on the remote view (except the HDMI row being absent)

### Constraints

- **No pairing UI** — connection test detects when pairing is needed but only shows a message. The actual pairing flow is Plan 12.
- **Same remote layout** — HDMI buttons are additive. Existing button positions don't change. Volume/mute/power buttons stay in the same place, only their routing changes.
- **localStorage only** — TV settings stored client-side, same as Roku IP and proxy URL. No server-side state.

### References

- [Design — Phase 6: Angular App Changes](design.md) — TvService spec, routing table, setup page changes
- [Flow — TV Control](flow-tv-control.md) — Flow A (setup), Flow B (routing)
- Existing patterns: `RokuService` (command queue), `ProxyService` (URL construction), setup page (collapsible sections)

### Error Policy

TV errors are transient indicators, not blocking modals. The remote stays usable. Specific handling:
- TV unreachable → brief visual indicator on the button that was pressed (fade after 2 seconds)
- Connection test fails during setup → inline error message with retry option
- Roku control is never blocked by a TV error

---

## Plan 12: TV Pairing (Proxy + Angular)

**Satisfies:** Design — Phase 6 (Encryption & Pairing), Flow TV-Control A (pairing stages), North Star #9

**Ancestors:** Plan 10 (PanasonicHandler exists), Plan 11 (setup page TV Settings section exists)

### Scope

**Covers:**
- Proxy: AES-128-CBC encryption with HMAC-SHA256 for Panasonic 2018+ models
- Proxy: Pairing endpoints (`/api/tv/pair/start`, `/api/tv/pair/finish`, `/api/tv/pair/status`)
- Proxy: Key derivation from challenge IV
- Proxy: Credential persistence (desktop: JSON file, ESP32: NVS)
- Proxy: Transparent encryption of SOAP commands after pairing
- Angular: Pairing flow UI on the setup page (PIN entry, status indicators)
- ESP32: Same pairing implementation using mbedtls

**Does not cover:**
- Basic SOAP commands (Plan 10)
- TV routing UI (Plan 11)
- Other TV brands' auth mechanisms (future plans)

### Enables

Once this exists:
- 2018+ Panasonic TVs are fully supported — pairing is one-time, then commands work transparently
- The user doesn't need to know whether their TV requires pairing — the system detects and guides them
- Credential persistence means the TV stays paired across proxy restarts

### Prerequisites

- Plan 10 complete — `PanasonicHandler` sends unencrypted SOAP requests
- Plan 11 complete — setup page has TV Settings section with connection test
- A 2018+ Panasonic TV on the network for manual testing (or a mock that simulates the auth handshake)

### North Star

Pairing is a one-time event the user barely remembers. They enter a PIN once, and the TV just works from then on. If something goes wrong, re-pairing is the same simple flow.

### Done Criteria

#### Proxy Pairing Endpoints
- The proxy shall expose `GET /api/tv/pair/status?ip=<ip>&type=panasonic` that returns `{"paired": bool, "required": bool}`
  - When the TV accepts unencrypted commands: `{"paired": false, "required": false}`
  - When the TV rejects unencrypted commands and no credentials are stored: `{"paired": false, "required": true}`
  - When stored credentials exist for this TV IP: `{"paired": true, "required": true}`
- The proxy shall expose `POST /api/tv/pair/start?ip=<ip>&type=panasonic` that:
  - Sends `X_DisplayPinCode` to the TV via SOAP
  - Stores the returned challenge IV
  - Returns `{"status": "waiting_for_pin"}` on success
  - Returns an error if the TV is unreachable or doesn't support pairing
- The proxy shall expose `POST /api/tv/pair/finish?ip=<ip>&type=panasonic` with body `{"pin": "1234"}` that:
  - Derives AES-128-CBC encryption keys from the stored challenge IV
  - Encrypts the PIN and sends `X_RequestAuth` to the TV
  - On success: stores session credentials persistently, returns `{"paired": true}`
  - On failure (wrong PIN): returns `{"paired": false, "error": "PIN rejected"}`

#### Encryption
- When credentials exist for a TV IP, the `PanasonicHandler` shall encrypt all SOAP request bodies using AES-128-CBC
- When credentials exist, the `PanasonicHandler` shall sign all SOAP requests with HMAC-SHA256
- If an encrypted command fails with an auth error, the handler shall clear stored credentials and report `paired: false`

#### Key Derivation
- The `PanasonicHandler` shall derive AES encryption keys from the challenge IV using the algorithm documented in the florianholzapfel/panasonic-viera and node-panasonic-viera libraries
- The key derivation shall produce the same output as the reference Python implementation given the same IV input

#### Credential Persistence
- The desktop proxy shall store pairing credentials in `~/.roku-proxy/tv_config.json`
  - The file shall contain: TV IP, session key, HMAC key, session ID
  - If the file does not exist, the proxy shall create it on first successful pairing
- The ESP32 shall store pairing credentials in NVS (Non-Volatile Storage)
  - The credentials shall persist across reboots and power cycles
  - Erasing NVS (same procedure as erasing Wi-Fi credentials) shall clear pairing

#### Angular Pairing UI
- When the setup page connection test detects a TV that requires pairing, the app shall show a "Pair with TV" button
- When the user taps "Pair with TV", the app shall call `POST /api/tv/pair/start` and show "Enter the PIN displayed on your TV" with a PIN input field
- When the user submits the PIN, the app shall call `POST /api/tv/pair/finish` with the PIN
  - On success: show "Paired successfully", save TV settings, connection test passes
  - On failure: show "Pairing failed — check the PIN and try again" with a retry option
- The setup page shall show pairing status next to the TV IP: "Paired", "Pairing required", or "No pairing needed"
- When a previously paired TV becomes unpaired (credentials lost or expired), the setup page connection test shall detect this and re-show the pairing flow

#### ESP32 Parity
- The ESP32 shall implement the same AES-128-CBC encryption using mbedtls (already available in ESP-IDF)
- The ESP32 shall implement HMAC-SHA256 using mbedtls
- The ESP32 pairing endpoints shall produce identical HTTP responses to the desktop proxy

### Constraints

- **Key derivation must match reference** — the exact bitwise operations from the Python/Node.js libraries. No room for creativity here; wrong derivation = pairing fails silently.
- **Credentials are proxy-side only** — the phone never sees encryption keys. Pairing state is queried via `pair/status`.
- **One TV at a time** — credentials are stored per TV IP. If the user changes TV IP, old credentials remain (harmless) and new pairing is needed.

### References

- [Design — Phase 6: Encryption & Pairing](design.md) — sequence diagram, credential storage, auto-detect flow
- [Findings — Panasonic: Encryption section](findings-panasonic.md) — AES-128-CBC, HMAC-SHA256, challenge-response protocol
- [florianholzapfel/panasonic-viera](https://github.com/florianholzapfel/panasonic-viera) — Python reference for key derivation algorithm (see `remote_control.py`)
- [jens-maus/node-panasonic-viera](https://github.com/jens-maus/node-panasonic-viera) — Node.js reference for encrypted session handling
- [mbedtls AES-CBC](https://mbed-tls.readthedocs.io/) — ESP32 crypto library (bundled with ESP-IDF)

### Error Policy

Pairing errors should be clear and recoverable:
- Wrong PIN → tell the user, let them retry (no lockout on our side; TV may lock out after repeated failures)
- TV unreachable during pairing → "TV not found", offer retry
- Stored credentials rejected → clear credentials, prompt to re-pair
- Encryption failure (code bug) → log detailed error, return 500 to the app
