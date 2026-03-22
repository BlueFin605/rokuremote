#include "http_server.h"
#include "roku_session.h"
#include "rtp_receiver.h"
#include "ssdp_discovery.h"
#include "audio_buffer.h"

#include "esp_http_server.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "cJSON.h"

#include <cstring>
#include <cstdio>
#include <string>
#include <memory>

static const char* TAG = "httpd";

// Global state — single session at a time
static std::string g_local_ip;
static int g_rtp_port;
static std::unique_ptr<roku::Session> g_session;
static std::unique_ptr<roku::RtpReceiver> g_receiver;
static AudioBuffer g_audio_buffer;
static volatile roku::SessionState g_current_state = roku::SessionState::Idle;
static char g_last_error[128] = {};
static httpd_handle_t g_server = nullptr;

// ---- Helpers ----

static void set_cors_headers(httpd_req_t* req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "*");
}

static esp_err_t send_json(httpd_req_t* req, int status, const char* json) {
    httpd_resp_set_status(req, status == 200 ? "200 OK" :
                                status == 400 ? "400 Bad Request" :
                                status == 502 ? "502 Bad Gateway" : "500 Error");
    httpd_resp_set_type(req, "application/json");
    set_cors_headers(req);
    return httpd_resp_send(req, json, strlen(json));
}

// Extract query parameter value. Returns empty string if not found.
static std::string get_query_param(httpd_req_t* req, const char* key) {
    size_t buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len <= 1) return "";

    char* buf = static_cast<char*>(malloc(buf_len));
    if (!buf) return "";

    if (httpd_req_get_url_query_str(req, buf, buf_len) != ESP_OK) {
        free(buf);
        return "";
    }

    char val[256] = {};
    esp_err_t err = httpd_query_key_value(buf, key, val, sizeof(val));
    free(buf);

    if (err != ESP_OK) return "";
    return std::string(val);
}

// Extract the path after /roku/ from the URI (before the query string)
static std::string get_roku_path(httpd_req_t* req) {
    const char* uri = req->uri;
    // Skip "/roku/"
    const char* path_start = uri + 6;
    const char* query = strchr(path_start, '?');
    if (query) {
        return "/" + std::string(path_start, query - path_start);
    }
    return "/" + std::string(path_start);
}

static void stop_session() {
    if (g_session) {
        g_session->stop();
        g_session.reset();
    }
    if (g_receiver) {
        g_receiver->stop();
        g_receiver.reset();
    }
    g_current_state = roku::SessionState::Idle;
    g_last_error[0] = '\0';
}

static void on_rtp_frame(const uint8_t* data, size_t len,
                          uint32_t timestamp, uint16_t seq, void* ctx) {
    (void)timestamp;
    (void)seq;
    (void)ctx;
    g_audio_buffer.push(data, len);
}

static void on_session_state(roku::SessionState state, const char* msg, void* ctx) {
    (void)ctx;
    g_current_state = state;
    if (state == roku::SessionState::Error && msg) {
        strncpy(g_last_error, msg, sizeof(g_last_error) - 1);
        g_last_error[sizeof(g_last_error) - 1] = '\0';
    }
}

// ---- Route Handlers ----

static esp_err_t options_handler(httpd_req_t* req) {
    set_cors_headers(req);
    httpd_resp_set_status(req, "204 No Content");
    return httpd_resp_send(req, nullptr, 0);
}

static esp_err_t discover_handler(httpd_req_t* req) {
    auto devices = roku::discover_devices(3000);

    cJSON* arr = cJSON_CreateArray();
    for (const auto& d : devices) {
        cJSON* obj = cJSON_CreateObject();
        cJSON_AddStringToObject(obj, "ip", d.ip.c_str());
        cJSON_AddStringToObject(obj, "name", d.name.c_str());
        cJSON_AddStringToObject(obj, "model", d.model.c_str());
        cJSON_AddItemToArray(arr, obj);
    }

    char* json = cJSON_PrintUnformatted(arr);
    esp_err_t ret = send_json(req, 200, json);
    free(json);
    cJSON_Delete(arr);
    return ret;
}

