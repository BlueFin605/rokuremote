# North Star — RokuRemote

What great looks like from the user's perspective. Testable statements, not features or architecture.

## Priority Order

1. **Core Control** — replace the physical remote
2. **TV Control** — volume, mute, power, and input via the TV itself
3. **App Launcher** — visual app grid
4. **Private Listening** — audio to headphones

---

## Core Control

1. I can control my Roku from my phone without the official Roku app, regardless of my country's app store availability.
2. I can navigate menus, launch apps, control playback, adjust volume, and enter text — everything a physical remote does.
3. I can discover my Roku automatically on my local network without needing to know its IP address.
4. The remote feels responsive — button presses register without noticeable delay.

## TV Control

5. I can control my TV's volume, mute, power, and input switching from the same remote interface — without switching apps or screens.
6. Volume and mute buttons always control my TV, not the Roku — matching how a physical universal remote works.
7. Power on/off controls the TV directly. Input switching lets me select HDMI inputs from the remote.
8. I can configure which type of TV I have (starting with Panasonic, extensible to other brands) and the remote adapts.
9. If my TV requires pairing (e.g., newer Panasonic models), setup walks me through it once and remembers the credentials.
10. If no TV is configured, the remote still works for everything else — TV control is additive, not required.

## App Launcher

11. I can see all my installed Roku apps as a grid of tiles with their icons — like the Roku home screen.
12. I can tap an app tile to launch it directly, without navigating menus on the TV.
13. I can find apps quickly when the list is long (search/filter or custom ordering).

## Private Listening

14. I can listen to my Roku's audio privately through my phone's headphones or speaker.
15. Private listening starts and stops cleanly — no audio artifacts, no stuck connections.
16. Audio latency is low enough that lip-sync is acceptable for watching TV.
16a. I can tune audio latency to balance between responsiveness and stability on my network.

## Access & Installation

17. I can use the remote from a mobile browser without installing anything — it just works.
18. I can also install it as an app on my phone for a more native experience when I choose to.
19. Both the browser and installed versions share the same capabilities (except where platform constraints make this impossible).

## Reliability

20. If my Roku's IP address changes, the remote recovers without manual reconfiguration.
21. If the Roku is unreachable (off, different network), I get clear feedback rather than a broken UI.
22. The remote works across Roku models that support ECP and private listening.
23. If my TV's IP address changes or the TV is off, volume/power buttons degrade gracefully — the remote remains usable for Roku control.

## What We Won't Accept

- Dependence on the official Roku app or Roku's app store availability.
- A cloud service required for core remote control — ECP commands go directly from phone to Roku on the local network.
- A desktop-only solution — this must work on a phone in my hand while I'm on the couch.
- A cloud dependency for private listening — if audio proxying is needed, it runs locally (ESP32 or similar), not through a remote server.
- A separate UI or app for TV control — volume, mute, power, and input live on the same remote screen as the d-pad and playback controls.

## Acceptable Infrastructure

- AWS hosting for serving the web app itself (static site / CDN) is fine — this is just delivering the UI, not proxying control.
- Local devices (ESP32 or similar) for private listening audio proxying if the phone can't handle it directly.
