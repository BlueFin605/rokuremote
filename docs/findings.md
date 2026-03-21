# Findings — RokuRemote

What's true, grounded in evidence. No recommendations.

---

## The Problem Space

- The user is in New Zealand. The official Roku mobile app is **not available in the NZ Play Store/App Store**.
- Physical Roku remotes keep breaking.
- Private listening (audio to headphones via phone) is an important use case that the user cannot currently access.
- The user has an ESP32 microcontroller available.

## Roku External Control Protocol (ECP)

- ECP is an **HTTP REST API on port 8060** running on every Roku device on the local network.
- **No authentication required.** Any device on the same LAN can send commands.
- Available commands:
  - `POST /keypress/<key>` — send remote button presses (Home, Up, Down, Left, Right, Select, Back, Play, Rev, Fwd, VolumeUp, VolumeDown, VolumeMute, PowerOff, PowerOn, etc.)
  - `POST /keypress/Lit_<char>` — type individual characters for text input
  - `POST /launch/<appId>` — launch an installed channel
  - `GET /query/device-info` — device model, firmware, network info, power state
  - `GET /query/apps` — list all installed channels with IDs and names
  - `GET /query/active-app` — currently running channel
  - `GET /query/media-player` — playback state, position, duration
  - `GET /query/icon/<appId>` — channel icon image
  - `POST /search/browse` — trigger Roku search UI
- Responses are XML-formatted.
- All traffic is **unencrypted HTTP**.

### App Listing & Launch (No Developer Mode Required)

- `GET /query/apps` — returns XML list of all installed channels (app ID, name, version). **Works on any Roku without developer mode.**
- `GET /query/icon/<appId>` — returns binary app tile image (PNG, JPEG, or WebP via `Content-Type` header). **No developer mode required.**
- `POST /launch/<appId>` — launches the channel. Supports deep-link query parameters. **No developer mode required.**
- **No endpoint returns home screen layout order** — `/query/apps` is a flat list, not the user's grid arrangement.
- Note: Roku has removed `/query/apps` and `/query/active-app` from official docs, but both still function.
- `POST /install/<appId>` — opens Channel Store page. Returns **401 Unauthorized** on recent firmware unless developer mode is enabled. Workaround: `/launch/11?contentId=<appId>` (app ID 11 = Channel Store).

### ECP Access Control (Critical — Roku OS 14.1+)

- Since **Roku OS 14.1** (December 2024), ECP defaults to **"Limited mode"** which blocks most commands.
- Limited mode returns: `"ECP command not allowed in Limited mode."` for keypress, query/apps, launch, and other commands.
- The setting is at: **Settings > System > Advanced System Settings > Control by Mobile Apps > Network Access**.
- Options: **Limited** (default since 14.1), **Enabled** (allows LAN control), **Permissive** (allows any network).
- A separate older setting at **Settings > System > Advanced System Settings > External Control** can disable ECP entirely.
- **There is no device-info field** to check whether ECP is in limited mode — you must attempt a command and handle the error.
- This affects ALL ECP commands, not just app queries. The entire remote is non-functional in Limited mode.
- Roku also enforces **HTTP Host header validation** — requests from outside the LAN get 403 Forbidden.
- The official Roku mobile app also requires "Enabled" to function, so this setting is not unusual for users to change.

### ECP Limitations

- **Local network only** — no remote/internet control path.
- **No push events / WebSocket** — must poll for state changes.
- **Rate limiting** — devices become unresponsive if commands sent too rapidly; ~50-100ms between keypresses advisable.
- **Text input is character-by-character** via `Lit_` prefix — slow and depends on on-screen keyboard being active.
- **Volume/power keys** may not work on all streaming sticks (depends on HDMI-CEC/IR support).
- **Device-info fields vary** across firmware versions and device models.

## Device Discovery (SSDP)

- Roku devices are discovered via **SSDP** (Simple Service Discovery Protocol) — a UDP multicast protocol.
- M-SEARCH sent to **239.255.255.250:1900** with search target `roku:ecp`.
- Roku responds with its `LOCATION` header containing `http://<ip>:8060/`.
- Devices also send periodic SSDP NOTIFY advertisements.
- **SSDP only works on the local subnet** — multicast doesn't traverse routers.
- Can be unreliable on networks with AP isolation, VLANs, or multicast blocking.
- **No browser (PWA or otherwise) supports raw UDP or multicast.** SSDP requires native code.

## Private Listening

### Protocol (verified from RPListening source code)

The full private listening protocol has been reverse-engineered and implemented in the open-source **RPListening** project (Java, GPL-3.0, github.com/runz0rd/RPListening). The protocol works as follows:

