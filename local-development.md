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
├── proxy/          ← C++ desktop proxy (ECP forwarding, SSDP discovery, audio streaming)
├── esp32/          ← ESP32 firmware (same proxy, runs on microcontroller)
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

---

## ESP32 Firmware

The `esp32/` directory contains the same proxy ported to run on an ESP32 microcontroller. Once flashed, the ESP32 connects to your Wi-Fi and serves the same HTTP API — the Angular app can't tell the difference between the desktop proxy and the ESP32.

### Prerequisites

- [ESP-IDF v5.x](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/) installed and sourced (`. $HOME/esp/esp-idf/export.sh`)
- An ESP32 dev board (ESP32, ESP32-S3, etc.) connected via USB
- USB-to-serial driver for your board (CP2102 or CH340 depending on the board)

### First-Time Setup

```bash
cd esp32

# Set the target chip (run once)
idf.py set-target esp32       # or esp32s3, esp32c3, etc.

# Configure Wi-Fi credentials and ports
idf.py menuconfig
```

In menuconfig, navigate to **Roku Proxy Configuration** and set:

| Setting | Default | Description |
|---|---|---|
| Wi-Fi SSID | `YourSSID` | Your home Wi-Fi network name |
| Wi-Fi Password | `YourPassword` | Your Wi-Fi password |
| HTTP API Port | `8080` | Port the Angular app connects to |
| RTP Receive Port | `6970` | UDP port for Roku audio packets |

Save and exit (`S`, then `Q`).

### Build

```bash
idf.py build
```

First build takes a few minutes (compiles all of ESP-IDF). Subsequent builds are incremental and much faster.

### Flash and Monitor

```bash
# Find your serial port
ls /dev/tty.usb*          # macOS
ls /dev/ttyUSB*           # Linux

# Flash firmware and open serial monitor
idf.py -p /dev/tty.usbserial-0001 flash monitor
```

Replace the port with whatever your board shows up as. The monitor shows boot logs — you should see:

```
I (xxx) wifi: Connected. IP: 192.168.1.xxx
I (xxx) main: Roku proxy ready on http://192.168.1.xxx:8080
```

Press `Ctrl+]` to exit the monitor.

### Build + Flash in One Step

```bash
idf.py -p /dev/tty.usbserial-0001 flash monitor
```

This builds (if needed), flashes, and opens the monitor in one command.

### Using with the Angular App

Once the ESP32 is running, use it exactly like the desktop proxy. On the Angular app's setup screen, enter the Roku's IP. The app talks to the ESP32 proxy instead of the desktop one.

If the Angular app is running via `ng serve` with the default proxy config (`proxy.conf.js`), you'll need to point it at the ESP32's IP instead of localhost. Either:

1. Update `proxy.conf.js` to point to the ESP32's IP, or
2. Access the app from your phone and enter the ESP32's IP as the proxy address

### Updating Wi-Fi Credentials

If you change Wi-Fi networks:

```bash
idf.py menuconfig    # Update SSID/password
idf.py -p /dev/tty.usbserial-0001 flash monitor
```

### Troubleshooting

| Problem | Fix |
|---|---|
| `idf.py: command not found` | Run `. $HOME/esp/esp-idf/export.sh` to source ESP-IDF |
| Board not detected | Check USB cable (some are charge-only), install the serial driver |
| Wi-Fi keeps reconnecting | Check SSID/password in menuconfig, ensure 2.4 GHz network (ESP32 doesn't support 5 GHz) |
| Build fails with mbedTLS errors | Run `idf.py menuconfig` → Component config → mbedTLS → enable SHA-1 |
| Task watchdog timeout | The default timeout has been increased to 30s in `sdkconfig.defaults` — if it still triggers, the `/audio` handler may be blocked |
