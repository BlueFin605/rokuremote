#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-flash-monitor}"
PORT="${2:-/dev/cu.usbserial-1410}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIRMWARE_PATH="${3:-$SCRIPT_DIR/roku-proxy-esp32}"

# Find esptool — prefer esptool.py on PATH, fall back to common install locations
if command -v esptool.py &>/dev/null; then
    ESPTOOL="esptool.py"
elif command -v esptool &>/dev/null; then
    ESPTOOL="esptool"
else
    echo "Error: esptool not found. Install with: pip install esptool" >&2
    exit 1
fi

flash() {
    local bootloader="$FIRMWARE_PATH/bootloader/bootloader.bin"
    local partition="$FIRMWARE_PATH/partition_table/partition-table.bin"
    local app="$FIRMWARE_PATH/roku-proxy-esp32.bin"

    for f in "$bootloader" "$partition" "$app"; do
        if [[ ! -f "$f" ]]; then
            echo "Missing: $f" >&2
            exit 1
        fi
    done

    echo "Flashing to $PORT..."
    $ESPTOOL --chip esp32s3 --port "$PORT" --baud 460800 write_flash -z \
        0x0 "$bootloader" \
        0x8000 "$partition" \
        0x10000 "$app"

    echo "Flash complete."
}

monitor() {
    echo "Opening serial monitor on $PORT at 115200 baud. Press Ctrl+C to exit."
    # Use screen if available, otherwise python serial monitor
    if command -v screen &>/dev/null; then
        screen "$PORT" 115200
    elif command -v python3 &>/dev/null; then
        python3 -c "
import serial, sys
try:
    ser = serial.Serial('$PORT', 115200, timeout=0.5)
    ser.dtr = True
    while True:
        line = ser.readline()
        if line:
            sys.stdout.write(line.decode('utf-8', errors='replace'))
            sys.stdout.flush()
except KeyboardInterrupt:
    pass
finally:
    ser.close()
    print('\nSerial port closed.')
"
    else
        echo "Error: Need 'screen' or 'python3' with pyserial for monitoring" >&2
        exit 1
    fi
}

case "$COMMAND" in
    flash)         flash ;;
    monitor)       monitor ;;
    flash-monitor) flash; sleep 2; monitor ;;
    *)
        echo "Usage: $0 [flash|monitor|flash-monitor] [port] [firmware-path]"
        echo "  port defaults to /dev/cu.usbserial-0001"
        echo "  firmware-path defaults to ~/Downloads/roku-proxy-esp32"
        exit 1
        ;;
esac
