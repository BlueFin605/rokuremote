#pragma once

#include <string>

// Initialize Wi-Fi in STA mode and connect. Blocks until IP is obtained.
void wifi_init_sta();

// Get the current local IP address as a string.
std::string wifi_get_ip();

// Clear saved Wi-Fi credentials from NVS. On next boot, will prompt again.
void wifi_clear_credentials();
