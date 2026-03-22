# Plans — RokuRemote

What's not true yet. Each plan is a set of truth statements that are deleted when they become true in the running system.

---

## Dependency Graph

```
Plan 1: Project Scaffolding          ✅ COMPLETE
  └─► Plan 2: Infrastructure & Deployment   ⬜ NOT STARTED
  └─► Plan 3: Connect & Setup              ✅ COMPLETE
        └─► Plan 4: Remote Control          ✅ COMPLETE
              └─► Plan 5: App Launcher      ✅ COMPLETE
                    └─► Plan 6: Audio Proxy (Desktop)   ✅ COMPLETE (pending real Roku)
                          └─► Plan 7: Audio Proxy (ESP32)   🔧 CODE COMPLETE (needs hardware)
```

Plans 1-2 can run in parallel. Plan 3 depends on 1. Each subsequent plan depends on the previous.

---

## ~~Plan 1: Project Scaffolding~~ ✅ COMPLETE

All truth statements verified. Angular app in `app/`, builds clean, accessible from phone browser.

---

## Plan 2: Infrastructure & Deployment

**Status:** Not started. Can be done at any time — not blocking development.

**Satisfies:** Design — Technology Choices, Verification (works in PRs, works in production)

**Ancestors:** None (can run in parallel with Plan 1)

**Note:** CORS/mixed-content issue needs to be addressed for production. The Angular app makes HTTP requests to the Roku on the local network. When served over HTTPS (CloudFront), browsers block these as mixed content. Options to investigate: serve over HTTP only, or use a service worker proxy approach.

### Truth Statements

- [ ] A CDK project (C#) exists in the repository under an `infra/` directory.
- [ ] Running `cdk deploy` creates an S3 bucket configured for static website content.
- [ ] Running `cdk deploy` creates a CloudFront distribution that serves from the S3 bucket.
- [ ] The CloudFront distribution serves over HTTPS.
- [ ] A GitHub Actions workflow exists that, on push to `main`: builds the Angular app, uploads to S3, and invalidates the CloudFront cache.
- [ ] After a push to `main`, the deployed site is accessible from a phone browser via the CloudFront URL.
- [ ] The deployed site can make HTTP requests to the Roku on the local network (CORS/mixed-content resolved).

---

## ~~Plan 3: Connect & Setup~~ ✅ COMPLETE

All truth statements verified. Setup view with IP entry, Limited mode detection, localStorage persistence, auto-reconnect.

---

## ~~Plan 4: Remote Control~~ ✅ COMPLETE

All truth statements verified. D-pad, playback, volume (hold-to-repeat), text input, disconnect banner. Needs real Roku to verify end-to-end.

---

## ~~Plan 5: App Launcher~~ ✅ COMPLETE

All truth statements verified. App grid with icons, search/filter, tap to launch, drag-to-reorder with localStorage persistence. Needs real Roku to verify end-to-end.

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
- [x] The Angular app has a "Private Listening" button that starts/stops the proxy and auto-plays audio.
- [x] Browser Opus decoding implemented via `opus-decoder` npm package (Wasm). Streams from `/audio`, decodes frames, plays via Web Audio API with scheduled playback.
- [x] Discovery wired into setup view. When proxy is available, "Discover Roku Devices" button appears above manual IP entry.
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
