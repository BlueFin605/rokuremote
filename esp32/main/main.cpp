#include "wifi_manager.h"
#include "http_server.h"
#include "sdkconfig.h"

#include "esp_log.h"
#include "nvs_flash.h"
#include "mdns.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char* TAG = "main";

extern "C" void app_main() {
    // Initialize NVS (required by Wi-Fi driver)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Connect to Wi-Fi (blocks until IP obtained)
    wifi_init_sta();
    std::string local_ip = wifi_get_ip();
    ESP_LOGI(TAG, "Local IP: %s", local_ip.c_str());

    // Start mDNS so the web app can find us at roku-proxy.local
    ESP_ERROR_CHECK(mdns_init());
    mdns_hostname_set("roku-proxy");
    mdns_instance_name_set("Roku Proxy");
    mdns_service_add(nullptr, "_http", "_tcp", CONFIG_PROXY_HTTP_PORT, nullptr, 0);
    ESP_LOGI(TAG, "mDNS hostname: roku-proxy.local");

    // Start HTTP API server
    start_http_server(CONFIG_PROXY_HTTP_PORT, local_ip, CONFIG_PROXY_RTP_PORT);

    ESP_LOGI(TAG, "Roku proxy ready on http://roku-proxy.local:%d", CONFIG_PROXY_HTTP_PORT);

    // Main task idles — all work happens in server/receiver tasks
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}
