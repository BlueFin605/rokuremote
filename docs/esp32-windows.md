# ESP32-S3 Flashing & Monitoring on Windows

## Prerequisites

Install `esptool` via pip (requires Python):

```powershell
pip install esptool
```

Alternatively, if you have the Arduino ESP32 board package installed, `esptool.exe` is already at:
```
%LOCALAPPDATA%\Arduino15\packages\esp32\tools\esptool_py\5.1.0\esptool.exe
```

The `esp32-tool.ps1` script uses this path by default.

## Find your serial port

Plug in the XIAO ESP32-S3 via USB-C, then check Device Manager:

1. Open **Device Manager** (`Win+X` → Device Manager)
2. Expand **Ports (COM & LPT)**
3. Look for **USB Serial Device (COMx)** — the XIAO ESP32-S3 uses native USB, so no additional driver is needed

You can also check from PowerShell:

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

The default port in `esp32-tool.ps1` is `COM4`. If yours differs, pass `-Port COM5` (or whichever port you see).

## Download firmware

Download the `roku-proxy-esp32` artifact from the latest [Actions build](https://github.com/deanmitchell/RokuRemote/actions) and extract it to `%USERPROFILE%\Downloads\roku-proxy-esp32`. The expected structure:

```
roku-proxy-esp32/
├── bootloader/bootloader.bin
├── partition_table/partition-table.bin
└── roku-proxy-esp32.bin
```

## Usage

```powershell
.\esp32-tool.ps1                              # flash + monitor (default)
.\esp32-tool.ps1 flash                        # flash only
.\esp32-tool.ps1 monitor                      # monitor only
.\esp32-tool.ps1 flash -Port COM5             # custom port
.\esp32-tool.ps1 flash -FirmwarePath C:\path  # custom firmware path
```

## Serial monitor

The monitor opens a serial connection at 115200 baud. Type directly into the terminal to send input to the ESP32 (used for Wi-Fi setup).

Press `Ctrl+C` to exit the monitor.

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

| Problem | Fix |
|---------|-----|
| **Port not found** | Check Device Manager for the correct COM port number. Try a different USB-C cable — some are charge-only. |
| **Access denied on port** | Close any other program using the port (Arduino IDE, PuTTY, another terminal). |
| **Flash fails with timeout** | Hold the **BOOT** button on the XIAO while flashing starts, release after "Connecting..." appears. |
| **No COM port appears** | The XIAO ESP32-S3 uses native USB — try a different USB-C port. If still missing, install the [Espressif USB driver](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/dfu.html#usb-drivers). |
| **PowerShell blocks script** | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` to allow local scripts. |
