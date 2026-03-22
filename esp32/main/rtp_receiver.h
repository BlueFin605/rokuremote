#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdint>
#include <string>

namespace roku {

// Called with raw Opus frame data (RTP payload without header).
typedef void (*FrameCallback)(const uint8_t* data, size_t len,
                               uint32_t timestamp, uint16_t seq, void* ctx);

// Receives RTP packets on a UDP port and extracts Opus payload.
class RtpReceiver {
public:
    explicit RtpReceiver(int port);
    ~RtpReceiver();

    void start(FrameCallback on_frame, void* ctx);
    void stop();
    bool is_running() const { return running_; }

    void set_rtcp_target(const std::string& roku_ip, int rtcp_port = 5150);

private:
    int port_;
    int socket_fd_ = -1;
    volatile bool running_ = false;
    TaskHandle_t recv_task_ = nullptr;
    TaskHandle_t rtcp_task_ = nullptr;

    FrameCallback on_frame_ = nullptr;
    void* cb_ctx_ = nullptr;

    std::string rtcp_target_ip_;
    int rtcp_target_port_ = 5150;

    volatile uint32_t ssrc_ = 0;
    volatile uint32_t packets_received_ = 0;
    volatile uint32_t last_seq_ = 0;

    static void recv_task_fn(void* arg);
    static void rtcp_task_fn(void* arg);
    void recv_loop();
    void rtcp_loop();
};

} // namespace roku