static esp_err_t start_handler(httpd_req_t* req) {
    std::string roku_ip = get_query_param(req, "roku");
    if (roku_ip.empty()) {
        return send_json(req, 400, "{\"error\":\"Missing roku parameter\"}");
    }

    stop_session();
    g_audio_buffer.clear();

    // Start RTP receiver
    g_receiver = std::make_unique<roku::RtpReceiver>(g_rtp_port);
    g_receiver->set_rtcp_target(roku_ip);
    g_receiver->start(on_rtp_frame, nullptr);

    // Start WebSocket session
    g_session = std::make_unique<roku::Session>(roku_ip, g_local_ip, g_rtp_port);
    g_session->start(on_session_state, nullptr);

    return send_json(req, 200, "{\"status\":\"starting\"}");
}

static esp_err_t stop_handler(httpd_req_t* req) {
    stop_session();
    return send_json(req, 200, "{\"status\":\"stopped\"}");
}

static esp_err_t status_handler(httpd_req_t* req) {
    cJSON* j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "state", roku::state_to_string(g_current_state));
    if (g_current_state == roku::SessionState::Error) {
        cJSON_AddStringToObject(j, "error", g_last_error);
    }

    char* json = cJSON_PrintUnformatted(j);
    esp_err_t ret = send_json(req, 200, json);
    free(json);
    cJSON_Delete(j);
    return ret;
}

static esp_err_t audio_handler(httpd_req_t* req) {
    httpd_resp_set_type(req, "application/octet-stream");
    set_cors_headers(req);

    AudioFrame frame;
    while (true) {
        uint16_t len = g_audio_buffer.pop(frame, 1000);
        if (len > 0) {
            // 2-byte big-endian length + frame data
            uint8_t prefix[2] = {
                static_cast<uint8_t>((len >> 8) & 0xFF),
                static_cast<uint8_t>(len & 0xFF)
            };
            if (httpd_resp_send_chunk(req, reinterpret_cast<char*>(prefix), 2) != ESP_OK) break;
            if (httpd_resp_send_chunk(req, reinterpret_cast<char*>(frame.data), len) != ESP_OK) break;
        } else {
            // Keepalive — zero-length frame
            uint8_t zero[2] = {0, 0};
            if (httpd_resp_send_chunk(req, reinterpret_cast<char*>(zero), 2) != ESP_OK) break;
        }
    }

    // End chunked response
    httpd_resp_send_chunk(req, nullptr, 0);
    return ESP_OK;
}

static esp_err_t roku_get_handler(httpd_req_t* req) {
    std::string roku_ip = get_query_param(req, "ip");
    if (roku_ip.empty()) {
        return send_json(req, 400, "{\"error\":\"Missing ip parameter\"}");
    }

    std::string path = get_roku_path(req);
    std::string url = "http://" + roku_ip + ":8060" + path;

    esp_http_client_config_t config = {};
    config.url = url.c_str();
    config.timeout_ms = 3000;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        return send_json(req, 502, "{\"error\":\"Could not reach Roku\"}");
    }

    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        esp_http_client_cleanup(client);
        return send_json(req, 502, "{\"error\":\"Could not reach Roku\"}");
    }

    int content_length = esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);

    // Read response body
    char body[4096] = {};
    int read_len = 0;
    if (content_length > 0 && content_length < (int)sizeof(body)) {
        read_len = esp_http_client_read(client, body, content_length);
    } else if (content_length < 0) {
        // Chunked or unknown length
        read_len = esp_http_client_read(client, body, sizeof(body) - 1);
    }
    if (read_len < 0) read_len = 0;
    body[read_len] = '\0';

    // Get content type
    char ct_buf[128] = "text/xml";
    // esp_http_client doesn't have a direct header getter for response headers,
    // so we default to text/xml which is what Roku ECP returns

    char status_str[32];
    snprintf(status_str, sizeof(status_str), "%d", status);
    httpd_resp_set_status(req, status_str);
    httpd_resp_set_type(req, ct_buf);
    set_cors_headers(req);

    esp_http_client_close(client);
    esp_http_client_cleanup(client);

    return httpd_resp_send(req, body, read_len);
}

