# Hardware I have

## ESP32 Board

**DOIT ESP32 DEVKIT V1** (ESP-WROOM-32 module)
- **Source:** https://www.aliexpress.com/item/1005008503831020.html

### Processor & Memory
| Spec | Value |
|------|-------|
| MCU | ESP32 (Xtensa dual-core 32-bit LX6) |
| Clock Speed | Up to 240 MHz |
| Flash | 4 MB |
| SRAM | 520 KB |
| ROM | 448 KB |

### Connectivity
| Spec | Value |
|------|-------|
| WiFi | 802.11 b/g/n (2.4 GHz) |
| Bluetooth | 4.2 (BR/EDR + BLE) |

### GPIO & Peripherals
| Spec | Value |
|------|-------|
| Digital I/O Pins | 30 exposed (40 total on chip) |
| ADC Channels | 16 (8x ADC1 on GPIO32-39, ADC2 shared with WiFi) |
| DAC Channels | 2x 8-bit (GPIO25, GPIO26) |
| PWM Pins | 19 |
| Touch Sensors | 10 capacitive |
| UART | 2 (primary via USB, secondary on GPIO16/GPIO17) |
| I2C | SDA GPIO21, SCL GPIO22 (reassignable) |
| SPI | VSPI (GPIO23/19/18/5) + HSPI (GPIO12-15) |

### Power & Physical
| Spec | Value |
|------|-------|
| USB | Micro-USB via CP2102 (or CH340 variant) |
| Input Voltage | 5V (USB or VIN pin) |
| Logic Level | 3.3V |
| Dimensions | 51.45mm x 23.37mm |
| Form Factor | Breadboard-friendly, 2x15 pin rows |

## Roku
- Roku Ultra (192.168.50.144)

# Hardware I have on Order

## Seeed Studio XIAO ESP32-S3

**XIAO ESP32-S3** (non-Sense variant, no camera)
- **Source:** https://www.aliexpress.com/item/1005007341749305.html

### Processor & Memory
| Spec | Value |
|------|-------|
| MCU | ESP32-S3 (Xtensa dual-core 32-bit LX7) |
| Clock Speed | Up to 240 MHz |
| Flash | 8 MB |
| SRAM | 512 KB |
| PSRAM | 8 MB |

### Connectivity
| Spec | Value |
|------|-------|
| WiFi | 802.11 b/g/n (2.4 GHz) |
| Bluetooth | 5.0 (BLE only, no Classic BT) |

### GPIO & Peripherals
| Spec | Value |
|------|-------|
| Digital I/O Pins | 11 usable |
| ADC Channels | 9 (12-bit) |
| UART | 1 |
| I2C | 1 |
| SPI | 1 |

### Power & Physical
| Spec | Value |
|------|-------|
| USB | USB-C (native USB on ESP32-S3) |
| Input Voltage | 5V (USB or battery) |
| Logic Level | 3.3V |
| Dimensions | 21mm x 17.5mm |
| Form Factor | XIAO ultra-compact, castellated pads |

### Notes
- Will need `idf.py set-target esp32s3` to retarget firmware build

# Boards Investigated but Not Suitable

## Seeed Studio XIAO ESP32-S3 Sense

**XIAO ESP32-S3 Sense** (with OV2640 camera + microSD slot)
- **Source:** https://a.aliexpress.com/_mPXwBA1

Identical to the XIAO ESP32-S3 (same ESP32-S3 chip, 8MB PSRAM, 8MB flash, WiFi/BLE 5.0) but adds an OV2640 camera module and microSD card slot.

### Why Not Suitable
- Camera and microSD are unnecessary for RokuRemote (WiFi networking, SSDP, audio proxy)
- Camera module consumes GPIO pins and draws additional power
- More expensive for no project benefit
- The non-Sense XIAO ESP32-S3 (on order) has identical networking/compute specs
