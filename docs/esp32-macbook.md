# ESP32 Flashing & Monitoring on macOS

## Prerequisites

```bash
pip install esptool pyserial
```

## Find your serial port

Plug in the ESP32 via USB, then:

```bash
ls /dev/cu.usb*
```

Common port names for the CP2102/CH340 on the DEVKIT V1:
- `/dev/cu.SLAB_USBtoUART` (CP2102 with Silabs driver)
- `/dev/cu.usbserial-1410` (CP2102 default)
- `/dev/cu.wchusbserial-*` (CH340)

If nothing shows up, you may need the CP2102 or CH340 USB-serial driver:
- **CP2102:** https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers
- **CH340:** https://github.com/WCHSoftware/ch34xser_macos

## Usage

```bash
./esp32-tool.sh                                        # flash + monitor (default port)
./esp32-tool.sh flash                                  # flash only
./esp32-tool.sh monitor                                # monitor only
./esp32-tool.sh flash-monitor /dev/cu.SLAB_USBtoUART   # custom port
./esp32-tool.sh flash-monitor /dev/cu.SLAB_USBtoUART ~/Downloads/roku-proxy-esp32  # custom firmware path
```

The firmware path defaults to `~/Downloads/roku-proxy-esp32` and expects this structure:

```
roku-proxy-esp32/
├── bootloader/bootloader.bin
├── partition_table/partition-table.bin
└── roku-proxy-esp32.bin
```

## Serial monitor

The monitor uses `screen` if available, otherwise falls back to `python3` with `pyserial`.

### Exiting the monitor

| Monitor | How to exit |
|---------|------------|
| `screen` | `Ctrl+A` then `K` then `Y` |
| Python fallback | `Ctrl+C` |

If `screen` appears frozen or unresponsive, `Ctrl+A` then `\` force-kills it.

## Troubleshooting

- **Permission denied on port:** Add yourself to the `dialout` group or use `sudo`
- **Port busy:** Another process (e.g. Arduino IDE) may have it open. Close it or run `lsof /dev/cu.usb*` to check
- **No port found:** Try a different USB cable — some are charge-only with no data lines
- **Flash fails with timeout:** Hold the **BOOT** button on the board while flashing starts, release after "Connecting..." appears
