#include "panasonic_handler.h"
#include <httplib.h>
#include <iostream>
#include <sstream>
#include <regex>
#include "net_compat.h"
#include <set>

namespace tv {

// --- Factory ---

std::unique_ptr<TvHandler> TvHandler::create(const std::string& type) {
    if (type == "panasonic") {
        return std::make_unique<PanasonicHandler>();
    }
    return nullptr;
}

// --- PanasonicHandler ---

PanasonicHandler::PanasonicHandler() {
    action_to_nrc_ = {
        {"volume_up",   "NRC_VOLUP-ONOFF"},
        {"volume_down", "NRC_VOLDOWN-ONOFF"},
        {"mute",        "NRC_MUTE-ONOFF"},
        {"power",       "NRC_POWER-ONOFF"},
        {"hdmi1",       "NRC_HDMI1-ONOFF"},
        {"hdmi2",       "NRC_HDMI2-ONOFF"},
        {"hdmi3",       "NRC_HDMI3-ONOFF"},
        {"hdmi4",       "NRC_HDMI4-ONOFF"},
    };
}

std::string PanasonicHandler::build_soap_envelope(const std::string& urn,
                                                   const std::string& action,
                                                   const std::string& params) {
    std::ostringstream ss;
    ss << "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
       << "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\""
       << " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
       << "<s:Body>"
       << "<u:" << action << " xmlns:u=\"urn:" << urn << "\">"
       << params
       << "</u:" << action << ">"
       << "</s:Body>"
       << "</s:Envelope>";
    return ss.str();
}

std::string PanasonicHandler::soap_request(const std::string& ip,
                                            const std::string& path,
                                            const std::string& urn,
                                            const std::string& action,
                                            const std::string& params) {
    std::string body = build_soap_envelope(urn, action, params);
    std::string soap_action = "\"urn:" + urn + "#" + action + "\"";

    httplib::Client client(ip, TV_PORT);
    client.set_address_family(AF_INET);
    client.set_connection_timeout(TIMEOUT_SEC);
    client.set_read_timeout(TIMEOUT_SEC);

    httplib::Headers headers = {
        {"Content-Type", "text/xml; charset=\"utf-8\""},
        {"SOAPAction", soap_action},
    };

    auto result = client.Post(path, headers, body, "text/xml; charset=\"utf-8\"");
    if (!result) {
        std::cerr << "[panasonic] SOAP request failed: " << ip << path
                  << " action=" << action << "\n";
        return "";
    }

    if (result->status != 200) {
        std::cerr << "[panasonic] SOAP error " << result->status << ": "
                  << ip << path << " action=" << action << "\n";
        return "";
    }

    return result->body;
}

std::string PanasonicHandler::extract_xml_tag(const std::string& xml,
                                               const std::string& tag) {
    std::string open = "<" + tag + ">";
    std::string close = "</" + tag + ">";
    size_t start = xml.find(open);
    if (start == std::string::npos) return "";
    start += open.size();
    size_t end = xml.find(close, start);
    if (end == std::string::npos) return "";
    return xml.substr(start, end - start);
}

bool PanasonicHandler::sendKey(const std::string& ip, const std::string& action) {
    // Mute uses the DMR RenderingControl endpoint (toggle via GetMute/SetMute)
    // because NRC_MUTE-ONOFF is unreliable on many Panasonic models.
    if (action == "mute") {
        return toggleMute(ip);
    }

    auto it = action_to_nrc_.find(action);
    if (it == action_to_nrc_.end()) {
        std::cerr << "[panasonic] Unknown action: " << action << "\n";
        return false;
    }

    std::string params = "<X_KeyEvent>" + it->second + "</X_KeyEvent>";
    std::string response = soap_request(ip, NRC_PATH, NRC_URN, "X_SendKey", params);
    return !response.empty();
}

bool PanasonicHandler::getMute(const std::string& ip) {
    std::string params = "<InstanceID>0</InstanceID><Channel>Master</Channel>";
    std::string response = soap_request(ip, DMR_PATH, DMR_URN, "GetMute", params);
    if (response.empty()) return false;

    std::string muted = extract_xml_tag(response, "CurrentMute");
    return muted == "1" || muted == "true";
}

bool PanasonicHandler::setMute(const std::string& ip, bool mute) {
    std::string params =
        "<InstanceID>0</InstanceID>"
        "<Channel>Master</Channel>"
        "<DesiredMute>" + std::string(mute ? "1" : "0") + "</DesiredMute>";
    std::string response = soap_request(ip, DMR_PATH, DMR_URN, "SetMute", params);
    return !response.empty();
}

bool PanasonicHandler::toggleMute(const std::string& ip) {
    bool current = getMute(ip);
    return setMute(ip, !current);
}

int PanasonicHandler::getVolume(const std::string& ip) {
    std::string params = "<InstanceID>0</InstanceID><Channel>Master</Channel>";
    std::string response = soap_request(ip, DMR_PATH, DMR_URN, "GetVolume", params);
    if (response.empty()) return -1;

    std::string vol = extract_xml_tag(response, "CurrentVolume");
    if (vol.empty()) return -1;

    try {
        return std::stoi(vol);
    } catch (...) {
        return -1;
    }
}

// --- SSDP Discovery ---

static const char* SSDP_MULTICAST = "239.255.255.250";
static const int SSDP_PORT = 1900;

static const std::string PANASONIC_MSEARCH =
    "M-SEARCH * HTTP/1.1\r\n"
    "Host: 239.255.255.250:1900\r\n"
    "Man: \"ssdp:discover\"\r\n"
    "ST: urn:panasonic-com:service:p00NetworkControl:1\r\n"
    "MX: 3\r\n"
    "\r\n";

static std::string extract_header(const std::string& response, const std::string& header_name) {
    std::string lower_response = response;
    std::string lower_header = header_name;
    for (auto& c : lower_response) c = std::tolower(c);
    for (auto& c : lower_header) c = std::tolower(c);

    size_t pos = lower_response.find(lower_header + ":");
    if (pos == std::string::npos) return "";

    size_t start = pos + lower_header.size() + 1;
    while (start < response.size() && response[start] == ' ') start++;

    size_t end = response.find("\r\n", start);
    if (end == std::string::npos) end = response.size();

    return response.substr(start, end - start);
}

static std::string extract_ip_from_location(const std::string& location) {
    std::regex re(R"(http://([0-9.]+):)");
    std::smatch match;
    if (std::regex_search(location, match, re) && match.size() > 1) {
        return match[1].str();
    }
    return "";
}

static void fetch_panasonic_device_info(DiscoveredTv& device) {
    // Fetch the device description XML from the TV
    httplib::Client cli(device.ip, 55000);
    cli.set_connection_timeout(2);
    cli.set_read_timeout(2);

    auto res = cli.Get("/nrc/sdd_0.xml");
    if (!res || res->status != 200) {
        device.name = "Panasonic TV";
        return;
    }

    // Extract friendly name from device description
    std::string name = PanasonicHandler::extract_xml_tag(res->body, "friendlyName");
    if (name.empty()) name = PanasonicHandler::extract_xml_tag(res->body, "modelName");
    device.name = name.empty() ? "Panasonic TV" : name;
}

std::vector<DiscoveredTv> PanasonicHandler::discover(int timeout_ms) {
    std::vector<DiscoveredTv> devices;

    socket_handle_t sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock == INVALID_SOCKET_HANDLE) {
        std::cerr << "[panasonic] Failed to create SSDP socket\n";
        return devices;
    }

    int reuse = 1;
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&reuse), sizeof(reuse));

    struct sockaddr_in dest{};
    dest.sin_family = AF_INET;
    dest.sin_port = htons(SSDP_PORT);
    inet_pton(AF_INET, SSDP_MULTICAST, &dest.sin_addr);

    sendto(sock, PANASONIC_MSEARCH.c_str(), PANASONIC_MSEARCH.size(), 0,
           reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));

    struct timeval tv;
    tv.tv_sec = timeout_ms / 1000;
    tv.tv_usec = (timeout_ms % 1000) * 1000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&tv), sizeof(tv));

    char buf[2048];
    std::set<std::string> seen_ips;

    while (true) {
        ssize_t n = recv(sock, buf, sizeof(buf) - 1, 0);
        if (n <= 0) break;
        buf[n] = '\0';

        std::string response(buf, n);
        std::string location = extract_header(response, "Location");
        std::string ip = extract_ip_from_location(location);

        if (!ip.empty() && seen_ips.find(ip) == seen_ips.end()) {
            seen_ips.insert(ip);
            DiscoveredTv device{ip, ""};
            fetch_panasonic_device_info(device);
            devices.push_back(std::move(device));
        }
    }

    close_socket(sock);
    return devices;
}

} // namespace tv
