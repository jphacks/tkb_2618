#include "Detector.h"

#include <algorithm>
#include <cmath>

namespace deskapi {

bool validCalibration(const Calibration& cal) {
    for (unsigned i = 0; i < kChannels; ++i) {
        if (!std::isfinite(cal.threshold[i]) || cal.threshold[i] < 0 ||
            cal.threshold[i] > 4095 || !std::isfinite(cal.strongMin[i]) ||
            cal.strongMin[i] < 0 || cal.strongMin[i] > 4095) {
            return false;
        }
    }
    return cal.doubleWindowMs > 0;
}

Detector::Detector(EventSink sink, void* context) : sink_(sink), context_(context) {}

void Detector::emit(const Event& event) const {
    if (sink_) sink_(event, context_);
}

void Detector::resetHits() {
    collecting_ = false;
    pending_ = false;
    refractoryUntilUs_ = 0;
    peaks_.fill(0);
}

bool Detector::setCalibration(const Calibration& cal) {
    if (!validCalibration(cal)) return false;
    cal_ = cal;
    resetHits();
    return true;
}

void Detector::setMode(Mode mode) {
    mode_ = mode;
    resetHits();
}

bool Detector::measureNoise(uint32_t durationMs, uint64_t nowUs) {
    if (durationMs == 0 || measuring_) return false;
    measuring_ = true;
    noiseEndUs_ = nowUs + static_cast<uint64_t>(durationMs) * 1000;
    noiseSamples_ = 0;
    noisePeaks_.fill(0);
    noiseSquares_.fill(0);
    return true;
}

void Detector::emitPending() {
    emit(pendingEvent_);
    pending_ = false;
}

void Detector::finishHit(uint64_t nowUs) {
    collecting_ = false;
    refractoryUntilUs_ = nowUs + static_cast<uint64_t>(cal_.refractoryMs) * 1000;
    Event event{};
    event.peaks = peaks_;
    event.ms = static_cast<uint32_t>((nowUs - hitStartUs_) / 1000);
    if (mode_ == Mode::Calibrate) {
        event.type = EventType::Hit;
        emit(event);
        return;
    }

    unsigned region = 0;
    for (unsigned i = 1; i < kChannels; ++i) {
        if (peaks_[i] > peaks_[region]) region = i;
    }
    uint16_t second = 0;
    for (unsigned i = 0; i < kChannels; ++i) {
        if (i != region) second = std::max(second, peaks_[i]);
    }
    event.type = EventType::Tap;
    event.region = static_cast<uint8_t>(region);
    event.strong = peaks_[region] >= cal_.strongMin[region];
    event.confidence = peaks_[region] == 0 ? 0.0f :
        1.0f - static_cast<float>(second) / peaks_[region];
    if (pending_) {
        if (event.region == pendingEvent_.region &&
            hitStartUs_ - pendingStartUs_ <= static_cast<uint64_t>(cal_.doubleWindowMs) * 1000) {
            pendingEvent_.count = 2;
            pendingEvent_.strong = pendingEvent_.strong || event.strong;
            pendingEvent_.confidence = std::min(pendingEvent_.confidence, event.confidence);
            emitPending();
            return;
        }
        emitPending();
    }
    pending_ = true;
    pendingStartUs_ = hitStartUs_;
    pendingEvent_ = event;
}

void Detector::sample(const Samples& raw, uint64_t nowUs) {
    if (!initialized_) {
        for (unsigned i = 0; i < kChannels; ++i) dc_[i] = raw[i];
        initialized_ = true;
    }
    Samples magnitudes{};
    bool triggered = false;
    for (unsigned i = 0; i < kChannels; ++i) {
        const float delta = static_cast<float>(raw[i]) - dc_[i];
        const float magnitude = std::fabs(delta);
        magnitudes[i] = static_cast<uint16_t>(std::lround(magnitude));
        triggered = triggered || magnitude > cal_.threshold[i];
        // Slow DC tracking in quiet samples; impacts/ringing must not bias it.
        if (!collecting_ && nowUs >= refractoryUntilUs_ && magnitude <= cal_.threshold[i]) {
            dc_[i] += delta / 2048.0f;
        }
    }

    if (measuring_ && nowUs >= noiseEndUs_) {
        Event noise{};
        noise.type = EventType::Noise;
        noise.peaks = noisePeaks_;
        for (unsigned i = 0; i < kChannels; ++i) {
            noise.rms[i] = noiseSamples_ == 0 ? 0.0f :
                static_cast<float>(std::sqrt(static_cast<double>(noiseSquares_[i]) / noiseSamples_));
        }
        measuring_ = false;
        emit(noise);
    }
    if (measuring_) {
        ++noiseSamples_;
        for (unsigned i = 0; i < kChannels; ++i) {
            noisePeaks_[i] = std::max(noisePeaks_[i], magnitudes[i]);
            noiseSquares_[i] += static_cast<uint64_t>(magnitudes[i]) * magnitudes[i];
        }
    }

    // End the half-open 15 ms capture before considering this sample as a new hit.
    if (collecting_ && nowUs - hitStartUs_ >= kPeakWindowUs) finishHit(nowUs);
    if (!collecting_ && nowUs >= refractoryUntilUs_ && triggered) {
        collecting_ = true;
        hitStartUs_ = nowUs;
        peaks_.fill(0);
    }
    if (collecting_) {
        for (unsigned i = 0; i < kChannels; ++i) peaks_[i] = std::max(peaks_[i], magnitudes[i]);
    }
    // A hit that starts on the deadline is eligible, even if its peak window
    // finishes after the deadline. Timing is measured from impact onset.
    if (pending_ && nowUs - pendingStartUs_ >= static_cast<uint64_t>(cal_.doubleWindowMs) * 1000 &&
        !(collecting_ && hitStartUs_ - pendingStartUs_ <= static_cast<uint64_t>(cal_.doubleWindowMs) * 1000)) {
        emitPending();
    }
}

} // namespace deskapi
