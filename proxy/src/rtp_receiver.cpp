#include "rtp_receiver.h"
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <cstring>
#include <iostream>

namespace roku {

// RTP header is 12 bytes minimum:
//  0                   1                   2                   3
//  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |V=2|P|X|  CC   |M|     PT      |       sequence number         |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |                           timestamp                           |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |                             SSRC                              |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
static const size_t RTP_HEADER_SIZE = 12;

RtpReceiver::RtpReceiver(int port) : port_(port) {}

RtpReceiver::~RtpReceiver() {
    stop();
}

void RtpReceiver::start(FrameCallback on_frame) {
    if (running_.load()) return;

    socket_fd_ = socket(AF_INET, SOCK_DGRAM, 0);
    if (socket_fd_ < 0) {
        std::cerr << "Failed to create UDP socket\n";
        return;
    }

    int reuse = 1;
    setsockopt(socket_fd_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    struct sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port_);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(socket_fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::cerr << "Failed to bind UDP socket to port " << port_ << "\n";
        close(socket_fd_);
        socket_fd_ = -1;
        return;
    }

    running_.store(true);
    recv_thread_ = std::thread([this, on_frame = std::move(on_frame)]() {
        uint8_t buf[2048];

        while (running_.load()) {
            // Use select with timeout so we can check running_ flag
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

            // Check for CSRC count (lower 4 bits of byte 0)
            int cc = buf[0] & 0x0F;
            size_t header_len = RTP_HEADER_SIZE + cc * 4;

            // Check for extension bit
            if (buf[0] & 0x10) {
                if (n < static_cast<ssize_t>(header_len + 4)) continue;
                uint16_t ext_len = (static_cast<uint16_t>(buf[header_len + 2]) << 8) |
                                   buf[header_len + 3];
                header_len += 4 + ext_len * 4;
            }

            if (n <= static_cast<ssize_t>(header_len)) continue;

            const uint8_t* payload = buf + header_len;
            size_t payload_len = n - header_len;

            on_frame(payload, payload_len, timestamp, seq);
        }
    });

    std::cout << "RTP receiver listening on UDP port " << port_ << "\n";
}

void RtpReceiver::stop() {
    running_.store(false);
    if (recv_thread_.joinable()) {
        recv_thread_.join();
    }
    if (socket_fd_ >= 0) {
        close(socket_fd_);
        socket_fd_ = -1;
    }
}

} // namespace roku
