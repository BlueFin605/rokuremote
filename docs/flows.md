# Flows — RokuRemote

Processes that must exist to make the north star real. Actors, stages, failure modes. No architecture or implementation.

---

## Flow 0: First-Time Setup

**Supports:** All phases — ECP must be enabled and a proxy must be reachable before anything works.

### Actors
- **User** — has physical access to the Roku and its TV
- **Phone** — running the remote UI
- **Proxy** — local network helper (desktop C++ app or ESP32) that forwards ECP requests with CORS headers and handles SSDP/audio
- **Roku** — may be in Limited mode (default since OS 14.1)

### Happy Path

1. User starts the proxy (desktop app or ESP32) on the same network as the Roku.
2. User opens the remote in their phone's browser.
3. The remote uses the configured proxy URL (prefer `http://roku-proxy/`, then `http://roku-proxy.local/`, then device IP). The proxy URL is saved in localStorage and configurable via a collapsible "Proxy Settings" section on the setup page.
4. If the proxy is reachable, the user can discover Roku devices automatically via the "Discover" button (SSDP via proxy). Otherwise, the user enters the Roku's IP manually.
5. The remote attempts `GET /query/device-info` (via the proxy) on the entered/discovered IP.
6. **If it succeeds**: Roku is reachable and ECP is enabled. Save IP. If ECP is fully enabled, proceed to app launcher view. If ECP is in limited mode, proceed to remote view (apps view is hidden).
7. **If it fails with "Limited mode" error**: Show clear instructions to the user:
   - "Your Roku has External Control set to Limited. To use this remote:"
   - On your TV: **Settings > System > Advanced System Settings > Control by Mobile Apps > Network Access > Enabled**
   - Include a "Try Again" button.
8. **If it fails with timeout/unreachable**: Show "Roku not found at this IP" with option to re-enter.
9. Once connected, the remote remembers both the proxy URL and Roku IP for next time.

### Why This Flow Exists

Since Roku OS 14.1, ECP defaults to Limited mode. Every third-party remote (Home Assistant, Roam, etc.) hit this. The official Roku app requires the same setting change. Users need clear guidance on first run — otherwise the remote appears broken.

### Failure Modes

| What Goes Wrong | What Should Happen |
|---|---|
| User enters wrong IP | Timeout → "Roku not found" → re-enter |
| Roku is in Limited mode | Detect the specific error, show step-by-step instructions to enable |
| Roku has External Control fully disabled | Same guidance but different setting path |
| User doesn't know their Roku's IP | Show instructions: "On your Roku TV: Settings > Network > About" |
| Proxy is not running or unreachable | Show "Proxy not found" with instructions to start the desktop proxy or ESP32 |
| Roku firmware is very old (pre-ECP access control) | ECP works without any setting change — no issue |

---

## Flow 1: Connect & Control

**Supports:** North Star #1-4, #14-16

### Actors
- **User** — person on the couch with their phone
- **Phone** — running the remote UI in a browser
- **Roku** — the streaming device on the local network

### Happy Path

1. User opens the remote in their phone's browser.
2. The remote discovers the Roku on the local network.
3. If multiple Roku devices are found, the user picks one.
4. The remote confirms the connection by retrieving device info (model, name).
5. The user sees a remote interface with directional pad, playback controls, volume, power, and a text input option.
6. User presses a button. The Roku responds. The TV reflects the action.
7. The connection persists across the session — the user doesn't re-discover for every press.

### Failure Modes

| What Goes Wrong | What Should Happen |
|---|---|
| No Roku found on the network | Show "No Roku found" with option to enter IP manually |
| Multiple Rokus found | Show a list with device names, let user pick |
| Roku becomes unreachable mid-session (powered off, network change) | Show a disconnected state, attempt to reconnect, offer re-discovery |
| User's phone is on a different network than the Roku | Explain that the phone and Roku must be on the same Wi-Fi |
| SSDP discovery is blocked by the network (AP isolation, etc.) | Fall back to manual IP entry |
| Roku IP changes between sessions | Re-discover automatically on next open, or re-resolve saved device |
| Commands sent too rapidly | Throttle to avoid overwhelming the Roku (~50-100ms spacing) |

