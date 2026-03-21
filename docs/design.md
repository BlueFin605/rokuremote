# Design — RokuRemote

How it could be built. Contracts, architecture, verification. No implementation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    AWS (S3/CloudFront)           │
│              Hosts static Angular app            │
└──────────────────────┬──────────────────────────┘
                       │ HTTPS (serve UI)
                       ▼
┌─────────────────────────────────────────────────┐
│                  Phone (Browser)                 │
│                                                  │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Remote View  │  │ App Grid │  │ Audio View │  │
│  └──────┬──────┘  └────┬─────┘  └─────┬──────┘  │
│         │              │               │         │
│  ┌──────┴──────────────┴───────────────┴──────┐  │
│  │            Roku Service Layer              │  │
│  │  (HTTP client for ECP, WebSocket for auth) │  │
│  └──────────────────────┬─────────────────────┘  │
└─────────────────────────┼────────────────────────┘
                          │ HTTP/WS (local network)
                          ▼
                 ┌─────────────────┐
                 │   Roku Device   │
                 │   port 8060     │
                 └────────┬────────┘
                          │ RTP/UDP (audio)
                          ▼
                 ┌─────────────────┐
                 │  ESP32 Proxy    │  ◄── Phase 3 only
                 │  (local network)│
                 └────────┬────────┘
                          │ HTTP/WS (audio to phone)
                          ▼
                    Phone (Browser)
```

### Key Decision: Angular + Capacitor (later)

- **Phase 1 & 2**: Pure Angular web app, hosted on AWS, accessed via phone browser.
- **Phase 3 (Private Listening)**: Either add Capacitor for native UDP socket access, or use ESP32 as audio proxy so the browser can receive audio over HTTP/WebSocket.
- This means Core Control and App Launcher work in any browser with zero install. Private Listening is the only feature that may require additional infrastructure.

---

## Phase 1: Core Control

**Supports:** Flow 1, North Star #1-4, #11-16

### First-Run Setup & Connection (Flow 0)

- **Phase 1**: Manual IP entry. The user enters their Roku's IP once, it's saved in localStorage.
- **Phase 3**: ESP32 provides SSDP auto-discovery (see Phase 3 section). Manual IP entry remains as fallback.
- **Connection check**: On connect, attempt `GET /query/device-info`.
  - Success → Roku is reachable and ECP is enabled. Save IP, show remote.
  - "Limited mode" error → Show setup instructions: *Settings > System > Advanced System Settings > Control by Mobile Apps > Network Access > Enabled*. Offer "Try Again".
  - Timeout/unreachable → Show "Roku not found at this IP" with option to re-enter.
  - Tip for finding IP → Show: *On your Roku: Settings > Network > About*.
- **Persistence**: Save last-known Roku IP and device name in localStorage. On next open, try the saved IP first. If it fails, prompt for re-entry.

### Remote Control Interface

- **D-pad**: Up, Down, Left, Right, Select (OK) — arranged as a circular/cross pad.
- **Navigation**: Home, Back.
- **Playback**: Play/Pause, Rewind, Fast Forward, Instant Replay.
- **Volume**: Volume Up, Volume Down, Mute.
- **Power**: Power On, Power Off (or toggle).
- **Text input**: A text field that sends characters via `Lit_<char>` keypresses. Include a "Send" keyboard approach — type in the field, characters are sent as you type or on submit.
- **Each button** sends `POST http://<roku-ip>:8060/keypress/<Key>`.

### Command Throttling

- Minimum 50ms between consecutive keypress requests to avoid overwhelming the Roku.
- For held buttons (e.g., volume), use `keydown`/`keyup` with repeat at a safe interval.

### Contracts

| Endpoint | Method | Purpose |
|---|---|---|
| `/query/device-info` | GET | Verify connection, get device name/model/capabilities |
| `/keypress/<key>` | POST | Send button press |
| `/keydown/<key>` | POST | Start held button |
| `/keyup/<key>` | POST | Release held button |

### Failure Handling

- HTTP request to Roku fails → show "Roku unreachable" banner, offer re-entry of IP.
- Timeout on any ECP request → 3 second timeout, then show disconnected state.

---

## Phase 2: App Launcher

**Supports:** Flow 2, North Star #5-7

### App List

- `GET /query/apps` returns XML list of installed channels.
- Parse XML → array of `{ id, name, version }`.
- For each app, fetch icon: `GET /query/icon/<appId>` → binary image (check `Content-Type` header for format).
- **Caching**: Store app list and icons in localStorage/IndexedDB. Refresh on pull-to-refresh or on a "refresh" button. Icons rarely change — cache aggressively.

### App Grid UI

