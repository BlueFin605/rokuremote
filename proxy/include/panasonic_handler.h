#pragma once
#include "tv_handler.h"
#include <string>
#include <unordered_map>

namespace tv {

// Controls Panasonic Viera TVs via SOAP over HTTP (port 55000).
// Handles unencrypted commands only — pairing/encryption is a future addition.
class PanasonicHandler : public TvHandler {
public:
    PanasonicHandler();

    bool sendKey(const std::string& ip, const std::string& action) override;
    int getVolume(const std::string& ip) override;
    std::vector<DiscoveredTv> discover(int timeout_ms = 3000) override;

private:
    bool getMute(const std::string& ip);
    bool setMute(const std::string& ip, bool mute);
    bool toggleMute(const std::string& ip);

    // Public for use by discovery helper
    static constexpr int TV_PORT = 55000;

private:
    static constexpr int TIMEOUT_SEC = 3;

    // NRC endpoint for remote control commands
    static constexpr const char* NRC_PATH = "/nrc/control_0";
    static constexpr const char* NRC_URN = "panasonic-com:service:p00NetworkControl:1";

    // DMR endpoint for volume/mute
    static constexpr const char* DMR_PATH = "/dmr/control_0";
    static constexpr const char* DMR_URN = "schemas-upnp-org:service:RenderingControl:1";

    // Maps generic actions to NRC key codes
    std::unordered_map<std::string, std::string> action_to_nrc_;

    // Build a SOAP envelope for a given URN, action name, and inner params XML
    static std::string build_soap_envelope(const std::string& urn,
                                           const std::string& action,
                                           const std::string& params);

    // Send a SOAP request and return the response body. Empty string on error.
    static std::string soap_request(const std::string& ip,
                                    const std::string& path,
                                    const std::string& urn,
                                    const std::string& action,
                                    const std::string& params);

public:
    // Extract a tag value from XML (simple, no namespace handling)
    static std::string extract_xml_tag(const std::string& xml, const std::string& tag);
};

} // namespace tv
