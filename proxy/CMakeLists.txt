cmake_minimum_required(VERSION 3.20)
project(roku-proxy LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# For local proxy usage we only connect to ws:// endpoints, so we disable
# optional TLS/zlib dependencies in ixwebsocket to simplify Windows setup.
set(USE_TLS OFF CACHE BOOL "" FORCE)
set(USE_ZLIB OFF CACHE BOOL "" FORCE)

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

add_executable(roku-proxy
  src/main.cpp
  src/roku_auth.cpp
  src/roku_session.cpp
  src/rtp_receiver.cpp
  src/ssdp_discovery.cpp
  src/http_server.cpp
  src/panasonic_handler.cpp
)

target_include_directories(roku-proxy PRIVATE include)

target_link_libraries(roku-proxy PRIVATE
  httplib::httplib
  ixwebsocket
  nlohmann_json::nlohmann_json
)

if (WIN32)
  target_link_libraries(roku-proxy PRIVATE ws2_32)
endif()