- Grid of tiles, each showing the app icon and name.
- Tap a tile → `POST /launch/<appId>`.
- Search/filter bar at the top for quick lookup when the list is long.
- Default sort: alphabetical by name (since ECP doesn't provide home screen order).
- Optional: let the user reorder/favourite apps, persisted in localStorage.

### Contracts

| Endpoint | Method | Purpose |
|---|---|---|
| `/query/apps` | GET | List installed channels |
| `/query/icon/<appId>` | GET | Fetch channel icon image |
| `/launch/<appId>` | POST | Launch channel |
| `/query/active-app` | GET | Show which app is currently running (highlight in grid) |

---

## Phase 3: Private Listening + ESP32 Network Helper

**Supports:** Flow 1 (discovery), Flow 3, North Star #3, #8-10, #14

### Architecture Decision: ESP32 as Local Network Helper

The ESP32 serves two roles in Phase 3:

1. **SSDP device discovery** — finds Rokus on the network so the user doesn't need to enter an IP manually.
2. **Audio proxy** — receives RTP audio from the Roku and re-serves it to the phone browser.

**Chosen path: ESP32 as local network helper.** Rationale:

| Option | Pros | Cons |
|---|---|---|
| **Phone receives RTP directly** | No extra hardware | Requires Capacitor + native UDP plugin. Not available in browser. Adds mobile app build complexity for Phase 1 & 2 which don't need it. |
| **ESP32 proxy** | Works with browser-only approach. Keeps Phase 1 & 2 simple. User already has ESP32. | Extra hardware on the network. ESP32 firmware to build/maintain. |

The ESP32 proxy preserves the "works in a browser" principle for all phases. The phone never needs native UDP — the ESP32 handles RTP and re-serves audio over a protocol the browser can consume (HTTP streaming or WebSocket).

### ESP32 Responsibilities

1. **SSDP discovery** — send M-SEARCH to 239.255.255.250:1900 with `ST: roku:ecp`, collect responses, expose found devices via HTTP API.
2. **WebSocket signaling** — connect to `ws://<roku-ip>:8060/ecp-session`, perform auth challenge-response, send `set-audio-output` with its own IP:port.
3. **RTP reception** — listen on UDP port 6970 for Opus RTP packets from the Roku.
4. **Audio re-serving** — serve decoded audio (or raw Opus frames) to the phone over HTTP or WebSocket. The phone decodes and plays via Web Audio API or `<audio>` element.
5. **Lifecycle** — start/stop listening on command from the phone.

### Phone-to-ESP32 Contract

The phone tells the ESP32 what to do via a simple HTTP API on the ESP32:

| Endpoint | Method | Purpose |
|---|---|---|
| `/discover` | GET | ESP32 runs SSDP discovery, returns JSON array of found Roku devices `[{ ip, name, model }]` |
| `/start?roku=<ip>` | POST | ESP32 initiates private listening session with the specified Roku |
| `/stop` | POST | ESP32 tears down the session |
| `/status` | GET | Returns current state (idle, connecting, streaming, error) |
| `/audio` | GET (streaming) | Audio stream for the phone to play (HTTP chunked or WebSocket upgrade) |

### Auth Protocol (from RPListening source)

1. Connect WebSocket to `ws://<roku-ip>:8060/ecp-session` with headers: `Sec-WebSocket-Origin: Android`, `Sec-WebSocket-Protocol: ecp-2`.
2. Receive JSON `{ notify: "authenticate", param-challenge: "<value>" }`.
3. Compute: `SHA1(challenge + transform("95E610D0-7C29-44EF-FB0F-97F1FCE4C297", shift=9))` → Base64.
4. Send JSON `{ request: "authenticate", "request-id": "0", "param-response": "<hash>" }`.
5. Receive `{ response: "authenticate", status: "200", "status-msg": "OK" }`.
6. Send `set-audio-output` with ESP32's `IP:6970`.
7. RTP Opus/48kHz/stereo packets arrive on UDP 6970.

### Audio Playback on Phone

- ESP32 serves audio over HTTP (chunked transfer) or WebSocket.
- Phone uses Web Audio API with an Opus decoder (e.g., another-libopus.js Wasm decoder, as proven by the existing ESP32 project) or decodes on ESP32 and serves PCM.
- Trade-off: decoding on ESP32 (CPU-intensive, may need ESP32-S3) vs. decoding in browser (well-supported, offloads ESP32).

### Failure Handling

- Roku doesn't support private listening → Phase 1 already knows this from `device-info`. Hide the button.
- Auth fails → show error, suggest firmware may have changed the protocol.
- ESP32 unreachable → show "Audio proxy not found" with setup instructions.
- Stream drops → ESP32 reports status change, phone shows reconnect option.

---

## Verification

### How do I know it works on my machine?

**Phase 1 & 2 (Angular app):**
- Angular dev server (`ng serve`) running on laptop.
- Open on phone browser (same Wi-Fi) via laptop's local IP.
- Real Roku on the same network — press buttons, see TV respond.

**Phase 3 (Audio proxy) — Desktop-first development:**

The ESP32's responsibilities (SSDP, WebSocket, RTP, HTTP serving) are all standard networking — nothing is ESP32-specific until final deployment. Development follows two stages:

1. **Develop and test as a desktop app first** (Mac or Windows):
   - Write the proxy logic in C++ (user's expertise, and also the ESP32's language).
   - Run on laptop as a command-line application on the same Wi-Fi as the Roku.
   - The laptop acts as the proxy — receives RTP audio from Roku, serves to phone browser.
   - Fast iteration: edit → compile → run → test. No flashing.
   - All protocol work happens here: WebSocket auth, RTP reception, Opus forwarding, HTTP serving.
   - Use platform-abstracted libraries (e.g., standard sockets, libwebsockets, or similar) that work on both desktop and ESP32.

2. **Port to ESP32 when the protocol works:**
   - Replace platform-specific socket calls with ESP-IDF equivalents.
   - Flash to ESP32, test on the real hardware.
   - Only hardware-specific concerns remain: memory constraints, Wi-Fi stability, flash size.

This means Phase 3 development doesn't require an ESP32 until the final stage. The slow flash-reboot cycle is only needed for hardware integration, not protocol debugging.

### How do I know it works in PRs?

- **Unit tests**: Roku service layer — mock HTTP responses, verify correct ECP URLs and payloads are constructed.
- **Unit tests**: App list parsing — given known XML, verify correct model output.
- **Unit tests**: Auth protocol — given a known challenge, verify correct SHA-1 response.
- **E2E tests**: Not practical against a real Roku in CI. Use a mock ECP server (simple HTTP server returning canned XML responses) to verify the UI flow: discover → connect → show remote → press button → verify HTTP call.
- **Lint + build**: Angular build must succeed, no TypeScript errors.

### How do I know it works in production?

- **Infrastructure (CDK)**: AWS infrastructure defined in CDK (C#), run manually to provision/update. Creates S3 bucket, CloudFront distribution, OAI/OAC, Route53 records (if custom domain), and any required IAM roles.
- **Deployment (GitHub Actions)**: On push to main, GitHub Actions runs `ng build`, uploads to S3, and invalidates the CloudFront cache. No manual deployment steps after initial CDK setup.
- **Monitoring**: CloudFront access logs for basic usage. No backend to monitor.
- **The real test**: Open on phone, control the Roku, launch apps, listen to audio. This is a personal tool — production monitoring is "does it work when I use it."

---

## Technology Choices

| Concern | Choice | Why |
|---|---|---|
| Framework | Angular | User's existing expertise |
| Language | TypeScript | User's existing expertise |
| Hosting | AWS S3 + CloudFront | User has AWS account, static site is simplest deployment |
| Infrastructure as Code | AWS CDK (C#) | User's C# expertise, CDK is AWS-native, run manually to provision |
| CI/CD | GitHub Actions | Deploys static site to S3 on push to main, invalidates CloudFront |
| HTTP Client | Angular HttpClient | Built-in, handles the simple REST calls to ECP |
| XML Parsing | DOMParser (browser built-in) | ECP responses are XML, no library needed |
| Audio Proxy | C++ (desktop-first, then ESP32) | User's C++ expertise. Develop/test on Mac/Windows with fast iteration, port to ESP32 for deployment. |
| Mobile App (future) | Capacitor | If ever needed — wraps the same Angular app as native |

---

## Trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Discovery (Phase 1) | Manual IP entry | SSDP auto-discovery | SSDP needs UDP which browsers can't do. Manual entry works, keeps Phase 1 zero-dependency. |
| Discovery (Phase 3) | ESP32 SSDP + manual fallback | Manual only | ESP32 is already on the network for audio. Adding discovery is low effort and improves UX. Manual IP remains as fallback. |
| Audio proxy | ESP32 | Phone-native via Capacitor | Keeps all phases browser-only. User has ESP32. Avoids mobile build toolchain for Phase 1 & 2. |
| Audio decode location | Browser (Wasm Opus decoder) | ESP32 decodes to PCM | Offloads CPU from ESP32, proven approach (existing project uses this). |
| App grid order | Alphabetical + user favourites | Mimic Roku home screen order | ECP doesn't expose home screen order. |
