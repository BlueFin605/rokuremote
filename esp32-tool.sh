#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-flash-monitor}"
PORT_ARG="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIRMWARE_PATH_ARG="${3:-}"

resolve_firmware_path() {
    # Prefer local ESP-IDF build output if present, fall back to downloaded artifact folder.
    if [[ -n "$FIRMWARE_PATH_ARG" ]]; then
        printf '%s\n' "$FIRMWARE_PATH_ARG"
        return
    fi

    if [[ -d "$SCRIPT_DIR/esp32/build" ]]; then
        printf '%s\n' "$SCRIPT_DIR/esp32/build"
        return
    fi

    printf '%s\n' "$SCRIPT_DIR/roku-proxy-esp32"
}

FIRMWARE_PATH="$(resolve_firmware_path)"

detect_port() {
    # On XIAO ESP32-S3/macOS, native USB generally appears as /dev/cu.usbmodem*
    local ports=()
    local p

    shopt -s nullglob
    for p in /dev/cu.usbmodem*; do
        ports+=("$p")
    done
    if [[ ${#ports[@]} -eq 0 ]]; then
        for p in /dev/cu.usbserial*; do
            ports+=("$p")
        done
    fi
    shopt -u nullglob

    if [[ ${#ports[@]} -eq 0 ]]; then
        echo "Error: No serial ports found (/dev/cu.usbmodem* or /dev/cu.usbserial*)." >&2
        exit 1
    fi

    printf '%s\n' "${ports[0]}"
}

if [[ -n "$PORT_ARG" ]]; then
    PORT="$PORT_ARG"
else
    PORT="$(detect_port)"
fi

ensure_esptool() {
    # Find esptool — prefer esptool.py on PATH
    if command -v esptool.py &>/dev/null; then
        ESPTOOL="esptool.py"
    elif command -v esptool &>/dev/null; then
        ESPTOOL="esptool"
    else
        echo "Error: esptool not found. Install with: pip install esptool" >&2
        exit 1
    fi
}

flash() {
    ensure_esptool

    local bootloader="$FIRMWARE_PATH/bootloader/bootloader.bin"
    local partition="$FIRMWARE_PATH/partition_table/partition-table.bin"
    local app="$FIRMWARE_PATH/roku-proxy-esp32.bin"

    for f in "$bootloader" "$partition" "$app"; do
        if [[ ! -f "$f" ]]; then
            echo "Missing: $f" >&2
            exit 1
        fi
    done

    # Fail fast if a non-S3 image set is being flashed to ESP32-S3 hardware.
    local image_type
    image_type="$($ESPTOOL --chip auto image_info "$bootloader" 2>/dev/null | awk -F': ' '/Detected image type:/ {print $2; exit}')"
    if [[ "$image_type" != "ESP32-S3" ]]; then
        echo "Error: bootloader image type is '$image_type' (expected 'ESP32-S3')." >&2
        echo "Use ESP32-S3 artifacts (build in esp32/ with 'idf.py set-target esp32s3 && idf.py build')," >&2
        echo "or pass the correct firmware path as the 3rd argument." >&2
        exit 1
    fi

    echo "Flashing to $PORT..."
    $ESPTOOL --chip esp32s3 --port "$PORT" --baud 460800 write_flash -z \
        0x0 "$bootloader" \
        0x8000 "$partition" \
        0x10000 "$app"

    echo "Flash complete."
}

monitor() {
    # Use screen if available, otherwise python serial monitor
    if command -v screen &>/dev/null; then
        echo "Opening serial monitor on $PORT at 115200 baud. To exit: Ctrl+A, K, then Y."
        screen "$PORT" 115200
    elif command -v python3 &>/dev/null; then
        echo "Opening serial monitor on $PORT at 115200 baud. Press Ctrl+C to exit."
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
        echo "  port defaults to auto-detected /dev/cu.usbmodem* (fallback /dev/cu.usbserial*)"
        echo "  firmware-path defaults to $SCRIPT_DIR/esp32/build if present, else $SCRIPT_DIR/roku-proxy-esp32"
        exit 1
        ;;
esac
