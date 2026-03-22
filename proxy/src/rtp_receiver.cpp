#include "rtp_receiver.h"
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <cstring>
#include <iostream>
#include <chrono>

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
    packets_received_.store(0);
    last_seq_.store(0);
    ssrc_.store(0);

    recv_thread_ = std::thread([this, on_frame = std::move(on_frame)]() {
        uint8_t buf[2048];

        while (running_.load()) {
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

            ssrc_.store(ssrc);
            packets_received_.fetch_add(1);
            last_seq_.store(seq);

            // Check for CSRC count
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

    // Start RTCP thread using the same socket (socket_fd_) for sending
    // so RTCP comes from port 6970 — the port the Roku knows about
    if (!rtcp_target_ip_.empty()) {
        rtcp_thread_ = std::thread([this]() { rtcp_loop(); });
        std::cout << "RTCP sender started → " << rtcp_target_ip_ << ":" << rtcp_target_port_ << "\n";
    }

    std::cout << "RTP receiver listening on UDP port " << port_ << "\n";
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
    struct sockaddr_in dest{};
    dest.sin_family = AF_INET;
    dest.sin_port = htons(rtcp_target_port_);
    inet_pton(AF_INET, rtcp_target_ip_.c_str(), &dest.sin_addr);

    // Listen on port 6971 for RTCP APP responses from Roku (XDLY, NCLI)
    int app_fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (app_fd >= 0) {
        int reuse = 1;
        setsockopt(app_fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
        struct sockaddr_in app_addr{};
        app_addr.sin_family = AF_INET;
        app_addr.sin_port = htons(RTCP_APP_PORT);
        app_addr.sin_addr.s_addr = INADDR_ANY;
        if (bind(app_fd, reinterpret_cast<struct sockaddr*>(&app_addr), sizeof(app_addr)) < 0) {
            std::cerr << "Failed to bind RTCP APP port " << RTCP_APP_PORT << "\n";
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

    // Wait 1 second after first RTP packet for SSRC to stabilize
    // (matches roku-audio-receiver behavior)
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));

    auto check_app_responses = [&]() {
        if (app_fd < 0) return;
        uint8_t buf[256];
        fd_set fds;
        struct timeval tv;

        // Drain all pending packets
        for (;;) {
            FD_ZERO(&fds);
            FD_SET(app_fd, &fds);
            tv = {0, 10000}; // 10ms
            if (select(app_fd + 1, &fds, nullptr, nullptr, &tv) <= 0) break;

            ssize_t n = recv(app_fd, buf, sizeof(buf), 0);
            if (n < 12) continue;

            // Log raw packet for debugging
            std::cout << "[rtcp] APP port recv: " << n << " bytes, PT=" << (int)buf[1];
            if (n >= 12) {
                uint32_t raw_name = (static_cast<uint32_t>(buf[8]) << 24) |
                                    (static_cast<uint32_t>(buf[9]) << 16) |
                                    (static_cast<uint32_t>(buf[10]) << 8) |
                                    buf[11];
                char name_str[5] = {(char)buf[8], (char)buf[9], (char)buf[10], (char)buf[11], 0};
                std::cout << " name=" << name_str;
            }
            std::cout << "\n";

            if (n < 12 || buf[1] != 204) continue;

            uint32_t name = (static_cast<uint32_t>(buf[8]) << 24) |
                            (static_cast<uint32_t>(buf[9]) << 16) |
                            (static_cast<uint32_t>(buf[10]) << 8) |
                            buf[11];

            if (name == XDLY_NAME && n >= 16) {
                // Extract the delay value the Roku sent back
                uint32_t roku_delay = 0;
                {
                    roku_delay = (static_cast<uint32_t>(buf[12]) << 24) |
                                 (static_cast<uint32_t>(buf[13]) << 16) |
                                 (static_cast<uint32_t>(buf[14]) << 8) |
                                 buf[15];
                }
                std::cout << "[rtcp] Received XDLY (delay=" << roku_delay << ")\n";

                if (roku_delay != vdly_value) {
                    // Roku wants a different delay — re-send VDLY with its value
                    std::cout << "[rtcp] Delay mismatch, re-sending VDLY with " << roku_delay << "\n";
                    vdly_value = roku_delay;
                    vdly_sent = false;
                } else {
                    xdly_received = true;
                }
            } else if (name == NCLI_NAME) {
                std::cout << "[rtcp] Received NCLI\n";
                ncli_received = true;
            }
        }
    };

    while (running_.load()) {
        // During handshake: only send APP packets, no RR
        if (!handshake_done) {
            // Step 1: Send VDLY (SSRC=0 as per reference impl)
            if (!vdly_sent) {
                build_app_packet(pkt, 0, VDLY_NAME, vdly_value);
                sendto(socket_fd_, pkt, 16, 0,
                       reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));
                std::cout << "[rtcp] Sent VDLY (delay=" << vdly_value << ")\n";
                vdly_sent = true;
            }

            check_app_responses();

            // Step 2: After XDLY received, send CVER (SSRC=0)
            if (xdly_received && !cver_sent) {
                build_app_packet(pkt, 0, CVER_NAME, CVER_VALUE);
                sendto(socket_fd_, pkt, 16, 0,
                       reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));
                std::cout << "[rtcp] Sent CVER\n";
                cver_sent = true;
            }

            check_app_responses();

            if (xdly_received && ncli_received) {
                std::cout << "[rtcp] Handshake complete\n";
                handshake_done = true;
            }

            // Even without full handshake, start sending RR after CVER
            if (cver_sent) {
                uint32_t sender_ssrc = ssrc_.load();
                uint32_t seq = last_seq_.load();
                build_rr_packet(pkt, 0x12345678, sender_ssrc, seq);
                sendto(socket_fd_, pkt, 32, 0,
                       reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));
            }
        } else {
            // Handshake done — send periodic Receiver Reports
            uint32_t sender_ssrc = ssrc_.load();
            uint32_t seq = last_seq_.load();
            uint32_t pkts = packets_received_.load();
            static bool first_post_handshake = true;
            if (first_post_handshake) {
                std::cout << "[rtcp] Post-handshake: ssrc=" << sender_ssrc
                          << " seq=" << seq << " pkts=" << pkts
                          << " running=" << running_.load() << "\n";
                first_post_handshake = false;
            }
            build_rr_packet(pkt, 0x12345678, sender_ssrc, seq);
            sendto(socket_fd_, pkt, 32, 0,
                   reinterpret_cast<struct sockaddr*>(&dest), sizeof(dest));

            static int rr_count = 0;
            if (++rr_count % 25 == 1) { // Log every 5 seconds
                std::cout << "[rtcp] RR #" << rr_count
                          << " ssrc=" << sender_ssrc
                          << " seq=" << seq
                          << " pkts=" << pkts << "\n";
            }

            // Also drain any late APP packets on 6971
            check_app_responses();
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    if (app_fd >= 0) close(app_fd);
}

void RtpReceiver::stop() {
    running_.store(false);
    if (recv_thread_.joinable()) {
        recv_thread_.join();
    }
    if (rtcp_thread_.joinable()) {
        rtcp_thread_.join();
    }
    if (socket_fd_ >= 0) {
        close(socket_fd_);
        socket_fd_ = -1;
    }
    if (rtcp_fd_ >= 0) {
        close(rtcp_fd_);
        rtcp_fd_ = -1;
    }
}

} // namespace roku