---

## Flow 2: App Launcher

**Supports:** North Star #5-7

### Actors
- **User**, **Phone**, **Roku** (same as Flow 1)

### Precondition
- Flow 1 has completed — the remote is connected to a Roku.

### Happy Path

1. After connecting, the user lands on the app launcher view (the default view when ECP is fully enabled).
2. The remote fetches the list of installed apps and their icons from the Roku.
3. Apps are displayed as a responsive grid of tiles with icons and names (auto-fills columns based on screen width).
4. User taps an app tile.
5. The Roku launches that app. The TV switches to it.
6. The app is highlighted as active in the grid. The user stays on the app launcher view.

### Failure Modes

| What Goes Wrong | What Should Happen |
|---|---|
| App list request fails (Roku unreachable) | Show error, offer retry, fall back to last cached list if available |
| An app icon fails to load | Show placeholder with app name |
| User taps an app that has been uninstalled since the list was fetched | Show an error, refresh the app list |
| App list is very long | Provide search/filter or scrollable grid |
| App launch command succeeds but app crashes on Roku | Not detectable via ECP — outside our control |

---

## Flow 3: Private Listening

**Supports:** North Star #8-10

### Actors
- **User**, **Phone**, **Roku** (same as Flow 1)
- **Proxy** — local network helper (desktop C++ app or ESP32) that receives RTP audio and serves it to the phone browser

### Precondition
- Flow 0 has completed — the proxy is running and the remote is connected to a Roku.
- The Roku supports private listening (`supports-private-listening` = true in device info).

### Happy Path

1. User navigates to the Audio view (proxy URL is already configured on the setup page).
2. User taps "Start Listening".
3. The phone tells the proxy to start a private listening session with the Roku (`POST /start?roku=<ip>`).
4. The proxy authenticates with the Roku via WebSocket on `/ecp-session`.
5. The proxy tells the Roku to send audio to its own IP:port.
6. The Roku begins streaming Opus audio via RTP to the proxy.
7. The phone fetches the audio stream from the proxy (`GET /audio`), decodes Opus frames in the browser, and plays via Web Audio API.
8. User hears the TV audio in their headphones with acceptable lip-sync. User can adjust latency via the slider.
9. User taps "Stop Listening". The proxy tears down the session. Audio stops, Roku resumes normal audio output.

### Decision: Proxy Receives the RTP Stream

The proxy (desktop C++ app or ESP32) receives RTP audio from the Roku and re-serves raw Opus frames to the phone over HTTP chunked transfer. The phone decodes Opus in the browser using a Wasm decoder (`opus-decoder`) and plays via Web Audio API. This preserves the "works in a browser" principle — no native app or Capacitor needed.

### Latency Control

The user can adjust audio latency via a slider (50–500ms, default 150ms). This controls the jitter buffer depth — lower values reduce delay but may cause audio dropouts on unstable networks, higher values add delay but smooth out jitter.

### Failure Modes

| What Goes Wrong | What Should Happen |
|---|---|
| Roku doesn't support private listening | Hide or disable the button, show explanation |
| WebSocket authentication fails | Show error with suggestion to check firmware compatibility |
| Audio stream starts but no sound is heard | Check audio output routing, show troubleshooting guidance |
| Audio has unacceptable latency | User adjusts latency slider (50–500ms) to balance delay vs. stability |
| User leaves the browser / phone locks screen | Behaviour depends on platform — may need to warn user that audio may stop (PWA limitation) |
| Roku firmware update changes the auth protocol | Auth fails — show error, note that this depends on a reverse-engineered protocol |
| Network interruption during streaming | Detect stream loss, show disconnected state, offer restart |
