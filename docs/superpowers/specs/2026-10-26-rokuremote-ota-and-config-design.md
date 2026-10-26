# RokuRemote: OTA updates, Roku+TV cards, visible version

Date: 2026-10-26

## Problem

1. The Android app bundles the Angular build in the APK, so every UX change needs a new APK download and install.
2. Setup treats the TV as separate from its Roku, and there is no clear Edit action.
3. The Android app shows no version.

## 1. Over-the-air update

Mechanism: `@capgo/capacitor-updater`, self-hosted (no paid service).

- **Version identity.** Every deploy is `1.0.<github.run_number>` (same scheme as the APK `versionName`). A build-time `APP_VERSION` constant embeds it (`dev` locally). It replaces the "GitHub Version" label.
- **Publishing.** `deploy-rokuremote.yml` zips the Angular build to `/android/bundles/<version>.zip` and writes `/android/bundles/latest.json` = `{ version, url, minNativeVersion }` to S3, served through CloudFront.
- **Checking.** Native app only. `UpdateService` fetches `latest.json` on startup and whenever setup opens. Browsers never check (reload already gets latest).
- **UI.** When remote > installed: an **Update to vN** button on setup and a thin banner on the remote screen.
- **Applying.** Download zip with progress, `set` the bundle, reload. `notifyAppReady()` runs on healthy launch; if it never fires, the plugin rolls back to the previous bundle.
- **Native guard.** If installed APK version < `minNativeVersion`, the button becomes "Download new APK" (existing link).
- **Security.** Bundles come only from our CloudFront origin over HTTPS; no signature checking (personal app).

## 2. Roku + TV card

`SavedRoku` already holds an optional TV config; no data change.

- The "Your Rokus" list is the main setup UI. Each card shows the name (active badge), a Roku row (IP) and a TV row (type + IP, or "No TV"), with **Use**, **Edit**, **Delete**.
- **Edit** turns the card's fields into inputs: name, Roku IP, TV type, TV IP, plus Discover Roku / Discover TV when the proxy is available. One **Save** and one **Cancel**. Save verifies the Roku IP, then the TV IP if set; failures show inline and keep the card in edit mode. Only one card is editable at a time.
- Replaces the separate Rename button, standalone IP form and TV Settings section.
- **Add Roku** appends an empty card already in edit mode (same fields, same Save). With no Rokus, setup shows just that card.
- Unchanged: unreachable banner, Discover section, Reboot Timing (global).

## 3. Version display

- Setup footer: `v1.0.N`; after a bundle update also `(app 1.0.M)`, with the APK version read from the Capacitor App plugin so a stale native shell is visible.

## Error handling

- `latest.json` unreachable: silent, no button.
- Download/apply failure: inline "Update failed, try again"; current bundle keeps running.
- Update button disabled during download.

## Testing

- Unit: `UpdateService` (newer/same/older, `minNativeVersion` gating, fetch failure, browser no-op).
- Component: card edit/save/cancel/add flows.
- E2E: existing multi-Roku tests moved to the card UI.
- Capgo plugin mocked; the real swap needs one manual phone check (install APK, publish newer build, tap Update).

## Out of scope

Auto-update without a tap, signed bundles, proxy/ESP32 changes.
