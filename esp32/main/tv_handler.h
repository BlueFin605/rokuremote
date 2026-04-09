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
class TvHandler {
public:
    virtual ~TvHandler() = default;

    virtual bool sendKey(const std::string& ip, const std::string& action) = 0;
    virtual int getVolume(const std::string& ip) = 0;
    virtual std::vector<DiscoveredTv> discover(int timeout_ms = 3000) = 0;

    static std::unique_ptr<TvHandler> create(const std::string& type);
};

} // namespace tv
