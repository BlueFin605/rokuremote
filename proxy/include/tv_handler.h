#pragma once
#include <string>
#include <vector>
#include <memory>

namespace tv {

struct DiscoveredTv {
    std::string ip;
    std::string name;
};

// Abstract interface for controlling a TV. Protocol-specific subclasses
// (Panasonic SOAP, future brands) implement the actual communication.
// The HTTP route handler calls these methods — it never sees protocol details.
class TvHandler {
public:
    virtual ~TvHandler() = default;

    // Send a generic command: volume_up, volume_down, mute, power, hdmi1-hdmi4
    virtual bool sendKey(const std::string& ip, const std::string& action) = 0;

    // Get current volume level (0-100). Returns -1 on error.
    virtual int getVolume(const std::string& ip) = 0;

    // SSDP discovery for this TV type.
    virtual std::vector<DiscoveredTv> discover(int timeout_ms = 3000) = 0;

    // Factory: returns the handler for the given type, or nullptr if unsupported.
    static std::unique_ptr<TvHandler> create(const std::string& type);
};

} // namespace tv
