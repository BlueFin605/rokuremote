#pragma once

#include <cstdint>
#include <cstddef>

struct WebFile {
    const char* uri;
    const uint8_t* data;
    size_t size;
    const char* content_type;
    bool gzipped;
};

// If prepare_web.sh has been run, web_files_gen.h defines WEB_FILE_COUNT,
// the extern symbols, and the web_files[] table.
// Otherwise, fall back to empty (API-only mode, no embedded UI).
#if __has_include("web_files_gen.h")
#include "web_files_gen.h"
#else
static const WebFile web_files[] = {};
static const int web_file_count = 0;
#endif
