# Local Development

How to run and test RokuRemote on your machine.

---

## Prerequisites

- Node.js 20+
- npm
- CMake 3.20+ and a C++17 compiler (for the proxy)

## Quick Start

You need three terminals — one for the mock Roku, one for the proxy, and one for the Angular app.

### Terminal 1: Mock Roku

```bash
node mock/roku-mock.mjs
```

This starts a fake Roku ECP server on port 8060. It has 14 apps (Netflix, Disney+, YouTube, etc.), generates coloured icons, and logs all keypresses to the terminal.

### Terminal 2: Proxy

```bash
cd proxy
cmake -B build
cmake --build build
./build/roku-proxy --port 8080
```

The proxy sits between the Angular app and the Roku (or mock). The Roku doesn't serve CORS headers, so the browser can't talk to it directly. The proxy forwards requests and adds CORS headers.

### Terminal 3: Angular App

```bash
cd app
ng serve
```

This starts the Angular dev server on port 4200, bound to `0.0.0.0` so it's accessible from other devices on your network.

### Connect

- **From your laptop:** Open `http://localhost:4200`
- **From your phone:** Open `http://<your-laptop-ip>:4200` (must be on the same Wi-Fi)

On the setup screen, enter `localhost` (from laptop) or your laptop's IP (from phone) as the Roku IP. The proxy must be running — all requests from the app go through it.

---

## How It Works

The Angular app never talks to the Roku directly. All requests go through the C++ proxy:

```
Browser → http://localhost:8080/roku/<path>?ip=<roku-ip> → Roku ECP (port 8060)
```

The proxy adds CORS headers to the response so the browser accepts it. This is the same proxy that handles SSDP discovery and private listening audio — one service for everything.

---

## Testing Specific Scenarios

### Limited Mode (Roku OS 14.1+)

To test the setup instructions that appear when a Roku has ECP restricted:

```bash
node mock/roku-mock.mjs --limited
```

In this mode, device-info still works (so the app can detect the error) but all other commands return `403 ECP command not allowed in Limited mode.`

### Real Roku

If you have a real Roku on the same network, enter its IP address on the setup screen instead. The proxy will forward requests to it. No mock needed (but the proxy is still required).

---

## What the Mock Simulates

| Feature | Simulated? | Notes |
|---|---|---|
| Device info | Yes | Returns model name, capabilities, private listening support |
| Keypress / keydown / keyup | Yes | Logged to terminal |
| App list | Yes | 14 apps with generated PNG icons |
| App launch | Yes | Updates active app state |
| Active app query | Yes | Returns the last launched app |
| App icons | Yes | Coloured PNG with app initial |
| Limited mode | Yes | `--limited` flag |
| Private listening | No | WebSocket + RTP audio not mocked |
| SSDP discovery | No | Mock runs on localhost, not discoverable via SSDP |

---

## Project Structure

```
RokuRemote/
├── docs/           ← Declaration (findings, north star, flows, design, plans)
├── app/            ← Angular web app (ng serve from here)
├── mock/           ← Mock Roku ECP server (node, no dependencies)
├── proxy/          ← C++ proxy (ECP forwarding, SSDP discovery, audio streaming)
├── infra/          ← CDK C# (not yet created)
└── .gitignore
```

---

## Proxy Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/roku/<path>?ip=<roku-ip>` | GET/POST | Forward request to Roku ECP, return response with CORS headers |
| `/discover` | GET | SSDP discovery, returns JSON array of Roku devices |
| `/start?roku=<ip>` | POST | Start private listening session |
| `/stop` | POST | Stop private listening session |
| `/status` | GET | Current state (idle, connecting, streaming, error) |
| `/audio` | GET | Streaming Opus audio (chunked transfer) |

Note: The mock does not simulate the Roku's private listening WebSocket, so audio testing requires a real Roku.
