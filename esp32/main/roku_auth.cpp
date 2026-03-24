#include "roku_auth.h"
#include "mbedtls/sha1.h"
#include "mbedtls/base64.h"
#include <cstring>

namespace roku {

static const char* UUID = "95E610D0-7C29-44EF-FB0F-97F1FCE4C297";
static const int SHIFT = 9;

static char hash_char(char c, int shift) {
    int val;
    if (c >= '0' && c <= '9') {
        val = c - '0';
    } else if (c >= 'A' && c <= 'F') {
        val = (c - 'A') + 10;
    } else {
        return c;
    }
    int result = ((15 - val) + shift) & 15;
    return static_cast<char>(result < 10 ? result + '0' : (result - 10) + 'A');
}

static std::string transform_uuid(const char* uuid, int shift) {
    std::string out;
    for (const char* p = uuid; *p; ++p) {
        out.push_back(hash_char(*p, shift));
    }
    return out;
}

std::string compute_auth_response(const std::string& challenge) {
    std::string input = challenge + transform_uuid(UUID, SHIFT);

    unsigned char hash[20];  // SHA1 digest length
    mbedtls_sha1(reinterpret_cast<const unsigned char*>(input.c_str()),
                 input.size(), hash);

    unsigned char b64[48];
    size_t b64_len = 0;
    mbedtls_base64_encode(b64, sizeof(b64), &b64_len, hash, 20);

    return std::string(reinterpret_cast<char*>(b64), b64_len);
}

} // namespace roku
