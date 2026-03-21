#pragma once
#include <string>

namespace roku {

// Implements the Roku private listening auth challenge-response.
// Given a challenge string from the Roku, computes:
//   SHA1(challenge + transform("95E610D0-7C29-44EF-FB0F-97F1FCE4C297", shift=9))
// Returns the result as a Base64-encoded string.
std::string compute_auth_response(const std::string& challenge);

} // namespace roku
