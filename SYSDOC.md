# RokuRemote

Purpose: web-based remote control for Roku devices, with private listening
(audio streaming) support, usable from any browser. The Roku doesn't serve
CORS headers, so a proxy (desktop C++ binary or ESP32 firmware) sits between
the browser and the Roku to bridge ECP calls and stream private-listening
audio.

## Tech stack

- **Frontend:** Angular, served from S3 + CloudFront.
- **Android app:** Capacitor 8 (Android) wrapper around the Angular app.
- **Proxy:** C++17 (CMake build) — CORS gateway, SSDP discovery, private
  listening audio (Opus over RTP). Same source also builds as ESP32
  firmware (ESP-IDF v5.x) for a dedicated always-on device.
- **Mock backend:** Node.js — fake Roku ECP server for local testing.
- **Local orchestration:** .NET Aspire AppHost — runs mock + proxy + app
  together with one dashboard.
- **Infra:** AWS CDK (C#) — S3 + CloudFront, optional custom domain via ACM.

## Behaviour worth knowing

The app stores several Rokus (each with an optional TV config), switches
between them from a header dropdown, and opens straight to the apps screen
(or the remote when ECP is limited). If the active Roku is unreachable, setup
opens with a "Couldn't reach <name> (<ip>)" banner.

Setup lists one card per saved Roku (`roku-card` component): name, Roku IP and
TV, with Use, Edit and Delete. Edit expands the card in place (name, Roku IP,
TV type/IP, TV discovery when a proxy is available); Save validates and
connects via `roku-config.service.ts` (Roku first, then the TV) and shows
errors on the card. "Add Roku" shows an empty card in the same form.

The setup footer shows `v<APP_VERSION>` plus `(app <APK version>)` when
running natively. `APP_VERSION` is a build-time constant in
`app/src/app/version.ts` (`dev` locally), stamped as `1.0.<run number>` by
`app/scripts/set-version.mjs` before each CI Angular build.

## Where things are

- `app/` — Angular web app (the browser UI).
- `app/android/` — Capacitor Android project (`com.bluefin605.rokuremote`)
  that wraps the Angular app. It exists because Chrome on Android only
  installs PWAs from HTTPS and the proxy is plain HTTP. Config is
  `app/capacitor.config.ts`; private listening runs as a foreground service
  (`app/src/app/services/native-background.service.ts`). The signed APK is
  built by the `build-android` job in Home's `deploy-rokuremote.yml` and
  published to `/android/latest/roku-remote.apk` on the site (S3 +
  CloudFront); the setup screen links to it. PR/push CI
  (`.github/workflows/build.yml`) builds a debug APK artifact.
  **Over-the-air updates:** the app embeds `@capgo/capacitor-updater` in
  manual mode (`autoUpdate: false` in `capacitor.config.ts`), so web-layer
  changes ship without a new APK. The deploy workflow zips the built web app
  to `/android/bundles/<version>.zip` and writes
  `/android/bundles/latest.json` (`version`, `url`, `minNativeVersion`,
  `checksum` = sha256 of the zip, which the Capgo plugin requires to install;
  not cached). `update.service.ts` fetches it when setup or remote loads; if its
  version is newer than `APP_VERSION` the Update button appears
  (`update-button` component: download with progress, then switch bundle). If
  the installed APK's version is below `minNativeVersion` it shows "Download
  new APK" instead. `app/ota-min-native-version.txt` holds the minimum APK
  build number for the next bundle (published as `1.0.<n>`); raise it only
  when a bundle needs native code newer than existing APKs.
- `proxy/` — C++ desktop proxy; shared source for the ESP32 build.
- `esp32/` — ESP-IDF project that builds the same proxy for an ESP32
  microcontroller (`esp32-tool.ps1` in the repo root flashes it).
- `mock/` — Mock Roku ECP server (Node) used for local dev/testing.
- `aspire/` — Aspire AppHost/ServiceDefaults that orchestrate local dev.
- `infra/` — AWS CDK (C#) deployment of the Angular app to S3 + CloudFront.
  See `infra/README.md` for stack details, config, and CDK commands — not
  repeated here.
- `docs/` — design notes plus per-OS ESP32 toolchain setup walkthroughs
  (`esp32-macbook.md`, `esp32-windows.md`). `docs/proxy-scenarios.md` explains
  where the proxy is hosted and how browser, Apple + ESP32, and Android reach
  it, with diagrams and code links.
- `External Resources.md` — link dump of external Roku ECP/private-listening
  API docs and related community implementations.

## Running it

The one-command local dev flow (Aspire), the manual per-service flow, proxy
endpoints, mock capabilities, and ESP32 build/flash/Wi-Fi-provisioning steps
are all covered in `local-development.md` at the repo root — that file is
the operational reference for this repo, not duplicated here.

Deployment (CDK synth/diff/deploy, config.json setup, custom domain) is
covered in `README.md` and `infra/README.md`.
