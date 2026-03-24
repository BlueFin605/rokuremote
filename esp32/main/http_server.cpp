#include "http_server.h"
#include "roku_session.h"
#include "rtp_receiver.h"
#include "ssdp_discovery.h"
#include "audio_buffer.h"

#include "esp_http_server.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "cJSON.h"
#include "lwip/sockets.h"

#include <cstdlib>
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
    httpd_resp_set_hdr(req, "Access-Control-Allow-Private-Network", "true");
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

// Extract the path after /api/roku/ from the URI (before the query string)
static std::string get_roku_path(httpd_req_t* req) {
    const char* uri = req->uri;
    // Skip "/api/roku/"
    const char* path_start = uri + 10;
    const char* query = strchr(path_start, '?');
    if (query) {
        return "/" + std::string(path_start, query - path_start);
    }
    return "/" + std::string(path_start);
}

// ---- Static File Serving ----

#include "web_files.h"

static const char* get_content_type(const char* uri) {
    const char* ext = strrchr(uri, '.');
    if (!ext) return "application/octet-stream";
    if (strcmp(ext, ".html") == 0) return "text/html";
    if (strcmp(ext, ".js") == 0) return "application/javascript";
    if (strcmp(ext, ".css") == 0) return "text/css";
    if (strcmp(ext, ".json") == 0) return "application/json";
    if (strcmp(ext, ".webmanifest") == 0) return "application/manifest+json";
    if (strcmp(ext, ".svg") == 0) return "image/svg+xml";
    if (strcmp(ext, ".png") == 0) return "image/png";
    if (strcmp(ext, ".ico") == 0) return "image/x-icon";
    return "application/octet-stream";
}

static bool has_hash_in_name(const char* uri) {
    // Hashed filenames look like: main-35MFZUI3.js, styles-IC22XOQN.css
    const char* dot = strrchr(uri, '.');
    if (!dot) return false;
    const char* dash = dot;
    while (dash > uri && *dash != '-' && *dash != '/') dash--;
    return *dash == '-' && (dot - dash) > 4;
}

static esp_err_t static_file_handler(httpd_req_t* req) {
    const char* uri = req->uri;

    // Don't serve static files for API routes
    if (strncmp(uri, "/api/", 5) == 0) {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "Not found");
        return ESP_FAIL;
    }

    // Look up the file in the embedded web files table
    const WebFile* file = nullptr;
    for (int i = 0; i < web_file_count; i++) {
        if (strcmp(uri, web_files[i].uri) == 0) {
            file = &web_files[i];
            break;
        }
    }

    // SPA fallback: serve index.html for unrecognised paths
    if (!file) {
        for (int i = 0; i < web_file_count; i++) {
            if (strcmp(web_files[i].uri, "/index.html") == 0) {
                file = &web_files[i];
                break;
            }
        }
    }

    if (!file) {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "Not found");
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, file->content_type);
    if (file->gzipped) {
        httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    }

    // Cache headers: immutable for hashed files, no-cache for index/manifest
    if (has_hash_in_name(uri)) {
        httpd_resp_set_hdr(req, "Cache-Control", "public, max-age=31536000, immutable");
    } else {
        httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    }

    return httpd_resp_send(req, reinterpret_cast<const char*>(file->data), file->size);
}

static void stop_session() {
    // Stop receiver first — its tasks exit quickly via event groups.
    // Session WebSocket close can take longer, so do it second.
    if (g_receiver) {
        g_receiver->stop();
        g_receiver.reset();
    }
    if (g_session) {
        g_session->stop();
        g_session.reset();
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

    // Disable Nagle — send audio chunks immediately instead of buffering
    int sockfd = httpd_req_to_sockfd(req);
    if (sockfd >= 0) {
        int flag = 1;
        setsockopt(sockfd, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));
    }

    // Combined buffer: 2-byte length prefix + max frame data in one write
    uint8_t send_buf[2 + sizeof(AudioFrame::data)];
    AudioFrame frame;

    while (true) {
        uint16_t len = g_audio_buffer.pop(frame, 200);
        if (len > 0) {
            // Pack prefix + frame into single buffer to avoid two TCP writes
            send_buf[0] = static_cast<uint8_t>((len >> 8) & 0xFF);
            send_buf[1] = static_cast<uint8_t>(len & 0xFF);
            memcpy(send_buf + 2, frame.data, len);
            if (httpd_resp_send_chunk(req, reinterpret_cast<char*>(send_buf), 2 + len) != ESP_OK) break;
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
    config.stack_size = 10240;
    config.max_uri_handlers = 20;
    config.uri_match_fn = httpd_uri_match_wildcard;
    config.lru_purge_enable = true;
    // Allow enough open sockets for /audio streaming + other requests
    // Audio stream holds 1 socket long-term; need headroom for status/stop/roku proxy
    config.max_open_sockets = 7;

    esp_err_t err = httpd_start(&g_server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return;
    }

    // Register routes — order matters for wildcard matching
    // API routes registered first (more specific), then static file wildcard last

    // OPTIONS preflight (wildcard)
    httpd_uri_t options_uri = {
        .uri = "/*",
        .method = HTTP_OPTIONS,
        .handler = options_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &options_uri);

    // GET /api/discover
    httpd_uri_t discover_uri = {
        .uri = "/api/discover",
        .method = HTTP_GET,
        .handler = discover_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &discover_uri);

    // POST /api/start
    httpd_uri_t start_uri = {
        .uri = "/api/start",
        .method = HTTP_POST,
        .handler = start_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &start_uri);

    // POST /api/stop
    httpd_uri_t stop_uri = {
        .uri = "/api/stop",
        .method = HTTP_POST,
        .handler = stop_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &stop_uri);

    // GET /api/status
    httpd_uri_t status_uri = {
        .uri = "/api/status",
        .method = HTTP_GET,
        .handler = status_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &status_uri);

    // GET /api/audio
    httpd_uri_t audio_uri = {
        .uri = "/api/audio",
        .method = HTTP_GET,
        .handler = audio_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &audio_uri);

    // GET /api/roku/* — forward to Roku ECP
    httpd_uri_t roku_get_uri = {
        .uri = "/api/roku/*",
        .method = HTTP_GET,
        .handler = roku_get_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &roku_get_uri);

    // POST /api/roku/* — forward to Roku ECP
    httpd_uri_t roku_post_uri = {
        .uri = "/api/roku/*",
        .method = HTTP_POST,
        .handler = roku_post_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &roku_post_uri);

    // GET /* — static file serving (SPA fallback)
    httpd_uri_t static_uri = {
        .uri = "/*",
        .method = HTTP_GET,
        .handler = static_file_handler,
        .user_ctx = nullptr
    };
    httpd_register_uri_handler(g_server, &static_uri);

    ESP_LOGI(TAG, "HTTP server started on port %d", port);
}

void stop_http_server() {
    stop_session();
    if (g_server) {
        httpd_stop(g_server);
        g_server = nullptr;
    }
}
