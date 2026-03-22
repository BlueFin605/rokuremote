#include "rtp_receiver.h"
#include "esp_log.h"

#include "lwip/sockets.h"
#include "lwip/netdb.h"

#include <cstring>

static const char* TAG = "rtp";

namespace roku {

static const size_t RTP_HEADER_SIZE = 12;

// RTCP APP packet constants
static const uint32_t VDLY_NAME = 0x56444C59; // "VDLY"
static const uint32_t CVER_NAME = 0x43564552; // "CVER"
static const uint32_t XDLY_NAME = 0x58444C59; // "XDLY"
static const uint32_t NCLI_NAME = 0x4E434C49; // "NCLI"
static const uint32_t CVER_VALUE = 0x30303032; // "0002"
static const uint32_t VDLY_VALUE = 200000;    // 200ms sync delay
static const int RTCP_APP_PORT = 6971;

RtpReceiver::RtpReceiver(int port) : port_(port) {}

RtpReceiver::~RtpReceiver() {
    stop();
}

void RtpReceiver::set_rtcp_target(const std::string& roku_ip, int rtcp_port) {
    rtcp_target_ip_ = roku_ip;
    rtcp_target_port_ = rtcp_port;
}

void RtpReceiver::recv_task_fn(void* arg) {
    static_cast<RtpReceiver*>(arg)->recv_loop();
    vTaskDelete(nullptr);
}

void RtpReceiver::rtcp_task_fn(void* arg) {
    static_cast<RtpReceiver*>(arg)->rtcp_loop();
    vTaskDelete(nullptr);
}

void RtpReceiver::start(FrameCallback on_frame, void* ctx) {
    if (running_) return;

    on_frame_ = on_frame;
    cb_ctx_ = ctx;

    socket_fd_ = socket(AF_INET, SOCK_DGRAM, 0);
    if (socket_fd_ < 0) {
        ESP_LOGE(TAG, "Failed to create UDP socket");
        return;
    }

    int reuse = 1;
    setsockopt(socket_fd_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port_);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(socket_fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0) {
        ESP_LOGE(TAG, "Failed to bind UDP port %d", port_);
        close(socket_fd_);
        socket_fd_ = -1;
        return;
    }

    running_ = true;
    packets_received_ = 0;
    last_seq_ = 0;
    ssrc_ = 0;

    xTaskCreate(recv_task_fn, "rtp_recv", 4096, this, 5, &recv_task_);

    if (!rtcp_target_ip_.empty()) {
        xTaskCreate(rtcp_task_fn, "rtcp_send", 4096, this, 4, &rtcp_task_);
        ESP_LOGI(TAG, "RTCP sender started -> %s:%d", rtcp_target_ip_.c_str(), rtcp_target_port_);
    }

    ESP_LOGI(TAG, "RTP receiver listening on UDP port %d", port_);
}

void RtpReceiver::recv_loop() {
    uint8_t buf[2048];

    while (running_) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(socket_fd_, &fds);

        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = 100000; // 100ms

        int ret = select(socket_fd_ + 1, &fds, nullptr, nullptr, &tv);
        if (ret <= 0) continue;

        ssize_t n = recv(socket_fd_, buf, sizeof(buf), 0);
        if (n <= static_cast<ssize_t>(RTP_HEADER_SIZE)) continue;

        // Parse RTP header
        uint16_t seq = (static_cast<uint16_t>(buf[2]) << 8) | buf[3];
        uint32_t timestamp = (static_cast<uint32_t>(buf[4]) << 24) |
                             (static_cast<uint32_t>(buf[5]) << 16) |
                             (static_cast<uint32_t>(buf[6]) << 8) |
                             buf[7];
        uint32_t ssrc = (static_cast<uint32_t>(buf[8]) << 24) |
                        (static_cast<uint32_t>(buf[9]) << 16) |
                        (static_cast<uint32_t>(buf[10]) << 8) |
                        buf[11];

        ssrc_ = ssrc;
        packets_received_++;
        last_seq_ = seq;

        // CSRC count
        int cc = buf[0] & 0x0F;
        size_t header_len = RTP_HEADER_SIZE + cc * 4;

        // Extension bit
        if (buf[0] & 0x10) {
            if (n < static_cast<ssize_t>(header_len + 4)) continue;
            uint16_t ext_len = (static_cast<uint16_t>(buf[header_len + 2]) << 8) |
                               buf[header_len + 3];
            header_len += 4 + ext_len * 4;
        }

        if (n <= static_cast<ssize_t>(header_len)) continue;

        const uint8_t* payload = buf + header_len;
        size_t payload_len = n - header_len;

        if (on_frame_) {
            on_frame_(payload, payload_len, timestamp, seq, cb_ctx_);
        }
    }
}

