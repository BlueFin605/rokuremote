#include "roku_auth.h"
#include <array>
#include <cstdint>
#include <sstream>
#include <cstring>
#include <vector>

namespace roku {

static const std::string UUID = "95E610D0-7C29-44EF-FB0F-97F1FCE4C297";
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

static std::string transform_uuid(const std::string& uuid, int shift) {
    std::string out;
    out.reserve(uuid.size());
    for (char c : uuid) {
        out.push_back(hash_char(c, shift));
    }
    return out;
}

static uint32_t left_rotate(uint32_t value, int count) {
    return (value << count) | (value >> (32 - count));
}

static std::array<uint8_t, 20> sha1_digest(const std::string& input) {
    std::vector<uint8_t> msg(input.begin(), input.end());
    const uint64_t bit_len = static_cast<uint64_t>(msg.size()) * 8;

    msg.push_back(0x80);
    while ((msg.size() % 64) != 56) {
        msg.push_back(0x00);
    }

    for (int i = 7; i >= 0; --i) {
        msg.push_back(static_cast<uint8_t>((bit_len >> (i * 8)) & 0xFF));
    }

    uint32_t h0 = 0x67452301;
    uint32_t h1 = 0xEFCDAB89;
    uint32_t h2 = 0x98BADCFE;
    uint32_t h3 = 0x10325476;
    uint32_t h4 = 0xC3D2E1F0;

    for (size_t chunk = 0; chunk < msg.size(); chunk += 64) {
        uint32_t w[80] = {};

        for (int i = 0; i < 16; ++i) {
            size_t j = chunk + static_cast<size_t>(i) * 4;
            w[i] = (static_cast<uint32_t>(msg[j]) << 24) |
                   (static_cast<uint32_t>(msg[j + 1]) << 16) |
                   (static_cast<uint32_t>(msg[j + 2]) << 8) |
                   static_cast<uint32_t>(msg[j + 3]);
        }

        for (int i = 16; i < 80; ++i) {
            w[i] = left_rotate(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }

        uint32_t a = h0;
        uint32_t b = h1;
        uint32_t c = h2;
        uint32_t d = h3;
        uint32_t e = h4;

        for (int i = 0; i < 80; ++i) {
            uint32_t f;
            uint32_t k;

            if (i < 20) {
                f = (b & c) | ((~b) & d);
                k = 0x5A827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ED9EBA1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8F1BBCDC;
            } else {
                f = b ^ c ^ d;
                k = 0xCA62C1D6;
            }

            uint32_t temp = left_rotate(a, 5) + f + e + k + w[i];
            e = d;
            d = c;
            c = left_rotate(b, 30);
            b = a;
            a = temp;
        }

        h0 += a;
        h1 += b;
        h2 += c;
        h3 += d;
        h4 += e;
    }

    std::array<uint8_t, 20> digest{};
    const uint32_t words[5] = {h0, h1, h2, h3, h4};
    for (int i = 0; i < 5; ++i) {
        digest[i * 4] = static_cast<uint8_t>((words[i] >> 24) & 0xFF);
        digest[i * 4 + 1] = static_cast<uint8_t>((words[i] >> 16) & 0xFF);
        digest[i * 4 + 2] = static_cast<uint8_t>((words[i] >> 8) & 0xFF);
        digest[i * 4 + 3] = static_cast<uint8_t>(words[i] & 0xFF);
    }
    return digest;
}

static std::string base64_encode(const uint8_t* data, size_t len) {
    static const char* kTable = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string out;
    out.reserve(((len + 2) / 3) * 4);

    for (size_t i = 0; i < len; i += 3) {
        const uint32_t b0 = data[i];
        const uint32_t b1 = (i + 1 < len) ? data[i + 1] : 0;
        const uint32_t b2 = (i + 2 < len) ? data[i + 2] : 0;
        const uint32_t triple = (b0 << 16) | (b1 << 8) | b2;

        out.push_back(kTable[(triple >> 18) & 0x3F]);
        out.push_back(kTable[(triple >> 12) & 0x3F]);
        out.push_back(i + 1 < len ? kTable[(triple >> 6) & 0x3F] : '=');
        out.push_back(i + 2 < len ? kTable[triple & 0x3F] : '=');
    }

    return out;
}

std::string compute_auth_response(const std::string& challenge) {
    std::string input = challenge + transform_uuid(UUID, SHIFT);
    auto hash = sha1_digest(input);
    return base64_encode(hash.data(), hash.size());
}

} // namespace roku
