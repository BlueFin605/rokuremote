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
├── aspire/         ← Aspire AppHost (local development orchestration)
└── docs/           ← Design docs and notes
```

## Quick Start

### Local Development (Aspire)

Aspire runs the mock Roku, proxy, and Angular app in one command with a unified dashboard.

```powershell
./setup-aspire.ps1    # first time: install deps, build proxy
./start-aspire.ps1    # start everything
```

Open `http://localhost:4200` and enter `localhost` as the Roku IP.

See [local-development.md](local-development.md) for the full setup guide including manual start, testing scenarios, and ESP32 details.

### Local Development (Manual)

```bash
# Terminal 1: Mock Roku
node mock/roku-mock.mjs

# Terminal 2: Proxy
cd proxy && cmake -B build && cmake --build build && ./build/roku-proxy --port 8080

# Terminal 3: Angular app
cd app && npm ci && ng serve
```

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

The ESP32 firmware runs the same proxy on a microcontroller — plug it in, connect to Wi-Fi, and it's always available. It advertises itself as `roku-proxy.local` via mDNS and can also be reached as `roku-proxy` on routers that register DHCP hostnames.

### Flash the Firmware

**Option A: Pre-built firmware (no toolchain needed)**

Download the `roku-proxy-esp32` artifact from the latest [Actions build](../../actions), then flash:

```bash
pip install esptool    # if not already installed

esptool.py --chip esp32s3 -p /dev/tty.usbserial-0001 write_flash \
  0x0     bootloader.bin \
  0x8000  partition-table.bin \
  0x10000 roku-proxy-esp32.bin
```

**Option B: Build locally with ESP-IDF**

Requires [ESP-IDF v5.x](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/).

```bash
cd esp32
idf.py set-target esp32s3
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
esptool.py --chip esp32s3 -p /dev/tty.usbserial-0001 erase_region 0x9000 0x6000
```

Then open the serial monitor again and the ESP32 will re-prompt.

### Verify

Once connected, the serial output shows:

```
Local IP: 192.168.1.x
mDNS hostname: roku-proxy.local
Roku proxy ready on http://roku-proxy.local:80
```

Open the hosted web app or `http://localhost:4200` on your phone.

Recommended proxy URL order:
1. `http://roku-proxy/`
2. `http://roku-proxy.local/`
3. `http://<device-ip>/`

### Flash from Pre-Built Binary

If you have a pre-built firmware (e.g., from GitHub Actions), you can flash it directly with `esptool` without needing ESP-IDF:

```bash
esptool --chip esp32s3 --port COM3 --baud 460800 write_flash -z \
  0x0   bootloader/bootloader.bin \
  0x8000 partition_table/partition-table.bin \
  0x10000 roku-proxy-esp32.bin
```

Replace `COM3` with your serial port (`/dev/ttyUSB0` on Linux, `/dev/tty.usbserial-*` on macOS).

### Host Firmware on S3/CloudFront (Recommended)

You can host firmware files on your existing S3 + CloudFront deployment and flash directly from a URL.

1. Upload firmware files (same folder structure) to S3:

```bash
aws s3 cp bootloader/bootloader.bin s3://<bucket>/firmware/latest/bootloader/bootloader.bin
aws s3 cp partition_table/partition-table.bin s3://<bucket>/firmware/latest/partition_table/partition-table.bin
aws s3 cp roku-proxy-esp32.bin s3://<bucket>/firmware/latest/roku-proxy-esp32.bin
```

2. Invalidate CloudFront so clients get the latest files:

```bash
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/firmware/latest/*"
```

3. Flash directly from your domain URL:

```powershell
./esp32-tool.ps1 flash-url -Port COM4 -FirmwareUrlBase https://roku.yourdomain.com/firmware/latest
```

Or flash and then open serial monitor:

```powershell
./esp32-tool.ps1 flash-monitor-url -Port COM4 -FirmwareUrlBase https://roku.yourdomain.com/firmware/latest
```

This avoids sharing local files and gives everyone a single stable download URL.

### Troubleshooting

| Problem | Fix |
|---|---|
| No serial prompt after flashing | Press the EN/Reset button on the board |
| Board not detected | Check USB cable (some are charge-only) and install serial driver |
| Wi-Fi won't connect | ESP32 only supports 2.4 GHz Wi-Fi, not 5 GHz |
| `roku-proxy` not resolving | Try `http://roku-proxy.local/`, then the IP address shown in serial output |

## Infrastructure

The web app is hosted on AWS (S3 + CloudFront). Infrastructure is managed with CDK (C#).

### Configuration

Copy `config.example.json` to `config.json` and fill in your values:

```json
{
  "rokuremote": {
    "prefix": "rokuremote",
    "region": "ap-southeast-2",
    "environment": "production",
    "domain": "roku.yourdomain.com",
    "certificateArnUsEast1": "arn:aws:acm:us-east-1:..."
  }
}
```

`domain` and `certificateArnUsEast1` are optional — without them, CloudFront serves on its default `*.cloudfront.net` domain.

### Deploy

From the `infra/` directory:

```bash
cdk bootstrap                                    # first time only
cdk diff --context configFile=../config.json     # preview changes
cdk deploy --context configFile=../config.json   # deploy to AWS
```

See [infra/README.md](infra/README.md) for full CDK details.
