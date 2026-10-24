#pragma once
#include <array>
#include <cstdint>
namespace deskapi {
constexpr std::array<uint8_t, 4> kXiaoPins{{1, 2, 4, 5}};
constexpr std::array<uint8_t, 4> kS3Pins{{1, 2, 3, 4}};
constexpr std::array<uint8_t, 4> kEsp32Pins{{32, 33, 34, 35}};
#if defined(DESKAPI_BOARD_XIAO)
constexpr auto kPins = kXiaoPins;
#elif defined(DESKAPI_BOARD_S3)
constexpr auto kPins = kS3Pins;
#elif defined(DESKAPI_BOARD_ESP32)
constexpr auto kPins = kEsp32Pins;
#endif
} // namespace deskapi
