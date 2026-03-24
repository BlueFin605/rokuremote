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

The ESP32 firmware runs the same proxy on a microcontroller — plug it in, connect to Wi-Fi, and it's always available. It advertises itself as `roku-proxy.local` via mDNS, so the web app finds it automatically.

### Flash the Firmware

**Option A: Pre-built firmware (no toolchain needed)**

Download the `roku-proxy-esp32` artifact from the latest [Actions build](https://github.com/deanmitchell/RokuRemote/actions), then flash:

```bash
pip install esptool    # if not already installed

esptool.py --chip esp32 -p /dev/tty.usbserial-0001 write_flash \
  0x1000  bootloader.bin \
  0x8000  partition-table.bin \
  0x10000 roku-proxy-esp32.bin
```

**Option B: Build locally with ESP-IDF**

Requires [ESP-IDF v5.x](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/).

```bash
cd esp32
idf.py set-target esp32
idf.py build
idf.py -p /dev/tty.usbserial-0001 flash
```

### Wi-Fi Setup

On first boot the ESP32 prompts for Wi-Fi credentials over the USB serial connection. Open a serial monitor:

```bash
screen /dev/tty.usbserial-0001 115200
```

You'll see:

```
=================================
  Roku Proxy — Wi-Fi Setup
=================================
Wi-Fi SSID: MyNetwork
Wi-Fi Password: MyPassword
```

Type your SSID and password. They're saved to flash and persist across reboots — you only need to do this once.

To re-enter credentials, erase the saved config and reboot:

```bash
esptool.py --chip esp32 -p /dev/tty.usbserial-0001 erase_region 0x9000 0x6000
```

Then open the serial monitor again and the ESP32 will re-prompt.

### Verify

Once connected, the serial output shows:

```
Local IP: 192.168.1.x
mDNS hostname: roku-proxy.local
Roku proxy ready on http://roku-proxy.local:8080
```

Open `https://roku.bluefin605.com` on your phone — the app defaults to `http://roku-proxy.local:8080` and should connect automatically.

### Troubleshooting

| Problem | Fix |
|---|---|
| No serial prompt after flashing | Press the EN/Reset button on the board |
| Board not detected | Check USB cable (some are charge-only) and install serial driver |
| Wi-Fi won't connect | ESP32 only supports 2.4 GHz Wi-Fi, not 5 GHz |
| `roku-proxy.local` not resolving | Try the IP address shown in serial output instead |

## Infrastructure

The web app is hosted on AWS (S3 + CloudFront) and deployed via GitHub Actions on push to `master`.

See [infra/README.md](infra/README.md) for CDK commands.

**Live site:** https://roku.bluefin605.com

## Local Development

See [local-development.md](local-development.md) for the full development setup including the mock Roku server, testing scenarios, and private listening details.
