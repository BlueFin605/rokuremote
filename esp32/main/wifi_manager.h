#pragma once

#include <string>

// Initialize Wi-Fi in STA mode and connect. Blocks until IP is obtained.
// On first boot (or after reset), prompts for SSID/password via serial.
// Credentials are saved to NVS for subsequent boots.
void wifi_init_sta();

// Get the current local IP address as a string.
std::string wifi_get_ip();

// Clear saved Wi-Fi credentials from NVS. Requires reboot to take effect.
void wifi_clear_credentials();
