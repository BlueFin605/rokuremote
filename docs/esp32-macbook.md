# ESP32 Flashing & Monitoring on macOS

## Full Setup for a New Mac

Follow these steps in order when setting up a new Mac for the first time.

### Step 1: Get the Repository

If you don't already have the project on your new Mac:

```bash
git clone https://github.com/BlueFin605/rokuremote.git
cd rokuremote
```

If you're upgrading and already have it checked out, just navigate to it:

```bash
cd /path/to/rokuremote
```

### Step 2: Install System Dependencies

#### Homebrew (if not already installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Install required tools

```bash
brew install python3 screen git
```

### Step 3: Set Up Python Virtual Environment

The project includes a `.venv` directory (or you can create one):

```bash
# Create the virtual environment if it doesn't exist
python3 -m venv .venv

# Activate it
source .venv/bin/activate
```

You should see `(.venv)` at the start of your terminal prompt when activated.

### Step 4: Install Python CLI Tools

With the virtual environment activated:

```bash
pip install esptool pyserial
```

Verify installation:

```bash
esptool.py version
```

### Step 5: Install USB Serial Drivers

Before you plug in the ESP32, install the drivers for your USB chip:

**For CP2102 (Silicon Labs driver):**
```bash
# Download and install from: https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers
# Or use Homebrew:
brew install cp210x-usbserial-driver
```

**For CH340 (WCH driver):**
```bash
# Download and install from: https://www.wch-ic.com/downloads/CH341SER_MAC_ZIP.html
# Then download CH341SER_MAC.ZIP, unzip, and run the installer package
```

After installation, you may need to **restart your Mac** for the drivers to take effect.

### Step 6: Connect your ESP32

Plug in the ESP32 via USB and find the serial port:

```bash
ls /dev/cu.usb*
```

You should see one of these (depending on which driver you installed):
- `/dev/cu.SLAB_USBtoUART` (CP2102 with Silabs driver)
- `/dev/cu.usbserial-1410` (CP2102 default)
- `/dev/cu.wchusbserial-*` (CH340)

If nothing appears, try:
1. Using a different USB cable (some are charge-only)
2. Restarting your Mac
3. Checking if the driver installed correctly

## Flashing and Monitoring Workflow

Once setup is complete, every time you want to flash or monitor:

### Activate the Virtual Environment

```bash
source .venv/bin/activate
```

You'll see `(.venv)` at your prompt. From this point, `esptool.py` and `pyserial` will be available.

### Prerequisites

Before running the tool, make sure:
- The ESP32 is connected via USB
- The virtual environment is activated: `source .venv/bin/activate`
- You know your serial port (from `ls /dev/cu.usb*`)

## Usage

Use the `esp32-tool.sh` script to flash and monitor:

```bash
./esp32-tool.sh                                        # flash + monitor (default port)
./esp32-tool.sh flash                                  # flash only
./esp32-tool.sh monitor                                # monitor only
./esp32-tool.sh flash-monitor /dev/cu.SLAB_USBtoUART   # custom port
./esp32-tool.sh flash-monitor /dev/cu.SLAB_USBtoUART ~/Downloads/roku-proxy-esp32  # custom firmware path
```

Note: You can find published ESP32 firmware images and version listings at https://roku.bluefin605.com/versions.

### Firmware Path

The firmware path defaults to `~/Downloads/roku-proxy-esp32` and expects this structure:

```
roku-proxy-esp32/
├── bootloader/bootloader.bin
├── partition_table/partition-table.bin
└── roku-proxy-esp32.bin
```

If your firmware is elsewhere, pass it as the third argument.

### Default Port

The script defaults to `/dev/cu.usbserial-1410`. If your port is different, run:

```bash
./esp32-tool.sh flash /dev/cu.SLAB_USBtoUART
```

or

