# RokuRemote

A web-based remote control for Roku devices with private listening (audio streaming) support. Control your Roku from any browser — phone, tablet, or desktop.

## Architecture

```
Browser (Angular) → Proxy (C++ or ESP32) → Roku (ECP / RTP)
```

The Angular app can't talk to the Roku directly (no CORS), so a proxy sits in between. The proxy also handles SSDP discovery and private listening audio. You can run the proxy on your desktop or flash it onto an ESP32 for a dedicated always-on device.

## Project Structure

```
RokuRemote/
├── app/            ← Angular web app
├── proxy/          ← C++ desktop proxy
├── esp32/          ← ESP32 firmware (same proxy for microcontroller)
├── mock/           ← Mock Roku server for testing
├── infra/          ← AWS CDK (S3 + CloudFront deployment)
└── docs/           ← Design docs and notes
```

## Quick Start

### 1. Start the proxy

**Desktop (C++):**

```bash
cd proxy
cmake -B build
cmake --build build
./build/roku-proxy --port 8080
```

**ESP32:** See [ESP32 setup](#esp32-proxy) below.

### 2. Start the web app

```bash
cd app
npm ci
ng serve
```

Open `http://localhost:4200` and enter your Roku's IP address.

## Desktop Proxy

Requires CMake 3.20+ and a C++17 compiler.

```bash
cd proxy
cmake -B build
cmake --build build
./build/roku-proxy --port 8080
```

The proxy exposes these endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/roku/<path>?ip=<roku-ip>` | GET/POST | Forward to Roku ECP with CORS |
| `/discover` | GET | SSDP discovery of Roku devices |
| `/start?roku=<ip>` | POST | Start private listening |
| `/stop` | POST | Stop private listening |
| `/status` | GET | Session state |
| `/audio` | GET | Streaming Opus audio (chunked) |

## ESP32 Proxy

The ESP32 firmware runs the same proxy on a microcontroller — plug it in, connect to Wi-Fi, and it's always available.

### Prerequisites

- [ESP-IDF v5.x](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/) installed and sourced
- An ESP32 dev board connected via USB

### Configure

```bash
cd esp32
idf.py set-target esp32    # run once (or esp32s3, esp32c3, etc.)
idf.py menuconfig
```

In menuconfig, go to **Roku Proxy Configuration** and set:

| Setting | Default | Description |
|---|---|---|
| Wi-Fi SSID | `YourSSID` | Your Wi-Fi network |
| Wi-Fi Password | `YourPassword` | Your Wi-Fi password |
| HTTP API Port | `8080` | Port the app connects to |
| RTP Receive Port | `6970` | UDP port for Roku audio |

### Build & Flash

**Option A: Flash from pre-built firmware (GitHub Actions)**

Download the `roku-proxy-esp32` artifact from the latest [Actions build](https://github.com/deanmitchell/RokuRemote/actions), then flash with esptool:

```bash
pip install esptool    # if not already installed

esptool.py --chip esp32 -p /dev/tty.usbserial-0001 write_flash \
  0x1000  bootloader.bin \
  0x8000  partition-table.bin \
  0x10000 roku-proxy-esp32.bin
```

Note: Pre-built firmware uses the default Wi-Fi credentials from `sdkconfig.defaults`. To set your own, use Option B or update `sdkconfig.defaults` before pushing.

**Option B: Build locally with ESP-IDF**

```bash
cd esp32
idf.py set-target esp32
idf.py menuconfig          # set Wi-Fi credentials and ports
idf.py -p /dev/tty.usbserial-0001 flash monitor
```

Once running, the serial output shows the ESP32's IP address. The ESP32 also advertises itself as `roku-proxy.local` via mDNS — the app uses this by default.

### Troubleshooting

| Problem | Fix |
|---|---|
| `idf.py: command not found` | Source ESP-IDF: `. $HOME/esp/esp-idf/export.sh` |
| Board not detected | Check USB cable (some are charge-only) and serial driver |
| Wi-Fi reconnecting | Check credentials in menuconfig; ESP32 only supports 2.4 GHz |

## Infrastructure

The web app is hosted on AWS (S3 + CloudFront) and deployed via GitHub Actions on push to `master`.

See [infra/README.md](infra/README.md) for CDK commands.

**Live site:** https://roku.bluefin605.com

## Local Development

See [local-development.md](local-development.md) for the full development setup including the mock Roku server, testing scenarios, and private listening details.
