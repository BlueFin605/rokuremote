#include "panasonic_handler.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "lwip/sockets.h"

#include <cstring>
#include <cstdio>
#include <sstream>

static const char* TAG = "panasonic";

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

std::string PanasonicHandler::extract_xml_tag(const std::string& xml,
                                               const std::string& tag) {
    std::string open = "<" + tag + ">";
    std::string close_tag = "</" + tag + ">";
    size_t start = xml.find(open);
    if (start == std::string::npos) return "";
    start += open.size();
    size_t end = xml.find(close_tag, start);
    if (end == std::string::npos) return "";
    return xml.substr(start, end - start);
}

// ESP32 SOAP request using esp_http_client.
// Collects the response body via an event handler.

struct SoapResponseCtx {
    std::string body;
};

static esp_err_t soap_http_event_handler(esp_http_client_event_t* evt) {
    auto* ctx = static_cast<SoapResponseCtx*>(evt->user_data);
    if (evt->event_id == HTTP_EVENT_ON_DATA && ctx) {
        ctx->body.append(static_cast<const char*>(evt->data), evt->data_len);
    }
    return ESP_OK;
}

std::string PanasonicHandler::soap_request(const std::string& ip,
                                            const std::string& path,
                                            const std::string& urn,
                                            const std::string& action,
                                            const std::string& params) {
    std::string body = build_soap_envelope(urn, action, params);
    std::string soap_action = "\"urn:" + urn + "#" + action + "\"";

    char url[128];
    snprintf(url, sizeof(url), "http://%s:%d%s", ip.c_str(), TV_PORT, path.c_str());

    SoapResponseCtx response_ctx;

    esp_http_client_config_t config = {};
    config.url = url;
    config.timeout_ms = TIMEOUT_MS;
    config.method = HTTP_METHOD_POST;
    config.event_handler = soap_http_event_handler;
    config.user_data = &response_ctx;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "Failed to create HTTP client for %s", url);
        return "";
    }

    esp_http_client_set_header(client, "Content-Type", "text/xml; charset=\"utf-8\"");
    esp_http_client_set_header(client, "SOAPAction", soap_action.c_str());
    esp_http_client_set_post_field(client, body.c_str(), body.size());

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "SOAP request failed: %s action=%s err=%s",
                 url, action.c_str(), esp_err_to_name(err));
        return "";
    }

    if (status != 200) {
        ESP_LOGE(TAG, "SOAP error %d: %s action=%s", status, url, action.c_str());
        return "";
    }

    return response_ctx.body;
}

bool PanasonicHandler::sendKey(const std::string& ip, const std::string& action) {
    auto it = action_to_nrc_.find(action);
    if (it == action_to_nrc_.end()) {
        ESP_LOGE(TAG, "Unknown action: %s", action.c_str());
        return false;
    }

    std::string params = "<X_KeyEvent>" + it->second + "</X_KeyEvent>";
    std::string response = soap_request(ip, NRC_PATH, NRC_URN, "X_SendKey", params);
    return !response.empty();
}

int PanasonicHandler::getVolume(const std::string& ip) {
    std::string params = "<InstanceID>0</InstanceID><Channel>Master</Channel>";
    std::string response = soap_request(ip, DMR_PATH, DMR_URN, "GetVolume", params);
    if (response.empty()) return -1;

    std::string vol = extract_xml_tag(response, "CurrentVolume");
    if (vol.empty()) return -1;

    int result = atoi(vol.c_str());
    return (vol == "0" || result > 0) ? result : -1;
}

// --- SSDP Discovery ---

static const char* SSDP_MULTICAST = "239.255.255.250";
static const int SSDP_PORT = 1900;

static const char* PANASONIC_MSEARCH =
    "M-SEARCH * HTTP/1.1\r\n"
    "Host: 239.255.255.250:1900\r\n"
    "Man: \"ssdp:discover\"\r\n"
    "ST: urn:panasonic-com:service:p00NetworkControl:1\r\n"
    "MX: 3\r\n"
    "\r\n";

static std::string extract_header(const char* response, size_t resp_len, const char* header_name) {
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

static std::string extract_ip_from_location(const char* location) {
    char ip_buf[16] = {};
    if (sscanf(location, "http://%15[0-9.]:", ip_buf) == 1) {
        return std::string(ip_buf);
    }
    return "";
}

static void fetch_panasonic_info(DiscoveredTv& device) {
    char url[128];
    snprintf(url, sizeof(url), "http://%s:%d/nrc/sdd_0.xml",
             device.ip.c_str(), PanasonicHandler::TV_PORT);

    SoapResponseCtx ctx;

    esp_http_client_config_t config = {};
    config.url = url;
    config.timeout_ms = 2000;
    config.event_handler = soap_http_event_handler;
    config.user_data = &ctx;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        device.name = "Panasonic TV";
        return;
    }

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status != 200 || ctx.body.empty()) {
        device.name = "Panasonic TV";
        return;
    }

    std::string name = PanasonicHandler::extract_xml_tag(ctx.body, "friendlyName");
    if (name.empty()) name = PanasonicHandler::extract_xml_tag(ctx.body, "modelName");
    device.name = name.empty() ? "Panasonic TV" : name;
}

std::vector<DiscoveredTv> PanasonicHandler::discover(int timeout_ms) {
    std::vector<DiscoveredTv> devices;

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

    sendto(sock, PANASONIC_MSEARCH, strlen(PANASONIC_MSEARCH), 0,
           reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));

    struct timeval tv;
    tv.tv_sec = timeout_ms / 1000;
    tv.tv_usec = (timeout_ms % 1000) * 1000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    char buf[2048];
    std::string seen_ips[8];
    int seen_count = 0;

    while (true) {
        ssize_t n = recv(sock, buf, sizeof(buf) - 1, 0);
        if (n <= 0) break;
        buf[n] = '\0';

        std::string location = extract_header(buf, n, "Location");
        std::string ip = extract_ip_from_location(location.c_str());

        if (ip.empty()) continue;

        bool found = false;
        for (int i = 0; i < seen_count; i++) {
            if (seen_ips[i] == ip) { found = true; break; }
        }
        if (found || seen_count >= 8) continue;

        seen_ips[seen_count++] = ip;
        DiscoveredTv device{ip, ""};
        fetch_panasonic_info(device);
        devices.push_back(std::move(device));
    }

    close(sock);
    return devices;
}

} // namespace tv
