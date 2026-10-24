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
    if (cal.hasTemplates) for (const auto& row : cal.templates) {
        double norm = 0;
        for (float v : row) { if (!std::isfinite(v)) return false; norm += static_cast<double>(v) * v; }
        if (!(norm > 0) || !std::isfinite(norm)) return false;
    }
    return cal.doubleWindowMs > 0;
}

Detector::Detector(EventSink sink, void* context) : sink_(sink), context_(context) {}

void Detector::emit(const Event& event) const {
    if (sink_) sink_(event, context_);
}

void Detector::resetHits() {
    collecting_ = false;
    ringActive_ = false;
    quietActive_ = false;
    pending_ = false;
    refractoryUntilUs_ = 0;
    peaks_.fill(0);
}

bool Detector::setCalibration(const Calibration& cal) {
    if (!validCalibration(cal)) return false;
    cal_ = cal;
    if (cal_.hasTemplates) for (auto& row : cal_.templates) {
        double norm = 0;
        for (float v : row) norm += static_cast<double>(v) * v;
        for (float& v : row) v /= std::sqrt(norm);
    }
    resetHits();
    return true;
}

void Detector::setMode(Mode mode) {
    mode_ = mode;
    rawActive_ = false;
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
    event.saturated = saturated_;
    event.ms = static_cast<uint32_t>((nowUs - hitStartUs_) / 1000);
    if (mode_ == Mode::Calibrate) {
        event.type = EventType::Hit;
        ringEvent_ = event;
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
    const uint16_t amp = *std::max_element(peaks_.begin(), peaks_.end());
    if (cal_.hasTemplates) {
        double norm = 0;
        for (auto v : peaks_) norm += static_cast<double>(v) * v;
        norm = std::sqrt(norm);
        float best = -2, runner = -2;
        for (unsigned r = 0; r < kChannels; ++r) {
            float score = 0;
            for (unsigned ch = 0; ch < kChannels; ++ch) score += cal_.templates[r][ch] * peaks_[ch] / norm;
            if (score > best) { runner = best; best = score; region = r; }
            else runner = std::max(runner, score);
        }
        event.confidence = runner >= 1 ? 0 : std::max(0.0f, std::min(1.0f, (best - runner) / (1 - runner)));
    }
    event.type = EventType::Tap;
    event.region = static_cast<uint8_t>(region);
    event.strong = amp >= cal_.strongMin[region];
    if (!cal_.hasTemplates) event.confidence = peaks_[region] == 0 ? 0.0f :
        1.0f - static_cast<float>(second) / peaks_[region];
    if (pending_) {
        if (event.region == pendingEvent_.region &&
            hitStartUs_ - pendingStartUs_ <= static_cast<uint64_t>(cal_.doubleWindowMs) * 1000) {
            pendingEvent_.count = 2;
            pendingEvent_.saturated = pendingEvent_.saturated || event.saturated;
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
    if (mode_ == Mode::Raw) {
        if (rawActive_ && nowUs - rawStartUs_ >= kRawWindowUs) {
            Event event{};
            event.type = EventType::Raw;
            event.rawMin = rawMin_;
            event.rawMax = rawMax_;
            emit(event);
            rawActive_ = false;
        }
        if (!rawActive_) {
            rawStartUs_ = nowUs;
            rawMin_ = rawMax_ = raw;
            rawActive_ = true;
        } else {
            for (unsigned i = 0; i < kChannels; ++i) {
                rawMin_[i] = std::min(rawMin_[i], raw[i]);
                rawMax_[i] = std::max(rawMax_[i], raw[i]);
            }
        }
    }
    Samples magnitudes{};
    bool sampleSaturated = false;
    bool triggered = false;
    bool aboveQuiet = false;
    for (unsigned i = 0; i < kChannels; ++i) {
        const float delta = static_cast<float>(raw[i]) - dc_[i];
        const float magnitude = std::fabs(delta);
        sampleSaturated = sampleSaturated || magnitude >= kSaturationThreshold;
        magnitudes[i] = static_cast<uint16_t>(std::lround(magnitude));
        triggered = triggered || magnitude > cal_.threshold[i];
        aboveQuiet = aboveQuiet || magnitude >= cal_.threshold[i];
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

    if (mode_ == Mode::Raw) return;

    // End the half-open 15 ms capture before considering this sample as a new hit.
    if (collecting_ && nowUs - hitStartUs_ >= kPeakWindowUs) finishHit(nowUs);
    if (ringActive_) {
        if (!ringDone_) {
            if (aboveQuiet) quietActive_ = false;
            else if (!quietActive_) { quietActive_ = true; quietStartUs_ = nowUs; }
            if ((quietActive_ && nowUs - quietStartUs_ >= 10000) || nowUs - hitStartUs_ >= 1000000) {
                const uint64_t ringEndUs = quietActive_ && nowUs - quietStartUs_ >= 10000 ?
                    quietStartUs_ + 10000 : nowUs;
                ringMs_ = static_cast<uint32_t>(std::min<uint64_t>(1000, (ringEndUs - hitStartUs_) / 1000));
                ringDone_ = true;
            }
        }
        // Quiet may finish before the peak window. Preserve both measurements.
        if (ringDone_ && !collecting_) {
            ringEvent_.ring = ringMs_;
            emit(ringEvent_);
            ringActive_ = false;
        }
    }
    if (!collecting_ && !(mode_ == Mode::Calibrate && ringActive_) && nowUs >= refractoryUntilUs_ && triggered) {
        collecting_ = true;
        hitStartUs_ = nowUs;
        ringActive_ = mode_ == Mode::Calibrate;
        ringDone_ = false;
        quietActive_ = false;
        saturated_ = false;
        peaks_.fill(0);
    }
    if (collecting_) {
        saturated_ = saturated_ || sampleSaturated;
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
