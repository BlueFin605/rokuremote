#pragma once

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>

using socket_handle_t = SOCKET;
constexpr socket_handle_t INVALID_SOCKET_HANDLE = INVALID_SOCKET;

inline bool initialize_sockets() {
    WSADATA wsa_data;
    return WSAStartup(MAKEWORD(2, 2), &wsa_data) == 0;
}

inline void cleanup_sockets() {
    WSACleanup();
}

inline void close_socket(socket_handle_t s) {
    if (s != INVALID_SOCKET) {
        closesocket(s);
    }
}

#else

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

using socket_handle_t = int;
constexpr socket_handle_t INVALID_SOCKET_HANDLE = -1;

inline bool initialize_sockets() {
    return true;
}

inline void cleanup_sockets() {
}

inline void close_socket(socket_handle_t s) {
    if (s >= 0) {
        close(s);
    }
}

#endif