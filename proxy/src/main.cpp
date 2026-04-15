#include "http_server.h"
#include "net_compat.h"
#include <iostream>
#include <string>
#include <cstring>

static std::string get_local_ip() {
    char hostname[256] = {0};
    if (gethostname(hostname, sizeof(hostname)) != 0) {
        return "127.0.0.1";
    }

    struct addrinfo hints{};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    struct addrinfo* result = nullptr;
    if (getaddrinfo(hostname, nullptr, &hints, &result) != 0 || !result) {
        return "127.0.0.1";
    }

    std::string ip = "127.0.0.1";
    for (auto* p = result; p != nullptr; p = p->ai_next) {
        if (!p->ai_addr || p->ai_family != AF_INET) continue;

        auto* sa = reinterpret_cast<sockaddr_in*>(p->ai_addr);
        if (sa->sin_addr.s_addr == htonl(INADDR_LOOPBACK)) continue;

        char buf[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &sa->sin_addr, buf, sizeof(buf));
        ip = buf;
        break;
    }

    freeaddrinfo(result);
    return ip;
}

int main(int argc, char* argv[]) {
    if (!initialize_sockets()) {
        std::cerr << "Failed to initialize sockets\n";
        return 1;
    }

    int http_port = 8080;
    int rtp_port = 6970;

    for (int i = 1; i < argc; i++) {
        if (std::strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            http_port = std::stoi(argv[++i]);
        } else if (std::strcmp(argv[i], "--rtp-port") == 0 && i + 1 < argc) {
            rtp_port = std::stoi(argv[++i]);
        } else if (std::strcmp(argv[i], "--help") == 0) {
            std::cout << "Usage: roku-proxy [options]\n"
                      << "  --port <port>      HTTP API port (default: 8080)\n"
                      << "  --rtp-port <port>  RTP receive port (default: 6970)\n";
            return 0;
        }
    }

    std::string local_ip = get_local_ip();
    std::cout << "Local IP: " << local_ip << "\n";
    std::cout << "HTTP port: " << http_port << "\n";
    std::cout << "RTP port: " << rtp_port << "\n";

    roku::HttpServer server(http_port, local_ip, rtp_port);
    server.start();

    cleanup_sockets();

    return 0;
}
