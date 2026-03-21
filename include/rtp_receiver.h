#pragma once
#include <cstdint>
#include <functional>
#include <vector>
#include <atomic>
#include <thread>

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

private:
    int port_;
    int socket_fd_ = -1;
    std::atomic<bool> running_{false};
    std::thread recv_thread_;
};

} // namespace roku