// Build an RTCP APP packet (type 204)
static void build_app_packet(uint8_t* buf, uint32_t ssrc, uint32_t name, uint32_t value) {
    buf[0] = 0x80;       // V=2, subtype=0
    buf[1] = 204;        // PT = APP
    buf[2] = 0x00;
    buf[3] = 0x03;       // Length = 3
    buf[4] = (ssrc >> 24) & 0xFF;
    buf[5] = (ssrc >> 16) & 0xFF;
    buf[6] = (ssrc >> 8) & 0xFF;
    buf[7] = ssrc & 0xFF;
    buf[8]  = (name >> 24) & 0xFF;
    buf[9]  = (name >> 16) & 0xFF;
    buf[10] = (name >> 8) & 0xFF;
    buf[11] = name & 0xFF;
    buf[12] = (value >> 24) & 0xFF;
    buf[13] = (value >> 16) & 0xFF;
    buf[14] = (value >> 8) & 0xFF;
    buf[15] = value & 0xFF;
}

// Build an RTCP Receiver Report (type 201)
static void build_rr_packet(uint8_t* buf, uint32_t our_ssrc, uint32_t sender_ssrc, uint32_t seq) {
    memset(buf, 0, 32);
    buf[0] = 0x81;  // V=2, RC=1
    buf[1] = 201;   // PT = RR
    buf[2] = 0x00;
    buf[3] = 0x07;  // Length = 7
    buf[4] = (our_ssrc >> 24) & 0xFF;
    buf[5] = (our_ssrc >> 16) & 0xFF;
    buf[6] = (our_ssrc >> 8) & 0xFF;
    buf[7] = our_ssrc & 0xFF;
    buf[8]  = (sender_ssrc >> 24) & 0xFF;
    buf[9]  = (sender_ssrc >> 16) & 0xFF;
    buf[10] = (sender_ssrc >> 8) & 0xFF;
    buf[11] = sender_ssrc & 0xFF;
    buf[16] = (seq >> 24) & 0xFF;
    buf[17] = (seq >> 16) & 0xFF;
    buf[18] = (seq >> 8) & 0xFF;
    buf[19] = seq & 0xFF;
}

