#include "http_server.h"
#include <iostream>
#include <string>
#include <cstring>
#include <ifaddrs.h>
#include <arpa/inet.h>
#include <net/if.h>

static std::string get_local_ip() {
    struct ifaddrs* ifaddr;
    if (getifaddrs(&ifaddr) == -1) {
        return "127.0.0.1";
    }

    std::string result = "127.0.0.1";
    for (auto* ifa = ifaddr; ifa != nullptr; ifa = ifa->ifa_next) {
        if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_INET) continue;
        if (ifa->ifa_flags & IFF_LOOPBACK) continue;
        if (!(ifa->ifa_flags & IFF_UP)) continue;

        char buf[INET_ADDRSTRLEN];
        auto* sa = reinterpret_cast<struct sockaddr_in*>(ifa->ifa_addr);
        inet_ntop(AF_INET, &sa->sin_addr, buf, sizeof(buf));
        result = buf;
        break;
    }

    freeifaddrs(ifaddr);
    return result;
}

int main(int argc, char* argv[]) {
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

    return 0;
}
