#include "ssdp_discovery.h"
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <cstring>
#include <sstream>
#include <iostream>
#include <regex>

// For fetching device info over HTTP
#include <httplib.h>

namespace roku {

static const char* SSDP_MULTICAST = "239.255.255.250";
static const int SSDP_PORT = 1900;

static const std::string MSEARCH =
    "M-SEARCH * HTTP/1.1\r\n"
    "Host: 239.255.255.250:1900\r\n"
    "Man: \"ssdp:discover\"\r\n"
    "ST: roku:ecp\r\n"
    "MX: 3\r\n"
    "\r\n";

static std::string extract_ip_from_location(const std::string& location) {
    // Location looks like: http://192.168.1.100:8060/
    std::regex re(R"(http://([0-9.]+):)");
    std::smatch match;
    if (std::regex_search(location, match, re) && match.size() > 1) {
        return match[1].str();
    }
    return "";
}

static std::string extract_header(const std::string& response, const std::string& header_name) {
    std::string lower_response = response;
    std::string lower_header = header_name;
    // Case-insensitive search
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

static void fetch_device_info(DiscoveredDevice& device) {
    httplib::Client cli("http://" + device.ip + ":8060");
    cli.set_connection_timeout(2);
    cli.set_read_timeout(2);

    auto res = cli.Get("/query/device-info");
    if (!res || res->status != 200) return;

    // Simple XML extraction
    auto get_tag = [&](const std::string& tag) -> std::string {
        std::string open = "<" + tag + ">";
        std::string close = "</" + tag + ">";
        size_t start = res->body.find(open);
        if (start == std::string::npos) return "";
        start += open.size();
        size_t end = res->body.find(close, start);
        if (end == std::string::npos) return "";
        return res->body.substr(start, end - start);
    };

    device.name = get_tag("friendly-device-name");
    if (device.name.empty()) device.name = get_tag("default-device-name");
    if (device.name.empty()) device.name = "Roku";
    device.model = get_tag("model-name");
}

std::vector<DiscoveredDevice> discover_devices(int timeout_ms) {
    std::vector<DiscoveredDevice> devices;

    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        std::cerr << "Failed to create SSDP socket\n";
        return devices;
    }

    int reuse = 1;
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    struct sockaddr_in dest{};
    dest.sin_family = AF_INET;
    dest.sin_port = htons(SSDP_PORT);
    inet_pton(AF_INET, SSDP_MULTICAST, &dest.sin_addr);

    sendto(sock, MSEARCH.c_str(), MSEARCH.size(), 0,
           reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));

    // Collect responses for timeout_ms
    struct timeval tv;
    tv.tv_sec = timeout_ms / 1000;
    tv.tv_usec = (timeout_ms % 1000) * 1000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

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
            DiscoveredDevice device{ip, "", ""};
            fetch_device_info(device);
            devices.push_back(std::move(device));
        }
    }

    close(sock);
    return devices;
}

} // namespace roku
