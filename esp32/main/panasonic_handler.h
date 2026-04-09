#pragma once
#include "tv_handler.h"
#include <string>
#include <unordered_map>

namespace tv {

class PanasonicHandler : public TvHandler {
public:
    PanasonicHandler();

    bool sendKey(const std::string& ip, const std::string& action) override;
    int getVolume(const std::string& ip) override;
    std::vector<DiscoveredTv> discover(int timeout_ms = 3000) override;

    static constexpr int TV_PORT = 55000;
    static constexpr int TIMEOUT_MS = 3000;

    static std::string extract_xml_tag(const std::string& xml, const std::string& tag);

private:
    static constexpr const char* NRC_PATH = "/nrc/control_0";
    static constexpr const char* NRC_URN = "panasonic-com:service:p00NetworkControl:1";
    static constexpr const char* DMR_PATH = "/dmr/control_0";
    static constexpr const char* DMR_URN = "schemas-upnp-org:service:RenderingControl:1";

    std::unordered_map<std::string, std::string> action_to_nrc_;

    static std::string build_soap_envelope(const std::string& urn,
                                           const std::string& action,
                                           const std::string& params);

    // Send SOAP request via esp_http_client. Returns response body or empty on error.
    static std::string soap_request(const std::string& ip,
                                    const std::string& path,
                                    const std::string& urn,
                                    const std::string& action,
                                    const std::string& params);
};

} // namespace tv
