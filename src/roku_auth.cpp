#include "roku_auth.h"
#include <openssl/sha.h>
#include <openssl/evp.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <sstream>
#include <cstring>

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

static std::string base64_encode(const unsigned char* data, size_t len) {
    BIO* b64 = BIO_new(BIO_f_base64());
    BIO* bmem = BIO_new(BIO_s_mem());
    b64 = BIO_push(b64, bmem);
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    BIO_write(b64, data, static_cast<int>(len));
    BIO_flush(b64);

    BUF_MEM* bptr;
    BIO_get_mem_ptr(b64, &bptr);

    std::string result(bptr->data, bptr->length);
    BIO_free_all(b64);
    return result;
}

std::string compute_auth_response(const std::string& challenge) {
    std::string input = challenge + transform_uuid(UUID, SHIFT);

    unsigned char hash[SHA_DIGEST_LENGTH];
    SHA1(reinterpret_cast<const unsigned char*>(input.c_str()),
         input.size(), hash);

    return base64_encode(hash, SHA_DIGEST_LENGTH);
}

} // namespace roku
