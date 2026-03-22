#include "ssdp_discovery.h"
#include "esp_log.h"
#include "esp_http_client.h"

#include "lwip/sockets.h"
#include "lwip/netdb.h"

#include <cstring>
#include <cstdio>

static const char* TAG = "ssdp";

namespace roku {

static const char* SSDP_MULTICAST = "239.255.255.250";
static const int SSDP_PORT = 1900;

static const char* MSEARCH =
    "M-SEARCH * HTTP/1.1\r\n"
    "Host: 239.255.255.250:1900\r\n"
    "Man: \"ssdp:discover\"\r\n"
    "ST: roku:ecp\r\n"
    "MX: 3\r\n"
    "\r\n";

static std::string extract_ip_from_location(const char* location) {
    // Location looks like: http://192.168.1.100:8060/
    char ip_buf[16] = {};
    if (sscanf(location, "http://%15[0-9.]:", ip_buf) == 1) {
        return std::string(ip_buf);
    }
    return "";
}

static std::string extract_header(const char* response, size_t resp_len, const char* header_name) {
    // Case-insensitive search for header
    size_t hdr_len = strlen(header_name);
    for (size_t i = 0; i + hdr_len + 1 < resp_len; i++) {
        bool match = true;
        for (size_t j = 0; j < hdr_len && match; j++) {
            char a = response[i + j];
            char b = header_name[j];
            if (a >= 'A' && a <= 'Z') a += 32;
            if (b >= 'A' && b <= 'Z') b += 32;
            if (a != b) match = false;
        }
        if (match && response[i + hdr_len] == ':') {
            size_t start = i + hdr_len + 1;
            while (start < resp_len && response[start] == ' ') start++;
            size_t end = start;
            while (end < resp_len && response[end] != '\r' && response[end] != '\n') end++;
            return std::string(response + start, end - start);
        }
    }
    return "";
}

static std::string get_xml_tag(const std::string& body, const char* tag) {
    std::string open = std::string("<") + tag + ">";
    std::string close_tag = std::string("</") + tag + ">";
    size_t start = body.find(open);
    if (start == std::string::npos) return "";
    start += open.size();
    size_t end = body.find(close_tag, start);
    if (end == std::string::npos) return "";
    return body.substr(start, end - start);
}

static void fetch_device_info(DiscoveredDevice& device) {
    std::string url = "http://" + device.ip + ":8060/query/device-info";

    esp_http_client_config_t config = {};
    config.url = url.c_str();
    config.timeout_ms = 3000;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return;

    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        esp_http_client_cleanup(client);
        return;
    }

    int content_length = esp_http_client_fetch_headers(client);
    if (content_length < 0) content_length = 4096;
    if (content_length > 4096) content_length = 4096;

    std::string body(content_length, '\0');
    int read_len = esp_http_client_read(client, &body[0], content_length);
    if (read_len > 0) {
        body.resize(read_len);
        device.name = get_xml_tag(body, "friendly-device-name");
        if (device.name.empty()) device.name = get_xml_tag(body, "default-device-name");
        if (device.name.empty()) device.name = "Roku";
        device.model = get_xml_tag(body, "model-name");
    }

    esp_http_client_close(client);
    esp_http_client_cleanup(client);
}

std::vector<DiscoveredDevice> discover_devices(int timeout_ms) {
    std::vector<DiscoveredDevice> devices;

    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        ESP_LOGE(TAG, "Failed to create SSDP socket");
        return devices;
    }

    int reuse = 1;
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    struct sockaddr_in dest = {};
    dest.sin_family = AF_INET;
    dest.sin_port = htons(SSDP_PORT);
    inet_aton(SSDP_MULTICAST, &dest.sin_addr);

    sendto(sock, MSEARCH, strlen(MSEARCH), 0,
           reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));

    struct timeval tv;
    tv.tv_sec = timeout_ms / 1000;
    tv.tv_usec = (timeout_ms % 1000) * 1000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    char buf[2048];
    // Track seen IPs with a simple array (won't have more than ~10 Rokus)
    std::string seen_ips[16];
    int seen_count = 0;

    while (true) {
        ssize_t n = recv(sock, buf, sizeof(buf) - 1, 0);
        if (n <= 0) break;
        buf[n] = '\0';

        std::string location = extract_header(buf, n, "Location");
        std::string ip = extract_ip_from_location(location.c_str());

        if (ip.empty()) continue;

        // Check for duplicate
        bool found = false;
        for (int i = 0; i < seen_count; i++) {
            if (seen_ips[i] == ip) { found = true; break; }
        }
        if (found || seen_count >= 16) continue;

        seen_ips[seen_count++] = ip;
        DiscoveredDevice device{ip, "", ""};
        fetch_device_info(device);
        devices.push_back(std::move(device));
    }

    close(sock);
    return devices;
}

} // namespace roku
