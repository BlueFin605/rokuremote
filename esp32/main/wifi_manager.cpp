#include "wifi_manager.h"

#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_wifi_types.h"

#include <cstring>
#include <cstdio>

static const char* TAG = "wifi";
static const char* NVS_NAMESPACE = "wifi_creds";
static const char* NVS_KEY_SSID = "ssid";
static const char* NVS_KEY_PASS = "password";

static EventGroupHandle_t s_wifi_event_group;
static const int CONNECTED_BIT = BIT0;
static esp_netif_t* s_sta_netif = nullptr;
static int s_retry_count = 0;
static const int MAX_RETRY = 10;

// Read a line from UART (stdin), stripping trailing newline.
static void read_line(char* buf, size_t len) {
    size_t i = 0;
    while (i < len - 1) {
        int c = getchar();
        if (c == EOF) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        if (c == '\n' || c == '\r') {
            if (i > 0) break;
            continue;  // skip leading newlines
        }
        putchar(c);  // echo
        buf[i++] = static_cast<char>(c);
    }
    buf[i] = '\0';
    putchar('\n');
}

// Load credentials from NVS. Returns true if both SSID and password were found.
static bool load_credentials(char* ssid, size_t ssid_len, char* pass, size_t pass_len) {
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) return false;

    bool ok = true;
    size_t len = ssid_len;
    if (nvs_get_str(handle, NVS_KEY_SSID, ssid, &len) != ESP_OK) ok = false;
    len = pass_len;
    if (nvs_get_str(handle, NVS_KEY_PASS, pass, &len) != ESP_OK) ok = false;

    nvs_close(handle);
    return ok && ssid[0] != '\0';
}

// Save credentials to NVS.
static void save_credentials(const char* ssid, const char* pass) {
    nvs_handle_t handle;
    ESP_ERROR_CHECK(nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle));
    ESP_ERROR_CHECK(nvs_set_str(handle, NVS_KEY_SSID, ssid));
    ESP_ERROR_CHECK(nvs_set_str(handle, NVS_KEY_PASS, pass));
    ESP_ERROR_CHECK(nvs_commit(handle));
    nvs_close(handle);
    ESP_LOGI(TAG, "Credentials saved to NVS");
}

// Clear saved credentials from NVS.
void wifi_clear_credentials() {
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_all(handle);
        nvs_commit(handle);
        nvs_close(handle);
        ESP_LOGI(TAG, "Credentials cleared");
    }
}

static void event_handler(void* arg, esp_event_base_t event_base,
                           int32_t event_id, void* event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_count < MAX_RETRY) {
            int delay_ms = (s_retry_count < 3) ? 1000 : 5000;
            ESP_LOGW(TAG, "Disconnected, retrying in %d ms (attempt %d/%d)",
                     delay_ms, s_retry_count + 1, MAX_RETRY);
            vTaskDelay(pdMS_TO_TICKS(delay_ms));
            esp_wifi_connect();
            s_retry_count++;
        } else {
            ESP_LOGE(TAG, "Max retries reached, restarting Wi-Fi");
            s_retry_count = 0;
            vTaskDelay(pdMS_TO_TICKS(10000));
            esp_wifi_connect();
        }
        xEventGroupClearBits(s_wifi_event_group, CONNECTED_BIT);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = static_cast<ip_event_got_ip_t*>(event_data);
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_count = 0;
        xEventGroupSetBits(s_wifi_event_group, CONNECTED_BIT);
    }
}

void wifi_init_sta() {
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    s_sta_netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, nullptr, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, nullptr, nullptr));

    char ssid[33] = {};
    char password[65] = {};

    if (!load_credentials(ssid, sizeof(ssid), password, sizeof(password))) {
        // No saved credentials — prompt on serial console
        printf("\n");
        printf("=================================\n");
        printf("  Roku Proxy — Wi-Fi Setup\n");
        printf("=================================\n");
        printf("Wi-Fi SSID: ");
        read_line(ssid, sizeof(ssid));
        printf("Wi-Fi Password: ");
        read_line(password, sizeof(password));

        save_credentials(ssid, password);
    }

    wifi_config_t wifi_config = {};
    strncpy(reinterpret_cast<char*>(wifi_config.sta.ssid),
            ssid, sizeof(wifi_config.sta.ssid) - 1);
    strncpy(reinterpret_cast<char*>(wifi_config.sta.password),
            password, sizeof(wifi_config.sta.password) - 1);
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to %s...", ssid);

    // Block until connected
    xEventGroupWaitBits(s_wifi_event_group, CONNECTED_BIT,
                        pdFALSE, pdTRUE, portMAX_DELAY);

    // Disable WiFi power save — keeps radio always on for low-latency audio streaming
    esp_wifi_set_ps(WIFI_PS_NONE);
    ESP_LOGI(TAG, "WiFi power save disabled for audio streaming");
}

std::string wifi_get_ip() {
    esp_netif_ip_info_t ip_info;
    if (esp_netif_get_ip_info(s_sta_netif, &ip_info) == ESP_OK) {
        char buf[16];
        snprintf(buf, sizeof(buf), IPSTR, IP2STR(&ip_info.ip));
        return std::string(buf);
    }
    return "0.0.0.0";
}
