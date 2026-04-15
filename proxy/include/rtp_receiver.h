#pragma once
#include <cstdint>
#include <functional>
#include <vector>
#include <atomic>
#include <thread>
#include <string>
#include "net_compat.h"

namespace roku {

// Receives RTP packets on a UDP port and extracts Opus payload.
class RtpReceiver {
public:
    // Called with raw Opus frame data (RTP payload without header).
    using FrameCallback = std::function<void(const uint8_t* data, size_t len,
                                              uint32_t timestamp, uint16_t seq)>;

    explicit RtpReceiver(int port);
    ~RtpReceiver();

    void start(FrameCallback on_frame);
    void stop();
    bool is_running() const { return running_.load(); }

    // Set the Roku's address for sending RTCP receiver reports
    void set_rtcp_target(const std::string& roku_ip, int rtcp_port = 5150);

private:
    int port_;
    socket_handle_t socket_fd_ = INVALID_SOCKET_HANDLE;
    socket_handle_t rtcp_fd_ = INVALID_SOCKET_HANDLE;
    std::atomic<bool> running_{false};
    std::thread recv_thread_;
    std::thread rtcp_thread_;

    // RTCP target
    std::string rtcp_target_ip_;
    int rtcp_target_port_ = 5150;

    // Stats for RTCP RR
    std::atomic<uint32_t> ssrc_{0};
    std::atomic<uint32_t> packets_received_{0};
    std::atomic<uint32_t> last_seq_{0};

    void rtcp_loop();
};

} // namespace roku
