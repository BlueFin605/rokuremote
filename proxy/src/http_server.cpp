#include "http_server.h"
#include "roku_session.h"
#include "rtp_receiver.h"
#include "ssdp_discovery.h"
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <mutex>
#include <deque>
#include <condition_variable>
#include <iostream>

using json = nlohmann::json;

namespace roku {

// Thread-safe ring buffer for Opus frames.
// The HTTP /audio endpoint reads from this; the RTP receiver writes to it.
class AudioBuffer {
public:
    static const size_t MAX_FRAMES = 500;  // ~10 seconds at 20ms/frame

    void push(const uint8_t* data, size_t len) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (frames_.size() >= MAX_FRAMES) {
            frames_.pop_front();
        }
        frames_.emplace_back(data, data + len);
        cv_.notify_all();
    }

    // Blocks until a frame is available or timeout.
    // Returns empty vector on timeout.
    std::vector<uint8_t> pop(int timeout_ms = 1000) {
        std::unique_lock<std::mutex> lock(mutex_);
        if (cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                         [this] { return !frames_.empty(); })) {
            auto frame = std::move(frames_.front());
            frames_.pop_front();
            return frame;
        }
        return {};
    }

    void clear() {
        std::lock_guard<std::mutex> lock(mutex_);
        frames_.clear();
    }

private:
    std::mutex mutex_;
    std::condition_variable cv_;
    std::deque<std::vector<uint8_t>> frames_;
};

class HttpServer::Impl {
public:
    httplib::Server server;
    int port;
    std::string local_ip;
    int rtp_port;
    std::unique_ptr<Session> session;
    std::unique_ptr<RtpReceiver> receiver;
    AudioBuffer audio_buffer;
    std::string last_error;
    SessionState current_state = SessionState::Idle;
    std::mutex state_mutex;
};

HttpServer::HttpServer(int port, const std::string& local_ip, int rtp_port)
    : impl_(std::make_unique<Impl>()) {
    impl_->port = port;
    impl_->local_ip = local_ip;
    impl_->rtp_port = rtp_port;
    setup_routes();
}

HttpServer::~HttpServer() {
    stop();
}

