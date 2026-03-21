#pragma once
#include <string>
#include <functional>
#include <atomic>
#include <memory>

namespace roku {

enum class SessionState {
    Idle,
    Connecting,
    Authenticating,
    Streaming,
    Error,
};

std::string state_to_string(SessionState state);

// Manages the WebSocket connection to the Roku for private listening.
// Handles auth, then tells the Roku where to send RTP audio.
class Session {
public:
    using StateCallback = std::function<void(SessionState, const std::string&)>;

    Session(const std::string& roku_ip, const std::string& local_ip, int rtp_port);
    ~Session();

    void start(StateCallback on_state_change);
    void stop();
    SessionState state() const { return state_.load(); }

private:
    std::string roku_ip_;
    std::string local_ip_;
    int rtp_port_;
    std::atomic<SessionState> state_{SessionState::Idle};
    StateCallback on_state_change_;

    class Impl;
    std::unique_ptr<Impl> impl_;

    void set_state(SessionState s, const std::string& msg = "");
    void handle_message(const std::string& text);
};

} // namespace roku
