#include "roku_session.h"
#include "roku_auth.h"
#include "esp_log.h"
#include "esp_websocket_client.h"
#include "cJSON.h"

#include <cstring>
#include <cstdio>
#include <string>

static const char* TAG = "session";

namespace roku {

const char* state_to_string(SessionState state) {
    switch (state) {
        case SessionState::Idle:           return "idle";
        case SessionState::Connecting:     return "connecting";
        case SessionState::Authenticating: return "authenticating";
        case SessionState::Streaming:      return "streaming";
        case SessionState::Error:          return "error";
    }
    return "unknown";
}

Session::Session(const std::string& roku_ip, const std::string& local_ip, int rtp_port)
    : roku_ip_(roku_ip), local_ip_(local_ip), rtp_port_(rtp_port) {}

Session::~Session() {
    stop();
}

void Session::set_state(SessionState s, const char* msg) {
    state_ = s;
    ESP_LOGI(TAG, "State: %s%s%s", state_to_string(s),
             msg && msg[0] ? " - " : "", msg ? msg : "");
    if (on_state_change_) {
        on_state_change_(s, msg ? msg : "", cb_ctx_);
    }
}

void Session::handle_message(const char* data, int len) {
    cJSON* j = cJSON_ParseWithLength(data, len);
    if (!j) {
        ESP_LOGW(TAG, "JSON parse error");
        return;
    }

    // Auth challenge from Roku
    cJSON* notify = cJSON_GetObjectItem(j, "notify");
    if (notify && cJSON_IsString(notify) && strcmp(notify->valuestring, "authenticate") == 0) {
        cJSON* challenge_item = cJSON_GetObjectItem(j, "param-challenge");
        const char* challenge = challenge_item && cJSON_IsString(challenge_item)
                                ? challenge_item->valuestring : "";

        std::string response = compute_auth_response(challenge);

        cJSON* reply = cJSON_CreateObject();
        cJSON_AddStringToObject(reply, "request", "authenticate");
        cJSON_AddStringToObject(reply, "request-id", "0");
        cJSON_AddStringToObject(reply, "param-response", response.c_str());

        char* json_str = cJSON_PrintUnformatted(reply);
        int ret = esp_websocket_client_send_text(
            static_cast<esp_websocket_client_handle_t>(ws_client_),
            json_str, strlen(json_str), pdMS_TO_TICKS(5000));
        free(json_str);
        cJSON_Delete(reply);
        if (ret < 0) {
            ESP_LOGE(TAG, "Failed to send auth response");
        } else {
            ESP_LOGI(TAG, "Sent auth response");
        }
    }
    // Response to our auth or set-audio-output
    else {
        cJSON* resp_item = cJSON_GetObjectItem(j, "response");
        cJSON* status_item = cJSON_GetObjectItem(j, "status");
        if (resp_item && cJSON_IsString(resp_item) && status_item && cJSON_IsString(status_item)) {
            const char* resp = resp_item->valuestring;
            const char* status = status_item->valuestring;

            if (strcmp(resp, "authenticate") == 0 && strcmp(status, "200") == 0) {
                // Auth succeeded — tell Roku where to send audio
                char audio_dest[128];
                snprintf(audio_dest, sizeof(audio_dest), "%s:%d:97:960",
                         local_ip_.c_str(), rtp_port_);

                cJSON* set_output = cJSON_CreateObject();
                cJSON_AddStringToObject(set_output, "request", "set-audio-output");
                cJSON_AddStringToObject(set_output, "request-id", "1");
                cJSON_AddStringToObject(set_output, "param-devname", audio_dest);
                cJSON_AddStringToObject(set_output, "param-audio-output", "datagram");

                char* json_str = cJSON_PrintUnformatted(set_output);
                int ret = esp_websocket_client_send_text(
                    static_cast<esp_websocket_client_handle_t>(ws_client_),
                    json_str, strlen(json_str), pdMS_TO_TICKS(5000));
                free(json_str);
                cJSON_Delete(set_output);
                if (ret < 0) {
                    ESP_LOGE(TAG, "Failed to send set-audio-output");
                } else {
                    ESP_LOGI(TAG, "Sent set-audio-output: %s", audio_dest);
                }
            }
            else if (strcmp(resp, "authenticate") == 0 && strcmp(status, "401") == 0) {
                set_state(SessionState::Error, "Authentication failed");
            }
            else if (strcmp(resp, "set-audio-output") == 0 && strcmp(status, "200") == 0) {
                set_state(SessionState::Streaming);
            }
            else if (strcmp(resp, "set-audio-output") == 0 && strcmp(status, "200") != 0) {
                char msg[64];
                snprintf(msg, sizeof(msg), "Failed to set audio output: %s", status);
                set_state(SessionState::Error, msg);
            }
        }
    }

    cJSON_Delete(j);
}

void Session::ws_event_handler(void* handler_args, esp_event_base_t base,
                                int32_t event_id, void* event_data) {
    Session* self = static_cast<Session*>(handler_args);
    esp_websocket_event_data_t* ws_data = static_cast<esp_websocket_event_data_t*>(event_data);

    switch (event_id) {
        case WEBSOCKET_EVENT_CONNECTED:
            ESP_LOGI(TAG, "WebSocket connected");
            self->set_state(SessionState::Authenticating);
            break;

        case WEBSOCKET_EVENT_DATA:
            if (ws_data->op_code == 0x01 && ws_data->data_len > 0) {
                // Text frame
                self->handle_message(ws_data->data_ptr, ws_data->data_len);
            }
            break;

        case WEBSOCKET_EVENT_ERROR:
            ESP_LOGE(TAG, "WebSocket error");
            self->set_state(SessionState::Error, "WebSocket error");
            break;

        case WEBSOCKET_EVENT_DISCONNECTED:
            ESP_LOGI(TAG, "WebSocket disconnected");
            if (self->state_ == SessionState::Streaming) {
                self->set_state(SessionState::Idle, "Session closed");
            }
            break;

        default:
            break;
    }
}

void Session::start(StateCallback on_state_change, void* ctx) {
    on_state_change_ = on_state_change;
    cb_ctx_ = ctx;
    set_state(SessionState::Connecting);

    std::string url = "ws://" + roku_ip_ + ":8060/ecp-session";

    esp_websocket_client_config_t ws_cfg = {};
    ws_cfg.uri = url.c_str();
    ws_cfg.subprotocol = "ecp-2";
    // Custom headers for Roku compatibility
    ws_cfg.headers = "Sec-WebSocket-Origin: Android\r\n";

    esp_websocket_client_handle_t client = esp_websocket_client_init(&ws_cfg);
    if (!client) {
        set_state(SessionState::Error, "Failed to init WebSocket client");
        return;
    }

    ws_client_ = client;

    esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY,
                                   ws_event_handler, this);

    esp_err_t err = esp_websocket_client_start(client);
    if (err != ESP_OK) {
        set_state(SessionState::Error, "Failed to start WebSocket client");
        esp_websocket_client_destroy(client);
        ws_client_ = nullptr;
    }
}

void Session::stop() {
    if (ws_client_) {
        esp_websocket_client_handle_t client =
            static_cast<esp_websocket_client_handle_t>(ws_client_);
        esp_err_t err = esp_websocket_client_close(client, pdMS_TO_TICKS(5000));
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "WebSocket close timed out, forcing destroy");
        }
        esp_websocket_client_destroy(client);
        ws_client_ = nullptr;
    }
    set_state(SessionState::Idle);
}

} // namespace roku
