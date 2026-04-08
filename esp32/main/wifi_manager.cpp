#include "wifi_manager.h"

#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_wifi_types.h"

#include <cstring>
#include <string>

static const char* TAG = "wifi";
static const char* NVS_NAMESPACE = "wifi_creds";
static const char* NVS_KEY_SSID = "ssid";
static const char* NVS_KEY_PASS = "password";
static const gpio_num_t BOOT_BUTTON = GPIO_NUM_0;

static EventGroupHandle_t s_wifi_event_group;
static const int CONNECTED_BIT = BIT0;
static esp_netif_t* s_sta_netif = nullptr;
static int s_retry_count = 0;
static const int MAX_RETRY = 10;

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

static bool load_credentials(std::string& ssid, std::string& password) {
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) {
        return false;
    }

    char buf[128];
    size_t len;

    len = sizeof(buf);
    if (nvs_get_str(handle, NVS_KEY_SSID, buf, &len) != ESP_OK) {
        nvs_close(handle);
        return false;
    }
    ssid = buf;

    len = sizeof(buf);
    if (nvs_get_str(handle, NVS_KEY_PASS, buf, &len) != ESP_OK) {
        nvs_close(handle);
        return false;
    }
    password = buf;

    nvs_close(handle);
    return !ssid.empty();
}

static void save_credentials(const std::string& ssid, const std::string& password) {
    nvs_handle_t handle;
    ESP_ERROR_CHECK(nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle));
    ESP_ERROR_CHECK(nvs_set_str(handle, NVS_KEY_SSID, ssid.c_str()));
    ESP_ERROR_CHECK(nvs_set_str(handle, NVS_KEY_PASS, password.c_str()));
    ESP_ERROR_CHECK(nvs_commit(handle));
    nvs_close(handle);
    ESP_LOGI(TAG, "Credentials saved to NVS");
}

static std::string read_line_from_serial() {
    std::string line;
    while (true) {
        int ch = fgetc(stdin);
        if (ch == EOF) {
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }
        if (ch == '\n' || ch == '\r') {
            if (!line.empty()) return line;
        } else {
            line += static_cast<char>(ch);
        }
    }
}

static void scan_and_list_networks() {
    wifi_scan_config_t scan_config = {};
    scan_config.show_hidden = false;

    ESP_LOGI(TAG, "Scanning for Wi-Fi networks...");
    printf("Scanning for Wi-Fi networks...\n");
    fflush(stdout);

    esp_wifi_scan_start(&scan_config, true);  // blocking scan

    uint16_t ap_count = 0;
    esp_wifi_scan_get_ap_num(&ap_count);
    if (ap_count > 20) ap_count = 20;  // cap at 20

    wifi_ap_record_t ap_records[20] = {};
    esp_wifi_scan_get_ap_records(&ap_count, ap_records);

    printf("\n  #  SSID                              RSSI  Auth\n");
    printf("  ── ────────────────────────────────  ────  ────────\n");
    for (int i = 0; i < ap_count; i++) {
        const char* auth;
        switch (ap_records[i].authmode) {
            case WIFI_AUTH_OPEN:         auth = "Open";    break;
            case WIFI_AUTH_WPA_PSK:      auth = "WPA";     break;
            case WIFI_AUTH_WPA2_PSK:     auth = "WPA2";    break;
            case WIFI_AUTH_WPA3_PSK:     auth = "WPA3";    break;
            case WIFI_AUTH_WPA_WPA2_PSK: auth = "WPA/2";   break;
            case WIFI_AUTH_WPA2_WPA3_PSK:auth = "WPA2/3";  break;
            default:                     auth = "Other";   break;
        }
        printf("  %2d %-34s %4d  %s\n",
               i + 1, (const char*)ap_records[i].ssid, ap_records[i].rssi, auth);
    }
    printf("\n");
    fflush(stdout);
}

static void prompt_credentials(std::string& ssid, std::string& password) {
    printf("\n=================================\n");
    printf("  Roku Proxy — Wi-Fi Setup\n");
    printf("=================================\n\n");

    scan_and_list_networks();

    printf("Enter Wi-Fi SSID (or number from list): ");
    fflush(stdout);
    std::string input = read_line_from_serial();
    printf("%s\n", input.c_str());

    // Check if input is a number (network selection)
    int selection = 0;
    if (!input.empty() && input.find_first_not_of("0123456789") == std::string::npos) {
        selection = std::stoi(input);
    }

    if (selection > 0) {
        // Re-scan to get the SSID (scan results may have been freed)
        wifi_scan_config_t scan_config = {};
        esp_wifi_scan_start(&scan_config, true);
        uint16_t ap_count = 0;
        esp_wifi_scan_get_ap_num(&ap_count);
        if (ap_count > 20) ap_count = 20;
        wifi_ap_record_t ap_records[20] = {};
        esp_wifi_scan_get_ap_records(&ap_count, ap_records);

        if (selection <= ap_count) {
            ssid = reinterpret_cast<const char*>(ap_records[selection - 1].ssid);
            printf("Selected: %s\n", ssid.c_str());
        } else {
            printf("Invalid selection, using as SSID.\n");
            ssid = input;
        }
    } else {
        ssid = input;
    }

    printf("Enter Wi-Fi Password: ");
    fflush(stdout);
    password = read_line_from_serial();
    printf("********\n");

    printf("\nConnecting to '%s'...\n\n", ssid.c_str());
}

static bool boot_button_held() {
    gpio_config_t cfg = {};
    cfg.pin_bit_mask = 1ULL << BOOT_BUTTON;
    cfg.mode = GPIO_MODE_INPUT;
    cfg.pull_up_en = GPIO_PULLUP_ENABLE;
    gpio_config(&cfg);

    // Check if BOOT button is held low for 2 seconds
    for (int i = 0; i < 20; i++) {
        if (gpio_get_level(BOOT_BUTTON) != 0) return false;
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    return true;
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

    // Start Wi-Fi radio in STA mode — needed before scanning or connecting
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Check if BOOT button is held — reset credentials
    if (boot_button_held()) {
        ESP_LOGW(TAG, "BOOT button held — clearing saved Wi-Fi credentials");
        wifi_clear_credentials();
    }

    std::string ssid, password;
    if (!load_credentials(ssid, password)) {
        prompt_credentials(ssid, password);
        save_credentials(ssid, password);
    } else {
        ESP_LOGI(TAG, "Loaded saved credentials for '%s'", ssid.c_str());
    }

    wifi_config_t wifi_config = {};
    strncpy(reinterpret_cast<char*>(wifi_config.sta.ssid),
            ssid.c_str(), sizeof(wifi_config.sta.ssid) - 1);
    strncpy(reinterpret_cast<char*>(wifi_config.sta.password),
            password.c_str(), sizeof(wifi_config.sta.password) - 1);
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    esp_wifi_connect();

    ESP_LOGI(TAG, "Connecting to %s...", ssid.c_str());

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

void wifi_clear_credentials() {
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_all(handle);
        nvs_commit(handle);
        nvs_close(handle);
        ESP_LOGI(TAG, "Wi-Fi credentials cleared");
    }
}