void RtpReceiver::rtcp_loop() {
    struct sockaddr_in dest = {};
    dest.sin_family = AF_INET;
    dest.sin_port = htons(rtcp_target_port_);
    inet_aton(rtcp_target_ip_.c_str(), &dest.sin_addr);

    // Listen on port 6971 for RTCP APP responses from Roku (XDLY, NCLI)
    int app_fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (app_fd >= 0) {
        int reuse = 1;
        setsockopt(app_fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
        struct sockaddr_in app_addr = {};
        app_addr.sin_family = AF_INET;
        app_addr.sin_port = htons(RTCP_APP_PORT);
        app_addr.sin_addr.s_addr = INADDR_ANY;
        if (bind(app_fd, reinterpret_cast<struct sockaddr*>(&app_addr), sizeof(app_addr)) < 0) {
            ESP_LOGE(TAG, "Failed to bind RTCP APP port %d", RTCP_APP_PORT);
            close(app_fd);
            app_fd = -1;
        }
    }

    uint8_t pkt[32];
    bool vdly_sent = false;
    bool cver_sent = false;
    bool xdly_received = false;
    bool ncli_received = false;
    bool handshake_done = false;
    uint32_t vdly_value = VDLY_VALUE;

    // Wait 1 second for SSRC to stabilize
    vTaskDelay(pdMS_TO_TICKS(1000));

    auto check_app_responses = [&]() {
        if (app_fd < 0) return;
        uint8_t buf[256];
        fd_set fds;
        struct timeval tv;

        for (;;) {
            FD_ZERO(&fds);
            FD_SET(app_fd, &fds);
            tv = {0, 10000}; // 10ms
            if (select(app_fd + 1, &fds, nullptr, nullptr, &tv) <= 0) break;

            ssize_t n = recv(app_fd, buf, sizeof(buf), 0);
            if (n < 12) continue;

            if (n >= 12) {
                char name_str[5] = {(char)buf[8], (char)buf[9], (char)buf[10], (char)buf[11], 0};
                ESP_LOGI(TAG, "APP port recv: %d bytes, PT=%d name=%s", (int)n, (int)buf[1], name_str);
            }

            if (n < 12 || buf[1] != 204) continue;

            uint32_t name = (static_cast<uint32_t>(buf[8]) << 24) |
                            (static_cast<uint32_t>(buf[9]) << 16) |
                            (static_cast<uint32_t>(buf[10]) << 8) |
                            buf[11];

            if (name == XDLY_NAME && n >= 16) {
                uint32_t roku_delay = (static_cast<uint32_t>(buf[12]) << 24) |
                                      (static_cast<uint32_t>(buf[13]) << 16) |
                                      (static_cast<uint32_t>(buf[14]) << 8) |
                                      buf[15];
                ESP_LOGI(TAG, "Received XDLY (delay=%lu)", (unsigned long)roku_delay);

                if (roku_delay != vdly_value) {
                    ESP_LOGI(TAG, "Delay mismatch, re-sending VDLY with %lu", (unsigned long)roku_delay);
                    vdly_value = roku_delay;
                    vdly_sent = false;
                } else {
                    xdly_received = true;
                }
            } else if (name == NCLI_NAME) {
                ESP_LOGI(TAG, "Received NCLI");
                ncli_received = true;
            }
        }
    };

    while (running_) {
        if (!handshake_done) {
            if (!vdly_sent) {
                build_app_packet(pkt, 0, VDLY_NAME, vdly_value);
                sendto(socket_fd_, pkt, 16, 0,
                       reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));
                ESP_LOGI(TAG, "Sent VDLY (delay=%lu)", (unsigned long)vdly_value);
                vdly_sent = true;
            }

            check_app_responses();

            if (xdly_received && !cver_sent) {
                build_app_packet(pkt, 0, CVER_NAME, CVER_VALUE);
                sendto(socket_fd_, pkt, 16, 0,
                       reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));
                ESP_LOGI(TAG, "Sent CVER");
                cver_sent = true;
            }

            check_app_responses();

            if (xdly_received && ncli_received) {
                ESP_LOGI(TAG, "RTCP handshake complete");
                handshake_done = true;
            }

            if (cver_sent) {
                uint32_t sender_ssrc = ssrc_;
                uint32_t seq = last_seq_;
                build_rr_packet(pkt, 0x12345678, sender_ssrc, seq);
                sendto(socket_fd_, pkt, 32, 0,
                       reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));
            }
        } else {
            uint32_t sender_ssrc = ssrc_;
            uint32_t seq = last_seq_;
            build_rr_packet(pkt, 0x12345678, sender_ssrc, seq);
            sendto(socket_fd_, pkt, 32, 0,
                   reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));

            check_app_responses();
        }

        vTaskDelay(pdMS_TO_TICKS(200));
    }

    if (app_fd >= 0) close(app_fd);
}

void RtpReceiver::stop() {
    running_ = false;

    // Wait for tasks to finish
    if (recv_task_) {
        vTaskDelay(pdMS_TO_TICKS(200));
        recv_task_ = nullptr;
    }
    if (rtcp_task_) {
        vTaskDelay(pdMS_TO_TICKS(300));
        rtcp_task_ = nullptr;
    }

    if (socket_fd_ >= 0) {
        close(socket_fd_);
        socket_fd_ = -1;
    }
}

} // namespace roku
