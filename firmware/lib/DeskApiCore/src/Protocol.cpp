#include "Protocol.h"

#include <ArduinoJson.h>
#include <cstring>
#include <cmath>

namespace deskapi {
namespace {

bool whitespace(char ch) { return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n'; }

// ArduinoJson also accepts single quotes, bare keys and some non-JSON numbers.
// Check standard JSON syntax first so malformed lines cannot execute commands.
class JsonSyntax {
public:
    JsonSyntax(const char* data, size_t length) : data_(data), length_(length) {}
    bool valid() {
        if (!value(0)) return false;
        space();
        return position_ == length_;
    }
private:
    char peek() const { return position_ < length_ ? data_[position_] : '\0'; }
    bool take(char ch) {
        if (position_ == length_ || peek() != ch) return false;
        ++position_;
        return true;
    }
    void space() { while (position_ < length_ && whitespace(peek())) ++position_; }
    bool digits() {
        const size_t start = position_;
        while (peek() >= '0' && peek() <= '9') ++position_;
        return position_ > start;
    }
    bool number() {
        take('-');
        if (!take('0')) {
            if (peek() < '1' || peek() > '9' || !digits()) return false;
        }
        if (take('.') && !digits()) return false;
        if (take('e') || take('E')) {
            if (!take('+')) take('-');
            if (!digits()) return false;
        }
        return true;
    }
    bool string() {
        if (!take('"')) return false;
        while (position_ < length_) {
            const unsigned char ch = static_cast<unsigned char>(data_[position_++]);
            if (ch == '"') return true;
            if (ch < 0x20) return false;
            if (ch != '\\') continue;
            if (position_ == length_) return false;
            const char escaped = data_[position_++];
            if (escaped == 'u') {
                for (unsigned i = 0; i < 4; ++i) {
                    if (position_ == length_) return false;
                    const char hex = data_[position_++];
                    if (!((hex >= '0' && hex <= '9') || (hex >= 'a' && hex <= 'f') ||
                          (hex >= 'A' && hex <= 'F'))) return false;
                }
            } else if (!std::strchr("\"\\/bfnrt", escaped) || escaped == '\0') {
                return false;
            }
        }
        return false;
    }
    bool literal(const char* text) {
        while (*text) if (!take(*text++)) return false;
        return true;
    }
    bool value(unsigned depth) {
        space();
        if (depth > 4) return false;
        if (take('{')) {
            space();
            if (take('}')) return true;
            do {
                space();
                if (!string()) return false;
                space();
                if (!take(':') || !value(depth + 1)) return false;
                space();
            } while (take(','));
            return take('}');
        }
        if (take('[')) {
            space();
            if (take(']')) return true;
            do {
                if (!value(depth + 1)) return false;
                space();
            } while (take(','));
            return take(']');
        }
        if (peek() == '"') return string();
        if (peek() == 't') return literal("true");
        if (peek() == 'f') return literal("false");
        if (peek() == 'n') return literal("null");
        return number();
    }
    const char* data_;
    size_t length_;
    size_t position_ = 0;
};

bool readArray(JsonVariantConst value, std::array<float, kChannels>& out) {
    if (!value.is<JsonArrayConst>() || value.size() != kChannels) return false;
    for (unsigned i = 0; i < kChannels; ++i) {
        if (!value[i].is<float>()) return false;
        out[i] = value[i].as<float>();
    }
    return true;
}

bool equals(JsonVariantConst value, const char* expected) {
    const JsonString text = value.as<JsonString>();
    return !text.isNull() && text.size() == std::strlen(expected) &&
        std::memcmp(text.c_str(), expected, text.size()) == 0;
}

size_t writeJson(const JsonDocument& doc, char* output, size_t capacity) {
    if (measureJson(doc) + 1 > capacity) return 0;
    return serializeJson(doc, output, capacity);
}

} // namespace

Command parseCommand(const char* json, size_t length) {
    Command command{};
    if (length == 0 || length > kMaxLine || !JsonSyntax(json, length).valid()) return command;
    StaticJsonDocument<2048> doc;
    if (deserializeJson(doc, json, length, DeserializationOption::NestingLimit(4)) || !doc.is<JsonObject>()) return command;
    if (!doc["t"].is<const char*>()) return command;
    if (equals(doc["t"], "ping")) {
        command.type = CommandType::Ping;
    } else if (equals(doc["t"], "mode")) {
        command.type = CommandType::Invalid;
        command.of = "mode";
        command.error = "invalid_mode";
        if (equals(doc["mode"], "run") || equals(doc["mode"], "calibrate") || equals(doc["mode"], "raw")) {
            command.type = CommandType::Mode;
            command.mode = equals(doc["mode"], "run") ? Mode::Run :
                (equals(doc["mode"], "raw") ? Mode::Raw : Mode::Calibrate);
        }
    } else if (equals(doc["t"], "measure_noise")) {
        // Only set_cal/mode have acknowledgements in protocol v1.
        if (doc["ms"].is<uint32_t>() && doc["ms"].as<uint32_t>() > 0) {
            command.type = CommandType::MeasureNoise;
            command.durationMs = doc["ms"].as<uint32_t>();
        }
    } else if (equals(doc["t"], "set_cal")) {
        command.type = CommandType::Invalid;
        command.of = "set_cal";
        command.error = "invalid_cal";
        JsonObjectConst cal = doc["cal"].as<JsonObjectConst>();
        if (!cal.isNull() && readArray(cal["threshold"], command.cal.threshold) &&
            readArray(cal["strongMin"], command.cal.strongMin) &&
            cal["doubleWindowMs"].is<uint32_t>() && cal["refractoryMs"].is<uint32_t>()) {
            command.cal.doubleWindowMs = cal["doubleWindowMs"];
            command.cal.refractoryMs = cal["refractoryMs"];
            if (cal.containsKey("templates")) {
                auto rows = cal["templates"];
                if (!rows.is<JsonArrayConst>() || rows.size() != kChannels) return command;
                command.cal.hasTemplates = true;
                for (unsigned r = 0; r < kChannels; ++r) {
                    if (!readArray(rows[r], command.cal.templates[r])) return command;
                }
            }
            if (validCalibration(command.cal)) {
                if (command.cal.hasTemplates) for (auto& row : command.cal.templates) {
                    double norm = 0;
                    for (float v : row) norm += static_cast<double>(v) * v;
                    for (float& v : row) v /= std::sqrt(norm);
                }
                command.type = CommandType::SetCalibration;
            }
        }
    }
    return command;
}

size_t encodeCalibration(const Calibration& cal, char* output, size_t capacity) {
    if (!validCalibration(cal)) return 0;
    StaticJsonDocument<2048> doc;
    doc["t"] = "set_cal";
    JsonObject object = doc.createNestedObject("cal");
    JsonArray threshold = object.createNestedArray("threshold");
    JsonArray strong = object.createNestedArray("strongMin");
    for (unsigned i = 0; i < kChannels; ++i) {
        threshold.add(cal.threshold[i]);
        strong.add(cal.strongMin[i]);
    }
    if (cal.hasTemplates) {
        JsonArray rows = object.createNestedArray("templates");
        for (const auto& row : cal.templates) {
            JsonArray values = rows.createNestedArray();
            double norm = 0;
            for (float v : row) norm += static_cast<double>(v) * v;
            for (float v : row) values.add(v / std::sqrt(norm));
        }
    }
    object["doubleWindowMs"] = cal.doubleWindowMs;
    object["refractoryMs"] = cal.refractoryMs;
    return writeJson(doc, output, capacity);
}

size_t encodeEvent(const Event& event, char* output, size_t capacity) {
    StaticJsonDocument<768> doc;
    switch (event.type) {
    case EventType::Hello:
        doc["t"] = "hello";
        doc["fw"] = kFirmwareVersion;
        doc["cal"] = event.calibrated;
        break;
    case EventType::Ack:
        doc["t"] = "ack";
        doc["of"] = event.of;
        doc["ok"] = event.ok;
        if (!event.ok) doc["err"] = event.error;
        break;
    case EventType::Tap:
        doc["t"] = "tap";
        doc["region"] = event.region;
        doc["count"] = event.count;
        doc["strength"] = event.strong ? "strong" : "weak";
        doc["confidence"] = event.confidence;
        break;
    case EventType::Hit: {
        doc["t"] = "hit";
        JsonArray peaks = doc.createNestedArray("peaks");
        for (uint16_t peak : event.peaks) peaks.add(peak);
        doc["ms"] = event.ms;
        doc["ring"] = event.ring;
        break;
    }
    case EventType::Raw: {
        doc["t"] = "raw";
        JsonArray minimum = doc.createNestedArray("min");
        JsonArray maximum = doc.createNestedArray("max");
        for (unsigned i = 0; i < kChannels; ++i) {
            minimum.add(event.rawMin[i]);
            maximum.add(event.rawMax[i]);
        }
        break;
    }
    case EventType::Noise: {
        doc["t"] = "noise";
        JsonArray peaks = doc.createNestedArray("peak");
        JsonArray rms = doc.createNestedArray("rms");
        for (unsigned i = 0; i < kChannels; ++i) {
            peaks.add(event.peaks[i]);
            rms.add(event.rms[i]);
        }
        break;
    }
    }
    if ((event.type == EventType::Tap || event.type == EventType::Hit) && event.saturated) doc["sat"] = true;
    return writeJson(doc, output, capacity);
}

bool LineBuffer::push(char ch) {
    if (ready_) {
        size_ = 0;
        ready_ = false;
    }
    if (ch == '\n') {
        if (discard_) {
            discard_ = false;
            size_ = 0;
            return false;
        }
        data_[size_] = '\0';
        ready_ = true;
        return true;
    }
    if (discard_) return false;
    if (size_ == kMaxLine) {
        size_ = 0;
        discard_ = true;
        return false;
    }
    data_[size_++] = ch;
    return false;
}

} // namespace deskapi
