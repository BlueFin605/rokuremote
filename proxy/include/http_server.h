#pragma once
#include <string>
#include <memory>

namespace roku {

class Session;
class RtpReceiver;

// HTTP API server that the phone talks to.
// Endpoints:
//   GET  /roku/<path>?ip=<roku-ip>  - Forward GET to Roku ECP (with CORS)
//   POST /roku/<path>?ip=<roku-ip>  - Forward POST to Roku ECP (with CORS)
//   GET  /discover          - SSDP discovery, returns JSON array of Roku devices
//   POST /start?roku=<ip>   - Start private listening session
//   POST /stop              - Stop session
//   GET  /status            - Current state (idle, connecting, streaming, error)
//   GET  /audio             - Streaming Opus audio (chunked transfer)
class HttpServer {
public:
    HttpServer(int port, const std::string& local_ip, int rtp_port);
    ~HttpServer();

    void start();  // Blocks
    void stop();

private:
    class Impl;
    std::unique_ptr<Impl> impl_;

    void setup_routes();
    void stop_session();
};

} // namespace roku
