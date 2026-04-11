#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMMAND="flash-monitor"
PORT_ARG=""
CHIP="esp32s3"
CHIP_EXPLICIT=0
FIRMWARE_FLAVOR=""
FIRMWARE_PATH_ARG=""
FIRMWARE_URL_BASE=""
BOOTLOADER_OFFSET=""
PARTITION_OFFSET="0x8000"
APP_OFFSET="0x10000"
BOOTLOADER_RELATIVE_PATH="bootloader/bootloader.bin"
PARTITION_RELATIVE_PATH="partition_table/partition-table.bin"
APP_RELATIVE_PATH="roku-proxy-esp32.bin"
AUTO_SELECT_PORT=0
FORCE=0
ESPTOOL=""
ESPTOOL_PYMODULE=0

usage() {
    cat <<EOF
Usage:
  $0 [command] [port] [firmware-path]
  $0 [command] [options]

Commands:
  flash | monitor | flash-monitor | flash-url | flash-monitor-url | ports | full-reset

Options:
  -p, --port <port>
  -c, --chip <esp32|esp32s3>
  --firmware-flavor <name>
  --firmware-path <path>
  --firmware-url-base <url>
  --bootloader-offset <hex>
  --partition-offset <hex>
  --app-offset <hex>
  --bootloader-relative-path <path>
  --partition-relative-path <path>
  --app-relative-path <path>
  --auto-select-port
  --force

Defaults:
  firmware-path: $SCRIPT_DIR/esp32/build (if present), else $SCRIPT_DIR/roku-proxy-esp32
  chip: esp32s3
EOF
}

if [[ $# -gt 0 && "$1" != -* ]]; then
    COMMAND="$1"
    shift
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--port)
            PORT_ARG="${2:-}"
            shift 2
            ;;
        -c|--chip)
            CHIP="${2:-}"
            CHIP_EXPLICIT=1
            shift 2
            ;;
        --firmware-flavor)
            FIRMWARE_FLAVOR="${2:-}"
            shift 2
            ;;
        --firmware-path)
            FIRMWARE_PATH_ARG="${2:-}"
            shift 2
            ;;
        --firmware-url-base)
            FIRMWARE_URL_BASE="${2:-}"
            shift 2
            ;;
        --bootloader-offset)
            BOOTLOADER_OFFSET="${2:-}"
            shift 2
            ;;
        --partition-offset)
            PARTITION_OFFSET="${2:-}"
            shift 2
            ;;
        --app-offset)
            APP_OFFSET="${2:-}"
            shift 2
            ;;
        --bootloader-relative-path)
            BOOTLOADER_RELATIVE_PATH="${2:-}"
            shift 2
            ;;
        --partition-relative-path)
            PARTITION_RELATIVE_PATH="${2:-}"
            shift 2
            ;;
        --app-relative-path)
            APP_RELATIVE_PATH="${2:-}"
            shift 2
            ;;
        --auto-select-port)
            AUTO_SELECT_PORT=1
            shift
            ;;
        --force)
            FORCE=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            # Backward-compatible positional args: [port] [firmware-path]
            if [[ -z "$PORT_ARG" ]]; then
                PORT_ARG="$1"
            elif [[ -z "$FIRMWARE_PATH_ARG" ]]; then
                FIRMWARE_PATH_ARG="$1"
            else
                echo "Error: Unexpected argument '$1'" >&2
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ "$CHIP" != "esp32" && "$CHIP" != "esp32s3" ]]; then
    echo "Error: --chip must be 'esp32' or 'esp32s3'" >&2
    exit 1
fi

resolve_default_firmware_path() {
    # Prefer local ESP-IDF build output if present, fall back to local artifact folder.
    if [[ -d "$SCRIPT_DIR/esp32/build" ]]; then
        printf '%s\n' "$SCRIPT_DIR/esp32/build"
        return
    fi
    printf '%s\n' "$SCRIPT_DIR/roku-proxy-esp32"
}

resolve_base_firmware_path() {
    if [[ -n "$FIRMWARE_PATH_ARG" ]]; then
        printf '%s\n' "$FIRMWARE_PATH_ARG"
        return
    fi
    resolve_default_firmware_path
}

