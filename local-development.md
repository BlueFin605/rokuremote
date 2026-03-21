# Local Development

How to run and test RokuRemote on your machine.

---

## Prerequisites

- Node.js 20+
- npm

## Quick Start

You need two terminals — one for the mock Roku and one for the Angular app.

### Terminal 1: Mock Roku

```bash
node mock/roku-mock.mjs
```

This starts a fake Roku ECP server on port 8060. It has 14 apps (Netflix, Disney+, YouTube, etc.), generates coloured icons, and logs all keypresses to the terminal.

### Terminal 2: Angular App

```bash
cd app
ng serve
```

This starts the Angular dev server on port 4200, bound to `0.0.0.0` so it's accessible from other devices on your network.

### Connect

- **From your laptop:** Open `http://localhost:4200`
- **From your phone:** Open `http://<your-laptop-ip>:4200` (must be on the same Wi-Fi)

On the setup screen, enter `localhost` (from laptop) or your laptop's IP (from phone) as the Roku IP. The mock is listening on port 8060, which the Angular dev proxy forwards to automatically.

---

## Testing Specific Scenarios

### Limited Mode (Roku OS 14.1+)

To test the setup instructions that appear when a Roku has ECP restricted:

```bash
node mock/roku-mock.mjs --limited
```

In this mode, device-info still works (so the app can detect the error) but all other commands return `403 ECP command not allowed in Limited mode.`

### Real Roku

If you have a real Roku on the same network, enter its IP address on the setup screen instead. The Angular dev proxy will forward requests to it. No mock needed.

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
├── proxy/          ← C++ audio proxy (cmake, desktop-first)
├── infra/          ← CDK C# (not yet created)
└── .gitignore
```

---

## Audio Proxy (Desktop)

For testing private listening (Plan 6), run the C++ proxy alongside the mock:

```bash
cd proxy
cmake -B build
cmake --build build
./build/roku-proxy --port 8080
```

The proxy runs on port 8080 and exposes: `/discover`, `/start`, `/stop`, `/status`, `/audio`. The Angular app's Private Listening view connects to it.

Note: The mock does not simulate the Roku's private listening WebSocket, so audio testing requires a real Roku.
