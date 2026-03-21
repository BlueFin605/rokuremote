cmake_minimum_required(VERSION 3.20)
project(roku-proxy LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# Header-only HTTP server
FetchContent_Declare(
  httplib
  GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
  GIT_TAG v0.18.3
)

# WebSocket client
FetchContent_Declare(
  ixwebsocket
  GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
  GIT_TAG v11.4.5
)

# JSON
FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
)

FetchContent_MakeAvailable(httplib ixwebsocket json)

find_package(OpenSSL REQUIRED)

add_executable(roku-proxy
  src/main.cpp
  src/roku_auth.cpp
  src/roku_session.cpp
  src/rtp_receiver.cpp
  src/ssdp_discovery.cpp
  src/http_server.cpp
)

target_include_directories(roku-proxy PRIVATE include)

target_link_libraries(roku-proxy PRIVATE
  httplib::httplib
  ixwebsocket
  nlohmann_json::nlohmann_json
  OpenSSL::Crypto
)