```bash
./esp32-tool.sh monitor /dev/cu.wchusbserial-14410
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
- **CH340:** https://www.wch-ic.com/downloads/CH341SER_MAC_ZIP.html

## Serial monitor

The monitor uses `screen` if available, otherwise falls back to `python3` with `pyserial`.

**Activate the venv before monitoring:**

```bash
source .venv/bin/activate
./esp32-tool.sh monitor
```

### Exiting the monitor

| Monitor | How to exit |
|---------|------------|
| `screen` | `Ctrl+A` then `K` then `Y` |
| Python fallback | `Ctrl+C` |

If `screen` appears frozen or unresponsive, `Ctrl+A` then `\` force-kills it.

## First-time Wi-Fi setup

On first boot (or after a credential reset), the serial monitor will prompt for Wi-Fi configuration:

1. The ESP32 scans for nearby networks and displays a numbered list:
   ```
   =================================
     Roku Proxy — Wi-Fi Setup
   =================================

   Scanning for Wi-Fi networks...

     #  SSID                              RSSI  Auth
     ── ────────────────────────────────  ────  ────────
      1 Mitchell_2.4Ghz                    -47  WPA2
      2 Mitchell_5Ghz                      -52  WPA2
      3 Neighbours_WiFi                    -78  WPA2

   Enter Wi-Fi SSID (or number from list):
   ```
2. Type a **number** to select from the list (e.g., `1`), or type a **full SSID** manually
3. Enter the Wi-Fi password
4. Credentials are saved to NVS — the ESP32 will auto-connect on subsequent boots

### Resetting Wi-Fi credentials

Hold the **BOOT** button for 2 seconds during startup. The ESP32 will clear saved credentials and prompt again.

## Troubleshooting

### "esptool.py: command not found"

Make sure your virtual environment is activated:

```bash
source .venv/bin/activate
```

You should see `(.venv)` at the start of your prompt.

### "No serial ports found"

1. **Check if the ESP32 is plugged in:**
   ```bash
   ls /dev/cu.usb*
   ```

2. **Try a different USB cable** — some are charge-only with no data lines

3. **Restart your Mac** — sometimes USB drivers need a full reboot to activate

4. **Verify the USB driver installed:**
   - For CP2102: Check System Settings → Privacy & Security for any "blocked" installations
   - For CH340: Re-download and reinstall from https://www.wch-ic.com/downloads/CH341SER_MAC_ZIP.html

5. **Check dmesg for driver errors:**
   ```bash
   log stream --predicate 'process == "kernel"' | grep -i usb
   ```

### "Permission denied on port"

On rare occasions, you may need:

```bash
sudo chmod 666 /dev/cu.usbserial-1410
```

Or add yourself to dialout group:

```bash
sudo dseditgroup -o edit -a $USER -t user uucp
```

(Then restart your terminal)

### "Port busy" or "Device or resource busy"

Another process has the serial port open. Close:
- Arduino IDE
- Other terminal windows with serial monitors
- Any other active connections to the ESP32

Check what's using the port:

```bash
lsof /dev/cu.usb*
```

### "Flash fails with timeout"

The ESP32 may need to enter bootloader mode:

1. **Hold the BOOT button** on the ESP32
2. Start the flash: `./esp32-tool.sh flash`
3. **Release BOOT** after you see "Connecting..." in the terminal

### "Invalid serial port"

Double-check the port name:

```bash
ls /dev/cu.usb*
```

Then pass the correct port to the script:

```bash
./esp32-tool.sh monitor /dev/cu.SLAB_USBtoUART
```

Note: Do NOT include `/dev/cu.` twice. The port is just `cu.SLAB_USBtoUART`, not `/dev/cu./dev/cu.SLAB_USBtoUART`.

### "ModuleNotFoundError: No module named 'serial'"

The `pyserial` package isn't installed. With the venv activated:

```bash
pip install pyserial
```

### Still stuck?

Try these diagnostic steps:

```bash
# Check Python and esptool version
esptool.py version

# Check if pyserial is installed
python -c "import serial; print(serial.__version__)"

# Try USB reset (macOS)
system_profiler SPUSBDataType | grep -A5 "ESP32\|CP2102\|CH340"

# Check if screen is available
which screen
```