void HttpServer::setup_routes() {
    auto& srv = impl_->server;

    // CORS headers for all responses
    srv.set_default_headers({
        {"Access-Control-Allow-Origin", "*"},
        {"Access-Control-Allow-Methods", "GET, POST, OPTIONS"},
        {"Access-Control-Allow-Headers", "*"},
    });

    // Preflight
    srv.Options(".*", [](const httplib::Request&, httplib::Response& res) {
        res.status = 204;
    });

    // GET /discover — SSDP discovery
    srv.Get("/discover", [](const httplib::Request&, httplib::Response& res) {
        auto devices = discover_devices(3000);
        json arr = json::array();
        for (const auto& d : devices) {
            arr.push_back({{"ip", d.ip}, {"name", d.name}, {"model", d.model}});
        }
        res.set_content(arr.dump(), "application/json");
    });

    // POST /start?roku=<ip> — Start private listening
    srv.Post("/start", [this](const httplib::Request& req, httplib::Response& res) {
        std::string roku_ip = req.get_param_value("roku");
        if (roku_ip.empty()) {
            res.status = 400;
            res.set_content(R"({"error":"Missing roku parameter"})", "application/json");
            return;
        }

        // Stop any existing session
        stop_session();

        impl_->audio_buffer.clear();

        // Start RTP receiver with RTCP keepalive back to Roku
        impl_->receiver = std::make_unique<RtpReceiver>(impl_->rtp_port);
        impl_->receiver->set_rtcp_target(roku_ip);
        impl_->receiver->start([this](const uint8_t* data, size_t len, uint32_t, uint16_t) {
            impl_->audio_buffer.push(data, len);
        });

        // Start WebSocket session
        impl_->session = std::make_unique<Session>(roku_ip, impl_->local_ip, impl_->rtp_port);
        impl_->session->start([this](SessionState state, const std::string& msg) {
            std::lock_guard<std::mutex> lock(impl_->state_mutex);
            impl_->current_state = state;
            if (state == SessionState::Error) {
                impl_->last_error = msg;
            }
            std::cout << "[session] " << state_to_string(state);
            if (!msg.empty()) std::cout << ": " << msg;
            std::cout << "\n";
        });

        res.set_content(R"({"status":"starting"})", "application/json");
    });

    // POST /stop — Stop private listening
    srv.Post("/stop", [this](const httplib::Request&, httplib::Response& res) {
        stop_session();
        res.set_content(R"({"status":"stopped"})", "application/json");
    });

    // GET /status — Current state
    srv.Get("/status", [this](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(impl_->state_mutex);
        json j;
        j["state"] = state_to_string(impl_->current_state);
        if (impl_->current_state == SessionState::Error) {
            j["error"] = impl_->last_error;
        }
        res.set_content(j.dump(), "application/json");
    });

    // GET /roku/<path>?ip=<roku-ip> — Forward GET to Roku ECP
    srv.Get(R"(/roku/(.*))", [](const httplib::Request& req, httplib::Response& res) {
        std::string roku_ip = req.get_param_value("ip");
        if (roku_ip.empty()) {
            res.status = 400;
            res.set_content(R"({"error":"Missing ip parameter"})", "application/json");
            return;
        }

        std::string path = "/" + req.matches[1].str();
        httplib::Client client(roku_ip, 8060);
        client.set_connection_timeout(3);
        client.set_read_timeout(3);

        auto result = client.Get(path);
        if (!result) {
            res.status = 502;
            res.set_content(R"({"error":"Could not reach Roku"})", "application/json");
            return;
        }

        res.status = result->status;
        res.set_content(result->body, result->get_header_value("Content-Type"));
    });

    // POST /roku/<path>?ip=<roku-ip> — Forward POST to Roku ECP
    srv.Post(R"(/roku/(.*))", [](const httplib::Request& req, httplib::Response& res) {
        std::string roku_ip = req.get_param_value("ip");
        if (roku_ip.empty()) {
            res.status = 400;
            res.set_content(R"({"error":"Missing ip parameter"})", "application/json");
            return;
        }

        std::string path = "/" + req.matches[1].str();
        httplib::Client client(roku_ip, 8060);
        client.set_connection_timeout(3);
        client.set_read_timeout(3);

        auto result = client.Post(path);
        if (!result) {
            res.status = 502;
            res.set_content(R"({"error":"Could not reach Roku"})", "application/json");
            return;
        }

        res.status = result->status;
        res.set_content(result->body, result->get_header_value("Content-Type"));
    });

    // GET /audio — Streaming Opus frames as binary.
    // Each frame is prefixed with a 2-byte big-endian length.
    // This allows the browser to parse individual Opus frames.
    srv.Get("/audio", [this](const httplib::Request&, httplib::Response& res) {
        res.set_chunked_content_provider("application/octet-stream",
            [this](size_t, httplib::DataSink& sink) -> bool {
                auto frame = impl_->audio_buffer.pop(1000);
                if (frame.empty()) {
                    // Timeout — send keepalive (zero-length frame)
                    uint8_t len_prefix[2] = {0, 0};
                    sink.write(reinterpret_cast<const char*>(len_prefix), 2);
                    return true;
                }

                // Write 2-byte big-endian length + frame data
                uint16_t len = static_cast<uint16_t>(frame.size());
                uint8_t len_prefix[2] = {
                    static_cast<uint8_t>((len >> 8) & 0xFF),
                    static_cast<uint8_t>(len & 0xFF)
                };
                sink.write(reinterpret_cast<const char*>(len_prefix), 2);
                sink.write(reinterpret_cast<const char*>(frame.data()), frame.size());
                return true;
            }
        );
    });
}

void HttpServer::start() {
    std::cout << "HTTP server listening on port " << impl_->port << "\n";
    impl_->server.listen("0.0.0.0", impl_->port);
}

void HttpServer::stop() {
    stop_session();
    impl_->server.stop();
}

void HttpServer::stop_session() {
    if (impl_->session) {
        impl_->session->stop();
        impl_->session.reset();
    }
    if (impl_->receiver) {
        impl_->receiver->stop();
        impl_->receiver.reset();
    }
    std::lock_guard<std::mutex> lock(impl_->state_mutex);
    impl_->current_state = SessionState::Idle;
    impl_->last_error.clear();
}

} // namespace roku
