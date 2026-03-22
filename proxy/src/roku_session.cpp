#include "roku_session.h"
#include "roku_auth.h"
#include <ixwebsocket/IXWebSocket.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <sstream>

using json = nlohmann::json;

namespace roku {

std::string state_to_string(SessionState state) {
    switch (state) {
        case SessionState::Idle:           return "idle";
        case SessionState::Connecting:     return "connecting";
        case SessionState::Authenticating: return "authenticating";
        case SessionState::Streaming:      return "streaming";
        case SessionState::Error:          return "error";
    }
    return "unknown";
}

class Session::Impl {
public:
    ix::WebSocket ws;
};

Session::Session(const std::string& roku_ip, const std::string& local_ip, int rtp_port)
    : roku_ip_(roku_ip), local_ip_(local_ip), rtp_port_(rtp_port),
      impl_(std::make_unique<Impl>()) {}

Session::~Session() {
    stop();
}

void Session::start(StateCallback on_state_change) {
    on_state_change_ = std::move(on_state_change);
    set_state(SessionState::Connecting);

    std::string url = "ws://" + roku_ip_ + ":8060/ecp-session";
    impl_->ws.setUrl(url);

    ix::WebSocketHttpHeaders headers;
    headers["Sec-WebSocket-Origin"] = "Android";
    headers["Sec-WebSocket-Protocol"] = "ecp-2";
    impl_->ws.setExtraHeaders(headers);

    impl_->ws.setOnMessageCallback([this](const ix::WebSocketMessagePtr& msg) {
        if (msg->type == ix::WebSocketMessageType::Open) {
            set_state(SessionState::Authenticating);
        }
        else if (msg->type == ix::WebSocketMessageType::Message) {
            handle_message(msg->str);
        }
        else if (msg->type == ix::WebSocketMessageType::Error) {
            set_state(SessionState::Error, "WebSocket error: " + msg->errorInfo.reason);
        }
        else if (msg->type == ix::WebSocketMessageType::Close) {
            if (state_.load() == SessionState::Streaming) {
                set_state(SessionState::Idle, "Session closed");
            }
        }
    });

    impl_->ws.start();
}

void Session::stop() {
    impl_->ws.stop();
    set_state(SessionState::Idle);
}

void Session::set_state(SessionState s, const std::string& msg) {
    state_.store(s);
    if (on_state_change_) {
        on_state_change_(s, msg);
    }
}

void Session::handle_message(const std::string& text) {
    try {
        auto j = json::parse(text);

        // Auth challenge from Roku
        if (j.contains("notify") && j["notify"] == "authenticate") {
            std::string challenge = j.value("param-challenge", "");
            std::string response = compute_auth_response(challenge);

            json auth_reply;
            auth_reply["request"] = "authenticate";
            auth_reply["request-id"] = "0";
            auth_reply["param-response"] = response;

            impl_->ws.send(auth_reply.dump());
        }
        // Response to our auth or set-audio-output
        else if (j.contains("response")) {
            std::string resp = j["response"];
            std::string status = j.value("status", "");

            if (resp == "authenticate" && status == "200") {
                // Auth succeeded — tell Roku where to send audio
                // Format: IP:RTP_PORT:LATENCY:CLOCK_RATE_DIV50
                std::string audio_dest = local_ip_ + ":" + std::to_string(rtp_port_) + ":97:960";

                json set_output;
                set_output["request"] = "set-audio-output";
                set_output["request-id"] = "1";
                set_output["param-devname"] = audio_dest;
                set_output["param-audio-output"] = "datagram";

                impl_->ws.send(set_output.dump());
            }
            else if (resp == "authenticate" && status == "401") {
                set_state(SessionState::Error, "Authentication failed");
            }
            else if (resp == "set-audio-output" && status == "200") {
                set_state(SessionState::Streaming);
            }
            else if (resp == "set-audio-output" && status != "200") {
                set_state(SessionState::Error, "Failed to set audio output: " + status);
            }
        }
    } catch (const json::exception& e) {
        std::cerr << "JSON parse error: " << e.what() << "\n";
    }
}

} // namespace roku