get_effective_source_path() {
    local base_path="$1"
    if [[ -z "$FIRMWARE_FLAVOR" ]]; then
        printf '%s\n' "$base_path"
        return
    fi

    local candidate="$base_path/$FIRMWARE_FLAVOR"
    if [[ -d "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return
    fi

    echo "Firmware flavor '$FIRMWARE_FLAVOR' requested, but folder not found: $candidate" >&2
    exit 1
}

list_ports() {
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
    if [[ ${#ports[@]} -eq 0 ]]; then
        for p in /dev/tty.usbmodem* /dev/tty.usbserial* /dev/ttyUSB* /dev/ttyACM*; do
            ports+=("$p")
        done
    fi
    shopt -u nullglob

    printf '%s\n' "${ports[@]}"
}

resolve_target_port() {
    local ports=()
    local p
    while IFS= read -r p; do
        [[ -n "$p" ]] && ports+=("$p")
    done < <(list_ports)

    if [[ -n "$PORT_ARG" ]]; then
        if [[ -e "$PORT_ARG" ]]; then
            printf '%s\n' "$PORT_ARG"
            return
        fi

        if [[ $AUTO_SELECT_PORT -eq 1 && ${#ports[@]} -eq 1 ]]; then
            echo "Requested port $PORT_ARG not available. Auto-selected ${ports[0]}." >&2
            printf '%s\n' "${ports[0]}"
            return
        fi

        echo "Selected port $PORT_ARG is not currently available." >&2
        if [[ ${#ports[@]} -gt 0 ]]; then
            echo "Available ports: ${ports[*]}" >&2
        else
            echo "No serial ports detected." >&2
        fi
        exit 1
    fi

    if [[ ${#ports[@]} -eq 0 ]]; then
        echo "Error: No serial ports found." >&2
        exit 1
    fi

    printf '%s\n' "${ports[0]}"
}

show_ports() {
    local ports=()
    local p
    while IFS= read -r p; do
        [[ -n "$p" ]] && ports+=("$p")
    done < <(list_ports)
    if [[ ${#ports[@]} -eq 0 ]]; then
        echo "No serial ports detected."
        return
    fi

    echo "Available serial ports:"
    printf '  %s\n' "${ports[@]}"
}

ensure_esptool() {
    # Find esptool — prefer esptool.py on PATH
    if command -v esptool.py &>/dev/null; then
        ESPTOOL="esptool.py"
    elif command -v esptool &>/dev/null; then
        ESPTOOL="esptool"
    elif command -v python3 &>/dev/null && python3 -m esptool version &>/dev/null; then
        ESPTOOL="python3"
        ESPTOOL_PYMODULE=1
    else
        echo "Error: esptool not found. Install with: pip install esptool" >&2
        exit 1
    fi
}

run_esptool() {
    if [[ $ESPTOOL_PYMODULE -eq 1 ]]; then
        "$ESPTOOL" -m esptool "$@"
    else
        "$ESPTOOL" "$@"
    fi
}

download_file() {
    local url="$1"
    local out="$2"
    if command -v curl &>/dev/null; then
        curl -fsSL "$url" -o "$out"
    elif command -v wget &>/dev/null; then
        wget -qO "$out" "$url"
    else
        echo "Error: curl or wget is required to download firmware." >&2
        exit 1
    fi
}

download_firmware_from_url() {
    local base_url="${1%/}"
    
    # If URL-based firmware and no explicit flavor, auto-append chip name
    # if URL doesn't already contain it (assumes URL structure like firmware/latest/{chip}/)
    if [[ -n "$base_url" && -z "$FIRMWARE_FLAVOR" ]] && [[ "$base_url" != *"/$CHIP" ]]; then
        base_url="$base_url/$CHIP"
    fi
    
    if [[ -n "$FIRMWARE_FLAVOR" && "${base_url##*/}" != "$FIRMWARE_FLAVOR" ]]; then
        base_url="$base_url/$FIRMWARE_FLAVOR"
    fi

    local download_root
    download_root="$(mktemp -d "${TMPDIR:-/tmp}/roku-proxy-esp32-XXXXXXXX")"
    local download_base="$download_root"
    if [[ -n "$FIRMWARE_FLAVOR" ]]; then
        download_base="$download_root/$FIRMWARE_FLAVOR"
    fi
    mkdir -p "$download_base"

    local rel
    for rel in "$BOOTLOADER_RELATIVE_PATH" "$PARTITION_RELATIVE_PATH" "$APP_RELATIVE_PATH"; do
        local url="$base_url/$rel"
        local out="$download_base/$rel"
        mkdir -p "$(dirname "$out")"
        echo "Downloading $url" >&2
        download_file "$url" "$out"
    done

    echo "$download_root"
}

flash() {
    ensure_esptool

    local source_path="${1:-}"
    if [[ -z "$source_path" ]]; then
        source_path="$(resolve_base_firmware_path)"
    fi

    local effective_source
    effective_source="$(get_effective_source_path "$source_path")"

    local bootloader="$effective_source/$BOOTLOADER_RELATIVE_PATH"
    local partition="$effective_source/$PARTITION_RELATIVE_PATH"
    local app="$effective_source/$APP_RELATIVE_PATH"

    for f in "$bootloader" "$partition" "$app"; do
        if [[ ! -f "$f" ]]; then
            echo "Missing: $f" >&2
            exit 1
        fi
    done

    local target_port
    target_port="$(resolve_target_port)"

    local bootloader_offset="$BOOTLOADER_OFFSET"
    if [[ -z "$bootloader_offset" ]]; then
        if [[ "$CHIP" == "esp32" ]]; then
            bootloader_offset="0x1000"
        else
            bootloader_offset="0x0"
        fi
    fi

    # Verify image type when esptool can report it to avoid wrong-target flashes.
    local expected_type
    local image_type
    local image_info
    if [[ "$CHIP" == "esp32" ]]; then
        expected_type="ESP32"
    else
        expected_type="ESP32-S3"
    fi
    if ! image_info="$(run_esptool --chip auto image_info "$bootloader" 2>/dev/null)"; then
        echo "Error: bootloader is not a valid ESP image: $bootloader" >&2
        echo "The firmware URL may be returning HTML fallback content instead of binary files." >&2
        exit 1
    fi
    image_type="$(printf '%s\n' "$image_info" | awk -F': ' '/Detected image type:/ {print $2; exit}')"
    if [[ -n "$image_type" && "$image_type" != "$expected_type" ]]; then
        echo "Error: bootloader image type is '$image_type' (expected '$expected_type')." >&2
        exit 1
    fi

    echo "Flashing $CHIP to $target_port..."
    run_esptool --chip "$CHIP" --port "$target_port" --baud 460800 write_flash -z \
        "$bootloader_offset" "$bootloader" \
        "$PARTITION_OFFSET" "$partition" \
        "$APP_OFFSET" "$app"

    echo "Flash complete."
}

monitor() {
    local target_port
    target_port="$(resolve_target_port)"

    # Use screen if available, otherwise python serial monitor
    if command -v screen &>/dev/null; then
        echo "Opening serial monitor on $target_port at 115200 baud. To exit: Ctrl+A, K, then Y."
        screen "$target_port" 115200
    elif command -v python3 &>/dev/null; then
        echo "Opening serial monitor on $target_port at 115200 baud. Press Ctrl+C to exit."
        python3 -c "
import serial, sys
try:
    ser = serial.Serial('$target_port', 115200, timeout=0.5)
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
    print('\\nSerial port closed.')
"
    else
        echo "Error: Need 'screen' or 'python3' with pyserial for monitoring" >&2
        exit 1
    fi
}

full_reset() {
    ensure_esptool

    local target_port
    target_port="$(resolve_target_port)"

    if [[ $FORCE -ne 1 ]]; then
        echo "WARNING: full-reset will erase all flash contents on $target_port."
        echo "This clears firmware, credentials, and stored settings."
        read -r -p "Type ERASE to continue: " confirmation
        if [[ "$confirmation" != "ERASE" ]]; then
            echo "Full reset canceled."
            return
        fi
    fi

    local chip_candidates=("$CHIP")
    if [[ $CHIP_EXPLICIT -eq 0 ]]; then
        if [[ "$CHIP" == "esp32s3" ]]; then
            chip_candidates+=("esp32")
        else
            chip_candidates+=("esp32s3")
        fi
    fi

    local candidate
    for candidate in "${chip_candidates[@]}"; do
        if [[ "$candidate" != "$CHIP" ]]; then
            echo "Chip auto-fallback: retrying full reset with '$candidate'."
        fi
        echo "Erasing full flash on $target_port (chip: $candidate)..."
        if run_esptool --chip "$candidate" --port "$target_port" erase_flash; then
            echo "Full reset complete. Reflash firmware before normal operation."
            return
        fi
    done

    echo "Full reset failed." >&2
    exit 1
}

case "$COMMAND" in
    flash)
        flash
        ;;
    monitor)
        monitor
        ;;
    flash-monitor)
        flash
        sleep 2
        monitor
        ;;
    flash-url)
        if [[ -z "$FIRMWARE_URL_BASE" ]]; then
            echo "--firmware-url-base is required for flash-url" >&2
            exit 1
        fi
        download_path="$(download_firmware_from_url "$FIRMWARE_URL_BASE")"
        trap '[[ -n "${download_path:-}" ]] && rm -rf "$download_path"' EXIT
        flash "$download_path"
        ;;
    flash-monitor-url)
        if [[ -z "$FIRMWARE_URL_BASE" ]]; then
            echo "--firmware-url-base is required for flash-monitor-url" >&2
            exit 1
        fi
        download_path="$(download_firmware_from_url "$FIRMWARE_URL_BASE")"
        trap '[[ -n "${download_path:-}" ]] && rm -rf "$download_path"' EXIT
        flash "$download_path"
        sleep 2
        monitor
        ;;
    ports)
        show_ports
        ;;
    full-reset)
        full_reset
        ;;
    *)
        usage
        exit 1
        ;;
esac
