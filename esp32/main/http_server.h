#pragma once

#include <string>

// Start the HTTP API server. Does not block — server runs in its own tasks.
void start_http_server(int port, const std::string& local_ip, int rtp_port);

// Stop the HTTP server and any active session.
void stop_http_server();