static esp_err_t roku_post_handler(httpd_req_t* req) {
    std::string roku_ip = get_query_param(req, "ip");
    if (roku_ip.empty()) {
        return send_json(req, 400, "{\"error\":\"Missing ip parameter\"}");
    }

    std::string path = get_roku_path(req);
    std::string url = "http://" + roku_ip + ":8060" + path;

    esp_http_client_config_t config = {};
    config.url = url.c_str();
    config.timeout_ms = 3000;
    config.method = HTTP_METHOD_POST;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        return send_json(req, 502, "{\"error\":\"Could not reach Roku\"}");
    }

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);

    char body[2048] = {};
    int read_len = 0;
    if (err == ESP_OK) {
        read_len = esp_http_client_get_content_length(client);
        if (read_len > (int)sizeof(body) - 1) read_len = sizeof(body) - 1;
        // Body was already consumed by perform(), we can't re-read it easily
        // For POST to Roku ECP, responses are typically empty or short
    }

    char status_str[32];
    snprintf(status_str, sizeof(status_str), "%d", status);
    httpd_resp_set_status(req, status_str);
    httpd_resp_set_type(req, "text/xml");
    set_cors_headers(req);

    esp_http_client_cleanup(client);

    return httpd_resp_send(req, body, read_len > 0 ? read_len : 0);
}

// ---- Server Setup ----

void start_http_server(int port, const std::string& local_ip, int rtp_port) {
    g_local_ip = local_ip;
    g_rtp_port = rtp_port;

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = port;
    config.stack_size = 8192;
    config.max_uri_handlers = 12;
    config.uri_match_fn = httpd_uri_match_wildcard;
    config.lru_purge_enable = true;
    // Allow enough open sockets for /audio streaming + other requests
    config.max_open_sockets = 4;

    esp_err_t err = httpd_start(&g_server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return;
    }

    // Register routes — order matters for wildcard matching

    // OPTIONS preflight (wildcard)
    httpd_uri_t options_uri = {
        .uri = "/*",
        .method = HTTP_OPTIONS,
        .handler = options_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &options_uri);

    // GET /discover
    httpd_uri_t discover_uri = {
        .uri = "/discover",
        .method = HTTP_GET,
        .handler = discover_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &discover_uri);

    // POST /start
    httpd_uri_t start_uri = {
        .uri = "/start",
        .method = HTTP_POST,
        .handler = start_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &start_uri);

    // POST /stop
    httpd_uri_t stop_uri = {
        .uri = "/stop",
        .method = HTTP_POST,
        .handler = stop_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &stop_uri);

    // GET /status
    httpd_uri_t status_uri = {
        .uri = "/status",
        .method = HTTP_GET,
        .handler = status_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &status_uri);

    // GET /audio
    httpd_uri_t audio_uri = {
        .uri = "/audio",
        .method = HTTP_GET,
        .handler = audio_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &audio_uri);

    // GET /roku/* — forward to Roku ECP
    httpd_uri_t roku_get_uri = {
        .uri = "/roku/*",
        .method = HTTP_GET,
        .handler = roku_get_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &roku_get_uri);

    // POST /roku/* — forward to Roku ECP
    httpd_uri_t roku_post_uri = {
        .uri = "/roku/*",
        .method = HTTP_POST,
        .handler = roku_post_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &roku_post_uri);

    ESP_LOGI(TAG, "HTTP server started on port %d", port);
}

void stop_http_server() {
    stop_session();
    if (g_server) {
        httpd_stop(g_server);
        g_server = nullptr;
    }
}
