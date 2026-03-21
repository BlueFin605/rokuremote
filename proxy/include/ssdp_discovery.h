#pragma once
#include <string>
#include <vector>

namespace roku {

struct DiscoveredDevice {
    std::string ip;
    std::string name;
    std::string model;
};

// Sends an SSDP M-SEARCH for roku:ecp and collects responses.
// Blocks for up to timeout_ms milliseconds.
std::vector<DiscoveredDevice> discover_devices(int timeout_ms = 3000);

} // namespace roku
