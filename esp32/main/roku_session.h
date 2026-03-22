#pragma once

#include <string>
#include <cstdint>

namespace roku {

enum class SessionState {
    Idle,
    Connecting,
    Authenticating,
    Streaming,
    Error,
};

const char* state_to_string(SessionState state);

// Callback for state changes.
typedef void (*StateCallback)(SessionState state, const char* msg, void* ctx);

// Manages the WebSocket connection to the Roku for private listening.
// Handles auth, then tells the Roku where to send RTP audio.
class Session {
public:
    Session(const std::string& roku_ip, const std::string& local_ip, int rtp_port);
    ~Session();

    void start(StateCallback on_state_change, void* ctx);
    void stop();
    SessionState state() const { return state_; }

private:
    std::string roku_ip_;
    std::string local_ip_;
    int rtp_port_;
    volatile SessionState state_ = SessionState::Idle;
    StateCallback on_state_change_ = nullptr;
    void* cb_ctx_ = nullptr;

    void* ws_client_ = nullptr;  // esp_websocket_client_handle_t

    void set_state(SessionState s, const char* msg = "");
    void handle_message(const char* data, int len);

    static void ws_event_handler(void* handler_args, esp_event_base_t base,
                                  int32_t event_id, void* event_data);
};

} // namespace roku
