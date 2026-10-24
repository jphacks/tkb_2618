#pragma once

#include <array>
#include <cstdint>

namespace deskapi {

constexpr unsigned kChannels = 4;
constexpr uint64_t kPeakWindowUs = 15000;
constexpr float kSaturationThreshold = 1800.0f;
constexpr uint64_t kRawWindowUs = 10000;
using Samples = std::array<uint16_t, kChannels>;

struct Calibration {
    std::array<float, kChannels> threshold{{150, 150, 150, 150}};
    std::array<float, kChannels> strongMin{{700, 700, 700, 700}};
    bool hasTemplates = false;
    std::array<std::array<float, kChannels>, kChannels> templates{};
    uint32_t doubleWindowMs = 320;
    uint32_t refractoryMs = 70;
};

bool validCalibration(const Calibration& cal);

enum class Mode { Run, Calibrate, Raw };
enum class EventType { Tap, Hit, Noise, Raw, Hello, Ack };

struct Event {
    EventType type = EventType::Tap;
    Samples peaks{};
    Samples rawMin{};
    Samples rawMax{};
    bool saturated = false;
    std::array<float, kChannels> rms{};
    uint32_t ms = 0;
    uint32_t ring = 0;
    uint8_t region = 0;
    uint8_t count = 1;
    bool strong = false;
    float confidence = 0;
    bool calibrated = false;
    bool ok = true;
    const char* of = "";
    const char* error = "";
};

using EventSink = void (*)(const Event&, void*);

// All methods are called by the sampling task; no Arduino, heap or I/O here.
class Detector {
public:
    explicit Detector(EventSink sink, void* context = nullptr);
    void sample(const Samples& raw, uint64_t nowUs);
    bool setCalibration(const Calibration& cal);
    const Calibration& calibration() const { return cal_; }
    void setMode(Mode mode);
    bool measureNoise(uint32_t durationMs, uint64_t nowUs);

private:
    void resetHits();
    void finishHit(uint64_t nowUs);
    void emitPending();
    void emit(const Event& event) const;
    Calibration cal_{};
    Mode mode_ = Mode::Run;
    EventSink sink_;
    void* context_;
    bool initialized_ = false;
    std::array<float, kChannels> dc_{};
    bool rawActive_ = false;
    uint64_t rawStartUs_ = 0;
    Samples rawMin_{};
    Samples rawMax_{};
    bool saturated_ = false;
    bool ringActive_ = false;
    bool quietActive_ = false;
    bool ringDone_ = false;
    uint32_t ringMs_ = 0;
    uint64_t quietStartUs_ = 0;
    Event ringEvent_{};
    bool collecting_ = false;
    uint64_t hitStartUs_ = 0;
    uint64_t refractoryUntilUs_ = 0;
    Samples peaks_{};
    bool pending_ = false;
    uint64_t pendingStartUs_ = 0;
    Event pendingEvent_{};
    bool measuring_ = false;
    uint64_t noiseEndUs_ = 0;
    uint64_t noiseSamples_ = 0;
    Samples noisePeaks_{};
    std::array<uint64_t, kChannels> noiseSquares_{};
};

} // namespace deskapi