1. **WebSocket connection** to `ws://<roku-ip>:8060/ecp-session` with headers:
   - `Sec-WebSocket-Origin: Android`
   - `Sec-WebSocket-Protocol: ecp-2`
   - Standard WebSocket upgrade headers

2. **Authentication** — challenge-response over the WebSocket:
   - Roku sends a JSON `notify: "authenticate"` message containing a `param-challenge` value
   - Client computes response: SHA-1 hash of `challenge + transformed("95E610D0-7C29-44EF-FB0F-97F1FCE4C297", shift=9)`, Base64-encoded
   - The UUID and transform are hardcoded — this is **not** per-device pairing, it's a static shared secret
   - Roku responds with `response: "authenticate", status: "200"` on success

3. **Set audio output** — after auth, client sends a JSON `set-audio-output` request with the client's `IP:port` as the device name
   - RTP port: 6970, RTCP port: 5150

4. **Audio stream** — Roku sends **RTP/RTCP** packets (not WebSocket frames) to the client's specified IP:port
   - Codec: **Opus at 48kHz stereo** (RTP payload type 97)
   - SDP: `m=audio 5153 RTP/AVP 97` / `a=rtpmap:97 opus/48000/2`
   - RPListening uses **ffplay** to decode and play the RTP stream

5. **Device capability check** — `GET /query/device-info` returns a `supports-private-listening` field

### Key Insights from RPListening

- The auth is a **static algorithm**, not per-device pairing — any client that implements the SHA-1 challenge-response can authenticate.
- Audio is delivered via standard **RTP/RTCP** (not proprietary framing), which is well-supported by audio libraries.
- The WebSocket is only used for **signaling** (auth + set audio output). The actual audio travels over UDP/RTP.
- ffplay (FFmpeg) can decode the Opus/RTP stream directly.
- The project uses the **jaku** library for ECP queries.

### ESP32 Private Listening (verified from elshnkhll/ROKU-TV-Private-Listening-ESP32)

- A working ESP32 implementation exists that acts as a **proxy** between the Roku and a Chrome browser.
- The ESP32 handles the WebSocket signaling and RTP reception, then serves audio to the browser.
- Uses **Wasm Opus decoder** (another-libopus.js) in the browser for playback and a JS PCM player.
- Only pre-compiled binary firmware is published (no source code), so the internal implementation details are opaque.
- Confirms the protocol is implementable on ESP32 hardware.

### Alternative Audio Paths

- **Roku remote with headphone jack** (Roku Voice Remote Pro) — simplest hardware solution but user's remotes keep breaking.
- **Bluetooth audio from Roku** — some models (Ultra, Streambar) support Bluetooth output natively.
- **HDMI audio extractor** — hardware splitter between Roku and TV, outputting optical/3.5mm to a Bluetooth transmitter.
- **TV's own Bluetooth or headphone jack** — depends on TV model.

## Web App as Mobile App — Technology Options

### PWA (Progressive Web App)

- Angular has first-party PWA support via `@angular/pwa`.
- Once deployed over HTTPS, can be installed to home screen with no browser chrome.
- **Capabilities:** offline caching, push notifications (Android fully; iOS since 16.4), camera, geolocation, Web Audio API.
- **Cannot do:** raw TCP/UDP sockets, SSDP discovery, Bluetooth Classic, reliable background audio (especially iOS).
- **iOS limitations are significant:** aggressive storage eviction (~7 days of non-use), no background sync, no Web Bluetooth, audio stops when backgrounded.
- **Android PWAs** are more capable: background sync, Web Bluetooth, more generous storage, reliable push notifications.

### Capacitor (Angular + Native Shell)

- Wraps Angular app in a native WebView with a bridge to native APIs.
- **Same Angular codebase** builds for web, iOS, and Android.
- Provides: App Store/Play Store distribution, native audio APIs (background-capable), raw TCP/UDP sockets via plugins, mDNS/Bonjour discovery, persistent storage (SQLite), haptics, deep links.
- Can run alongside a PWA deployment — same codebase serves both web and native.
- Process: `ng build` → `npx cap sync` → native projects in Xcode/Android Studio.

### Key Constraint: SSDP Requires Native Code

- **No browser on any platform supports UDP multicast.**
- SSDP device discovery is impossible in a PWA-only approach.
- On iOS native apps, multicast requires Apple's `com.apple.developer.networking.multicast` entitlement (must be requested from Apple).
- On Android native apps, UDP multicast works with standard permissions.
- Fallback: manual IP entry (no discovery needed).

## User's Technical Background

- Expertise: C++, C#, Angular, TypeScript.
- New to mobile app development.
- Has ESP32 microcontroller available.
