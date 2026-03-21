# Flows — RokuRemote

Processes that must exist to make the north star real. Actors, stages, failure modes. No architecture or implementation.

---

## Flow 0: First-Time Setup

**Supports:** All phases — ECP must be enabled before anything works.

### Actors
- **User** — has physical access to the Roku and its TV
- **Phone** — running the remote UI
- **Roku** — may be in Limited mode (default since OS 14.1)

### Happy Path

1. User opens the remote for the first time.
2. The remote prompts for the Roku's IP address.
3. The remote attempts `GET /query/device-info` on the entered IP.
4. **If it succeeds**: Roku is reachable and ECP is enabled. Save IP, proceed to remote.
5. **If it fails with "Limited mode" error**: Show clear instructions to the user:
   - "Your Roku has External Control set to Limited. To use this remote:"
   - On your TV: **Settings > System > Advanced System Settings > Control by Mobile Apps > Network Access > Enabled**
   - Include a "Try Again" button.
6. **If it fails with timeout/unreachable**: Show "Roku not found at this IP" with option to re-enter.
7. Once connected, the remote remembers the IP for next time.

### Why This Flow Exists

Since Roku OS 14.1, ECP defaults to Limited mode. Every third-party remote (Home Assistant, Roam, etc.) hit this. The official Roku app requires the same setting change. Users need clear guidance on first run — otherwise the remote appears broken.

### Failure Modes

| What Goes Wrong | What Should Happen |
|---|---|
| User enters wrong IP | Timeout → "Roku not found" → re-enter |
| Roku is in Limited mode | Detect the specific error, show step-by-step instructions to enable |
| Roku has External Control fully disabled | Same guidance but different setting path |
| User doesn't know their Roku's IP | Show instructions: "On your Roku TV: Settings > Network > About" |
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

1. User navigates to the app launcher view.
2. The remote fetches the list of installed apps and their icons from the Roku.
3. Apps are displayed as a grid of tiles with icons and names.
4. User taps an app tile.
5. The Roku launches that app. The TV switches to it.
6. The remote returns to (or stays on) the control view so the user can navigate within the app.

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
- **Audio Proxy** (if needed) — local device (ESP32 or similar) that receives RTP audio and forwards it to the phone

### Precondition
- Flow 1 has completed — the remote is connected to a Roku.
- The Roku supports private listening (`supports-private-listening` = true in device info).

### Happy Path

1. User taps a "Private Listening" button on the remote.
2. The remote authenticates with the Roku via WebSocket on `/ecp-session`.
3. The remote tells the Roku where to send audio (IP and port of the listener).
4. The Roku begins streaming Opus audio via RTP to the specified address.
5. The listener decodes Opus to PCM and plays through the phone's audio output.
6. User hears the TV audio in their headphones with acceptable lip-sync.
7. User taps the button again to stop. The WebSocket closes, audio stops, Roku resumes normal audio output.

### Open Question: Who Receives the RTP Stream?

The Roku sends RTP packets to an IP:port on the local network. The phone needs to receive and decode them. Two paths exist:

**Path A — Phone directly receives RTP**
- Phone listens on a UDP port for RTP packets.
- Requires native UDP socket access (not available in browsers — needs Capacitor or native app).
- Simplest architecture — no extra hardware.

**Path B — ESP32 proxy**
- ESP32 receives RTP, decodes Opus, re-serves audio to the phone over HTTP or WebSocket.
- Phone plays audio via standard web audio APIs — works in any browser.
- Adds hardware dependency but removes the need for a native app for audio.

This is a design decision, not a flow decision. Both paths satisfy the same flow.

### Failure Modes

| What Goes Wrong | What Should Happen |
|---|---|
| Roku doesn't support private listening | Hide or disable the button, show explanation |
| WebSocket authentication fails | Show error with suggestion to check firmware compatibility |
| Audio stream starts but no sound is heard | Check audio output routing, show troubleshooting guidance |
| Audio has unacceptable latency | Surface a latency indicator if detectable; this may be a hardware/network limitation |
| User leaves the browser / phone locks screen | Behaviour depends on platform — may need to warn user that audio may stop (PWA limitation) |
| Roku firmware update changes the auth protocol | Auth fails — show error, note that this depends on a reverse-engineered protocol |
| Network interruption during streaming | Detect stream loss, show disconnected state, offer restart |
