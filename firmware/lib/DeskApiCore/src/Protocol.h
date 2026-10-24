#pragma once

#include "Detector.h"
#include <cstddef>

namespace deskapi {

constexpr const char* kFirmwareVersion = "0.1.0";
constexpr size_t kMaxLine = 512;
enum class CommandType { Ignore, Ping, Mode, MeasureNoise, SetCalibration, Invalid };

struct Command {
    CommandType type = CommandType::Ignore;
    Calibration cal{};
    deskapi::Mode mode = deskapi::Mode::Run;
    uint32_t durationMs = 0;
    const char* of = "";
    const char* error = "";
};

Command parseCommand(const char* json, size_t length);
size_t encodeEvent(const Event& event, char* output, size_t capacity);
size_t encodeCalibration(const Calibration& cal, char* output, size_t capacity);

// Incremental framing. Discard an entire overlong line, then recover at '\n'.
class LineBuffer {
public:
    bool push(char ch);
    const char* data() const { return data_; }
    size_t size() const { return size_; }
private:
    char data_[kMaxLine + 1]{};
    size_t size_ = 0;
    bool discard_ = false;
    bool ready_ = false;
};

} // namespace deskapi
