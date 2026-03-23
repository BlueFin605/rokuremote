# North Star — RokuRemote

What great looks like from the user's perspective. Testable statements, not features or architecture.

## Priority Order

1. **Core Control** — replace the physical remote
2. **App Launcher** — visual app grid
3. **Private Listening** — audio to headphones

---

## Core Control

1. I can control my Roku from my phone without the official Roku app, regardless of my country's app store availability.
2. I can navigate menus, launch apps, control playback, adjust volume, and enter text — everything a physical remote does.
3. I can discover my Roku automatically on my local network without needing to know its IP address.
4. The remote feels responsive — button presses register without noticeable delay.

## App Launcher

5. I can see all my installed Roku apps as a grid of tiles with their icons — like the Roku home screen.
6. I can tap an app tile to launch it directly, without navigating menus on the TV.
7. I can find apps quickly when the list is long (search/filter or custom ordering).

## Private Listening

8. I can listen to my Roku's audio privately through my phone's headphones or speaker.
9. Private listening starts and stops cleanly — no audio artifacts, no stuck connections.
10. Audio latency is low enough that lip-sync is acceptable for watching TV.
10a. I can tune audio latency to balance between responsiveness and stability on my network.

## Access & Installation

11. I can use the remote from a mobile browser without installing anything — it just works.
12. I can also install it as an app on my phone for a more native experience when I choose to.
13. Both the browser and installed versions share the same capabilities (except where platform constraints make this impossible).

## Reliability

14. If my Roku's IP address changes, the remote recovers without manual reconfiguration.
15. If the Roku is unreachable (off, different network), I get clear feedback rather than a broken UI.
16. The remote works across Roku models that support ECP and private listening.

## What We Won't Accept

- Dependence on the official Roku app or Roku's app store availability.
- A cloud service required for core remote control — ECP commands go directly from phone to Roku on the local network.
- A desktop-only solution — this must work on a phone in my hand while I'm on the couch.
- A cloud dependency for private listening — if audio proxying is needed, it runs locally (ESP32 or similar), not through a remote server.

## Acceptable Infrastructure

- AWS hosting for serving the web app itself (static site / CDN) is fine — this is just delivering the UI, not proxying control.
- Local devices (ESP32 or similar) for private listening audio proxying if the phone can't handle it directly.
