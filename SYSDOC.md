# RokuRemote

Purpose: web-based remote control for Roku devices, with private listening
(audio streaming) support, usable from any browser. The Roku doesn't serve
CORS headers, so a proxy (desktop C++ binary or ESP32 firmware) sits between
the browser and the Roku to bridge ECP calls and stream private-listening
audio.

## Tech stack

- **Frontend:** Angular, served from S3 + CloudFront.
- **Proxy:** C++17 (CMake build) — CORS gateway, SSDP discovery, private
  listening audio (Opus over RTP). Same source also builds as ESP32
  firmware (ESP-IDF v5.x) for a dedicated always-on device.
- **Mock backend:** Node.js — fake Roku ECP server for local testing.
- **Local orchestration:** .NET Aspire AppHost — runs mock + proxy + app
  together with one dashboard.
- **Infra:** AWS CDK (C#) — S3 + CloudFront, optional custom domain via ACM.

## Where things are

- `app/` — Angular web app (the browser UI).
- `proxy/` — C++ desktop proxy; shared source for the ESP32 build.
- `esp32/` — ESP-IDF project that builds the same proxy for an ESP32
  microcontroller (`esp32-tool.ps1` in the repo root flashes it).
- `mock/` — Mock Roku ECP server (Node) used for local dev/testing.
- `aspire/` — Aspire AppHost/ServiceDefaults that orchestrate local dev.
- `infra/` — AWS CDK (C#) deployment of the Angular app to S3 + CloudFront.
  See `infra/README.md` for stack details, config, and CDK commands — not
  repeated here.
- `docs/` — design notes plus per-OS ESP32 toolchain setup walkthroughs
  (`esp32-macbook.md`, `esp32-windows.md`).
- `External Resources.md` — link dump of external Roku ECP/private-listening
  API docs and related community implementations.

## Running it

The one-command local dev flow (Aspire), the manual per-service flow, proxy
endpoints, mock capabilities, and ESP32 build/flash/Wi-Fi-provisioning steps
are all covered in `local-development.md` at the repo root — that file is
the operational reference for this repo, not duplicated here.

Deployment (CDK synth/diff/deploy, config.json setup, custom domain) is
covered in `README.md` and `infra/README.md`.
