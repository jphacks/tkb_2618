#include <unity.h>
#include <ArduinoJson.h>
#include <Detector.h>
#include <BoardPins.h>
#include <Protocol.h>

#include <cmath>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

using namespace deskapi;

namespace {
struct Rig {
    std::vector<Event> events;
    Detector detector;
    uint64_t nextUs = 500;
    Samples quiet{{2048, 2048, 2048, 2048}};
    static void collect(const Event& event, void* context) {
        static_cast<Rig*>(context)->events.push_back(event);
    }
    Rig() : detector(collect, this) { detector.sample(quiet, 0); }
    void idleTo(uint64_t endUs) {
        while (nextUs <= endUs) {
            detector.sample(quiet, nextUs);
            nextUs += 500;
        }
    }
    void at(uint64_t us, const Samples& raw) {
        idleTo(us - 500);
        detector.sample(raw, us);
        nextUs = us + 500;
    }
    void hit(uint64_t startUs, Samples amplitudes) {
        Samples raw{};
        for (unsigned i = 0; i < kChannels; ++i) raw[i] = quiet[i] + amplitudes[i];
        at(startUs, raw);
        idleTo(startUs + kPeakWindowUs);
    }
};

Command parse(const char* json) { return parseCommand(json, std::strlen(json)); }

StaticJsonDocument<1024> encoded(const Event& event) {
    char output[kMaxLine + 1];
    const size_t length = encodeEvent(event, output, sizeof(output));
    TEST_ASSERT_GREATER_THAN(0, length);
    StaticJsonDocument<1024> doc;
    // Copy strings into the document; output is a local stack buffer.
    TEST_ASSERT_FALSE(deserializeJson(doc, static_cast<const char*>(output), length));
    return doc;
}
} // namespace

void setUp() {}
void tearDown() {}

void test_defaults_and_invalid_calibration() {
    Rig rig;
    const Calibration defaults = rig.detector.calibration();
    TEST_ASSERT_EQUAL_UINT32(320, defaults.doubleWindowMs);
    TEST_ASSERT_EQUAL_UINT32(70, defaults.refractoryMs);
    for (unsigned i = 0; i < kChannels; ++i) {
        TEST_ASSERT_EQUAL_FLOAT(150, defaults.threshold[i]);
        TEST_ASSERT_EQUAL_FLOAT(700, defaults.strongMin[i]);
    }
    Calibration invalid;
    invalid.threshold[2] = std::numeric_limits<float>::quiet_NaN();
    TEST_ASSERT_FALSE(rig.detector.setCalibration(invalid));
    invalid = defaults;
    invalid.strongMin[1] = 4096;
    TEST_ASSERT_FALSE(validCalibration(invalid));
    invalid = defaults;
    invalid.doubleWindowMs = 0;
    TEST_ASSERT_FALSE(validCalibration(invalid));
    TEST_ASSERT_EQUAL_FLOAT(150, rig.detector.calibration().threshold[2]);
}

void test_single_waits_until_onset_deadline() {
    Rig rig;
    rig.hit(10000, {{500, 100, 50, 0}});
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.idleTo(329500);
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.idleTo(330000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(0, rig.events[0].region);
    TEST_ASSERT_EQUAL_UINT(1, rig.events[0].count);
    TEST_ASSERT_FALSE(rig.events[0].strong);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.8f, rig.events[0].confidence);
}

void test_peak_window_uses_later_channel_maximum() {
    Rig rig;
    rig.detector.setMode(Mode::Calibrate);
    rig.at(10000, {{2248, 2048, 2048, 2048}});
    rig.at(24000, {{2048, 2908, 2048, 2188}});
    rig.idleTo(24500);
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.idleTo(34500);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_TRUE(rig.events[0].type == EventType::Hit);
    TEST_ASSERT_EQUAL_UINT16(200, rig.events[0].peaks[0]);
    TEST_ASSERT_EQUAL_UINT16(860, rig.events[0].peaks[1]);
    TEST_ASSERT_EQUAL_UINT32(15, rig.events[0].ms);
}

void test_region_selected_by_maximum_not_first_trigger() {
    Rig rig;
    rig.at(10000, {{2248, 2048, 2048, 2048}});
    rig.at(24000, {{2048, 2848, 2048, 2048}});
    rig.idleTo(330000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(1, rig.events[0].region);
    TEST_ASSERT_TRUE(rig.events[0].strong);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.75f, rig.events[0].confidence);
}

void test_peak_window_excludes_sample_at_end() {
    Rig rig;
    rig.detector.setMode(Mode::Calibrate);
    rig.at(10000, {{2548, 2048, 2048, 2048}});
    rig.at(25000, {{2048, 3048, 2048, 2048}});
    rig.idleTo(35500);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT16(500, rig.events[0].peaks[0]);
    TEST_ASSERT_EQUAL_UINT16(0, rig.events[0].peaks[1]);
    rig.idleTo(400000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
}

void test_dc_tracks_quiet_baseline_drift() {
    Rig rig;
    // A small persistent offset must become the new baseline without a hit.
    rig.quiet.fill(2148);
    rig.idleTo(10000000);
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.detector.setMode(Mode::Calibrate);
    rig.hit(10010000, {{0, 0, 0, 800}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_UINT16_WITHIN(1, 800, rig.events[0].peaks[3]);
    TEST_ASSERT_UINT16_WITHIN(1, 0, rig.events[0].peaks[0]);
}

void test_double_uses_stronger_hit_and_lower_confidence() {
    Rig rig;
    rig.hit(10000, {{0, 500, 100, 0}});
    rig.hit(200000, {{0, 900, 450, 0}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(2, rig.events[0].count);
    TEST_ASSERT_TRUE(rig.events[0].strong);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, rig.events[0].confidence);
    rig.idleTo(600000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
}

void test_double_preserves_strong_first_hit() {
    Rig rig;
    rig.hit(10000, {{0, 0, 700, 0}});
    rig.hit(100000, {{0, 0, 300, 0}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(2, rig.events[0].count);
    TEST_ASSERT_TRUE(rig.events[0].strong);
}

void test_double_at_exact_deadline_finishes_after_deadline() {
    Rig rig;
    rig.hit(10000, {{0, 0, 500, 0}});
    rig.at(330000, {{2048, 2048, 2548, 2048}});
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.idleTo(344500);
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.idleTo(345000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(2, rig.events[0].count);
}

void test_late_second_hit_is_two_singles() {
    Rig rig;
    rig.hit(10000, {{0, 0, 0, 500}});
    rig.hit(330500, {{0, 0, 0, 500}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    rig.idleTo(650500);
    TEST_ASSERT_EQUAL_UINT(2, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(1, rig.events[0].count);
    TEST_ASSERT_EQUAL_UINT(1, rig.events[1].count);
}

void test_other_region_flushes_first_then_becomes_pending() {
    Rig rig;
    rig.hit(10000, {{500, 0, 0, 0}});
    rig.hit(100000, {{0, 0, 0, 800}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(0, rig.events[0].region);
    rig.hit(200000, {{0, 0, 0, 300}});
    TEST_ASSERT_EQUAL_UINT(2, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(3, rig.events[1].region);
    TEST_ASSERT_EQUAL_UINT(2, rig.events[1].count);
}

void test_refractory_suppresses_ringing_and_accepts_boundary() {
    Rig rig;
    rig.detector.setMode(Mode::Calibrate);
    rig.hit(10000, {{500, 0, 0, 0}}); // capture ends 25 ms, ignore until 95 ms
    rig.at(94500, {{2048, 3048, 2048, 2048}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    rig.hit(95000, {{0, 800, 0, 0}});
    TEST_ASSERT_EQUAL_UINT(2, rig.events.size());
    TEST_ASSERT_EQUAL_UINT16(800, rig.events[1].peaks[1]);
}

void test_dc_offset_negative_signal_and_quiet_do_not_trigger() {
    Rig rig;
    rig.idleTo(1000000);
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.at(1010000, {{2048, 2048, 1248, 2048}});
    rig.idleTo(1330000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(2, rig.events[0].region);
    TEST_ASSERT_TRUE(rig.events[0].strong);
}

// Biased buffer: bipolar ringing must produce the same peak and decision.
void test_biased_bipolar_input_all_channels_and_strengths() {
    for (unsigned channel = 0; channel < kChannels; ++channel) {
        for (int sign : {-1, 1}) {
            for (int amplitude : {151, 699, 700, 1200}) {
                Rig rig;
                rig.idleTo(1000000);
                TEST_ASSERT_TRUE(rig.events.empty());
                Samples raw = rig.quiet;
                raw[channel] = static_cast<uint16_t>(2048 + sign * amplitude);
                rig.at(1010000, raw);
                raw[channel] = static_cast<uint16_t>(2048 - sign * amplitude);
                rig.at(1010500, raw);
                rig.idleTo(1330000);
                TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
                TEST_ASSERT_EQUAL_UINT(channel, rig.events[0].region);
                TEST_ASSERT_EQUAL_UINT16(amplitude, rig.events[0].peaks[channel]);
                TEST_ASSERT_EQUAL_UINT(amplitude >= 700, rig.events[0].strong);
                TEST_ASSERT_EQUAL_UINT(1, rig.events[0].count);
            }
        }
    }
}

void test_threshold_strict_and_per_channel_calibration_immediate() {
    Rig rig;
    rig.at(10000, {{2198, 2048, 2048, 2048}}); // exactly 150, no trigger
    rig.idleTo(400000);
    TEST_ASSERT_TRUE(rig.events.empty());
    Calibration cal;
    cal.threshold = {{1000, 1000, 90.5f, 1000}};
    cal.strongMin[2] = 200;
    cal.doubleWindowMs = 100;
    TEST_ASSERT_TRUE(rig.detector.setCalibration(cal));
    rig.hit(500000, {{500, 0, 200, 0}});
    rig.idleTo(600000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    // All peaks participate in region selection, even below that ch threshold.
    TEST_ASSERT_EQUAL_UINT(0, rig.events[0].region);
    TEST_ASSERT_FALSE(rig.events[0].strong);
}

void test_equal_peaks_have_zero_confidence() {
    Rig rig;
    rig.hit(10000, {{500, 500, 500, 500}});
    rig.idleTo(330000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(0, rig.events[0].region);
    TEST_ASSERT_EQUAL_FLOAT(0, rig.events[0].confidence);
}

void test_mode_and_calibration_changes_cancel_pending_and_active_hits() {
    Rig rig;
    rig.hit(10000, {{500, 0, 0, 0}});
    rig.detector.setMode(Mode::Calibrate);
    rig.idleTo(400000);
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.at(410000, {{2548, 2048, 2048, 2048}});
    rig.detector.setMode(Mode::Run);
    rig.idleTo(800000);
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.hit(810000, {{500, 0, 0, 0}});
    TEST_ASSERT_TRUE(rig.detector.setCalibration(Calibration{}));
    rig.idleTo(1200000);
    TEST_ASSERT_TRUE(rig.events.empty());
}

void test_noise_peak_rms_duration_and_busy() {
    Rig rig;
    TEST_ASSERT_FALSE(rig.detector.measureNoise(0, 500));
    TEST_ASSERT_TRUE(rig.detector.measureNoise(2, 500));
    TEST_ASSERT_FALSE(rig.detector.measureNoise(2, 500));
    rig.at(500, {{2058, 2068, 2078, 2088}});
    rig.at(1000, {{2038, 2028, 2018, 2008}});
    rig.at(1500, {{2058, 2068, 2078, 2088}});
    rig.at(2000, {{2038, 2028, 2018, 2008}});
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.idleTo(2500);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_TRUE(rig.events[0].type == EventType::Noise);
    for (unsigned i = 0; i < kChannels; ++i) {
        TEST_ASSERT_EQUAL_UINT16(10 * (i + 1), rig.events[0].peaks[i]);
        TEST_ASSERT_FLOAT_WITHIN(0.01f, 10.0f * (i + 1), rig.events[0].rms[i]);
    }
    TEST_ASSERT_TRUE(rig.detector.measureNoise(1, 3000));
}

void test_long_uptime_does_not_wrap_hit_timing() {
    Rig rig;
    const uint64_t start = (uint64_t{1} << 32) + 204;
    rig.nextUs = start;
    rig.hit(start, {{500, 0, 0, 0}});
    rig.hit(start + 200000, {{500, 0, 0, 0}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT(2, rig.events[0].count);
}

void test_protocol_parses_all_commands_and_float_calibration() {
    TEST_ASSERT_TRUE(parse("{\"t\":\"ping\"}").type == CommandType::Ping);
    Command command = parse("{\"t\":\"mode\",\"mode\":\"calibrate\"}");
    TEST_ASSERT_TRUE(command.type == CommandType::Mode);
    TEST_ASSERT_TRUE(command.mode == Mode::Calibrate);
    TEST_ASSERT_TRUE(parse("{\"t\":\"mode\",\"mode\":\"run\"}").mode == Mode::Run);
    command = parse("{\"t\":\"measure_noise\",\"ms\":2000}");
    TEST_ASSERT_TRUE(command.type == CommandType::MeasureNoise);
    TEST_ASSERT_EQUAL_UINT32(2000, command.durationMs);
    command = parse("{\"t\":\"set_cal\",\"cal\":{\"threshold\":[90.5,85,100,88],\"strongMin\":[520,480,600.25,500],\"doubleWindowMs\":320,\"refractoryMs\":70}}");
    TEST_ASSERT_TRUE(command.type == CommandType::SetCalibration);
    TEST_ASSERT_EQUAL_FLOAT(90.5f, command.cal.threshold[0]);
    TEST_ASSERT_EQUAL_FLOAT(600.25f, command.cal.strongMin[2]);
}

void test_protocol_ignores_malformed_and_unknown_lines() {
    const char* lines[] = {"", "boot log", "[]", "{", "{\"t\":5}", "{}", "{\"t\":\"unknown\"}",
        "{\"t\":\"ping\"}garbage", "{\"t\":\"ping\"}{\"t\":\"ping\"}",
        "{t:\"ping\"}", "{'t':'ping'}", "{\"t\":\"ping\",}",
        "{\"t\":\"ping\",\"x\":01}", "{\"t\":\"ping\",\"x\":.5}",
        "{\"t\":\"ping\",\"x\":1.}", "{\"t\":\"ping\",\"x\":+1}",
        "{\"t\":\"ping\",\"x\":1e}", "{\"t\":\"ping\",\"x\":\"\\z\"}",
        "{\"t\":\"ping\\u0000other\"}",
        "{\"t\":\"measure_noise\",\"ms\":-1}", "{\"t\":\"measure_noise\",\"ms\":0}",
        "{\"t\":\"measure_noise\",\"ms\":2.5}", "{\"t\":\"measure_noise\",\"ms\":4294967296}"};
    for (const char* line : lines) TEST_ASSERT_TRUE_MESSAGE(parse(line).type == CommandType::Ignore, line);
    TEST_ASSERT_TRUE(parse(" {\"t\":\"ping\"}\t\r").type == CommandType::Ping);
}

void test_protocol_rejects_invalid_mode_and_calibration_atomically() {
    Command command = parse("{\"t\":\"mode\",\"mode\":\"invalid\"}");
    TEST_ASSERT_TRUE(command.type == CommandType::Invalid);
    TEST_ASSERT_EQUAL_STRING("mode", command.of);
    TEST_ASSERT_TRUE(parse("{\"t\":\"mode\",\"mode\":\"run\\u0000other\"}").type == CommandType::Invalid);
    const char* lines[] = {"{\"t\":\"set_cal\"}",
        "{\"t\":\"set_cal\",\"cal\":{\"threshold\":[90,85,100],\"strongMin\":[520,480,600,500],\"doubleWindowMs\":320,\"refractoryMs\":70}}",
        "{\"t\":\"set_cal\",\"cal\":{\"threshold\":[90,85,100,88],\"strongMin\":[520,480,600,\"500\"],\"doubleWindowMs\":320,\"refractoryMs\":70}}",
        "{\"t\":\"set_cal\",\"cal\":{\"threshold\":[90,-1,100,88],\"strongMin\":[520,480,600,500],\"doubleWindowMs\":320,\"refractoryMs\":70}}",
        "{\"t\":\"set_cal\",\"cal\":{\"threshold\":[90,85,100,88],\"strongMin\":[520,480,600,500],\"doubleWindowMs\":true,\"refractoryMs\":70}}"};
    for (const char* line : lines) {
        command = parse(line);
        TEST_ASSERT_TRUE_MESSAGE(command.type == CommandType::Invalid, line);
        TEST_ASSERT_EQUAL_STRING("set_cal", command.of);
    }
}

void test_protocol_encodes_all_events() {
    Event event{};
    event.type = EventType::Hello;
    auto doc = encoded(event);
    TEST_ASSERT_EQUAL_STRING("hello", doc["t"]);
    TEST_ASSERT_EQUAL_STRING("0.1.0", doc["fw"]);
    TEST_ASSERT_FALSE(doc["cal"].as<bool>());
    event.calibrated = true;
    TEST_ASSERT_TRUE(encoded(event)["cal"].as<bool>());
    event.type = EventType::Tap;
    event.region = 2;
    event.count = 2;
    event.strong = true;
    event.confidence = 0.82f;
    doc = encoded(event);
    TEST_ASSERT_EQUAL_STRING("tap", doc["t"]);
    TEST_ASSERT_EQUAL_UINT(2, doc["region"].as<unsigned>());
    TEST_ASSERT_EQUAL_UINT(2, doc["count"].as<unsigned>());
    TEST_ASSERT_EQUAL_STRING("strong", doc["strength"]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.82f, doc["confidence"].as<float>());
    event.type = EventType::Hit;
    event.peaks = {{120, 860, 90, 140}};
    event.ms = 18;
    doc = encoded(event);
    TEST_ASSERT_EQUAL_STRING("hit", doc["t"]);
    TEST_ASSERT_EQUAL_UINT(4, doc["peaks"].size());
    TEST_ASSERT_EQUAL_UINT(860, doc["peaks"][1].as<unsigned>());
    TEST_ASSERT_EQUAL_UINT(18, doc["ms"].as<unsigned>());
    event.type = EventType::Noise;
    event.rms = {{9, 8, 11, 9}};
    doc = encoded(event);
    TEST_ASSERT_EQUAL_STRING("noise", doc["t"]);
    TEST_ASSERT_EQUAL_UINT(4, doc["peak"].size());
    TEST_ASSERT_EQUAL_UINT(4, doc["rms"].size());
    TEST_ASSERT_FALSE(doc.containsKey("peaks"));
    event.type = EventType::Ack;
    event.of = "set_cal";
    doc = encoded(event);
    TEST_ASSERT_EQUAL_STRING("ack", doc["t"]);
    TEST_ASSERT_EQUAL_STRING("set_cal", doc["of"]);
    TEST_ASSERT_TRUE(doc["ok"].as<bool>());
    TEST_ASSERT_FALSE(doc.containsKey("err"));
    event.ok = false;
    event.error = "nvs_write_failed";
    doc = encoded(event);
    TEST_ASSERT_FALSE(doc["ok"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("nvs_write_failed", doc["err"]);
    char small[2];
    TEST_ASSERT_EQUAL_UINT(0, encodeEvent(event, small, sizeof(small)));
}

void test_persisted_calibration_round_trips() {
    Calibration cal;
    cal.threshold = {{90.5f, 85, 100, 88}};
    cal.strongMin = {{520, 480, 600.25f, 500}};
    char json[kMaxLine + 1];
    const size_t length = encodeCalibration(cal, json, sizeof(json));
    TEST_ASSERT_GREATER_THAN(0, length);
    const Command restored = parseCommand(json, length);
    TEST_ASSERT_TRUE(restored.type == CommandType::SetCalibration);
    Rig rig;
    TEST_ASSERT_TRUE(rig.detector.setCalibration(restored.cal));
    for (unsigned i = 0; i < kChannels; ++i) {
        TEST_ASSERT_EQUAL_FLOAT(cal.threshold[i], rig.detector.calibration().threshold[i]);
        TEST_ASSERT_EQUAL_FLOAT(cal.strongMin[i], rig.detector.calibration().strongMin[i]);
    }
    TEST_ASSERT_EQUAL_UINT32(cal.doubleWindowMs, restored.cal.doubleWindowMs);
    TEST_ASSERT_EQUAL_UINT32(cal.refractoryMs, restored.cal.refractoryMs);
}

void test_line_framing_partial_crlf_overflow_and_recovery() {
    LineBuffer buffer;
    for (char ch : std::string("{\"t\":\"ping\"}\r")) TEST_ASSERT_FALSE(buffer.push(ch));
    TEST_ASSERT_TRUE(buffer.push('\n'));
    TEST_ASSERT_TRUE(parseCommand(buffer.data(), buffer.size()).type == CommandType::Ping);
    for (size_t i = 0; i < kMaxLine + 20; ++i) TEST_ASSERT_FALSE(buffer.push('x'));
    TEST_ASSERT_FALSE(buffer.push('\n'));
    for (char ch : std::string("{\"t\":\"ping\"}")) TEST_ASSERT_FALSE(buffer.push(ch));
    TEST_ASSERT_TRUE(buffer.push('\n'));
    TEST_ASSERT_TRUE(parseCommand(buffer.data(), buffer.size()).type == CommandType::Ping);
}

void test_circuit_saturation() {
    for (Mode mode : {Mode::Run, Mode::Calibrate}) {
        for (unsigned ch = 0; ch < 4; ++ch) {
            for (int sign : {-1, 1}) {
                for (int amp : {1799, 1800}) {
                    Rig rig;
                    rig.detector.setMode(mode);
                    rig.at(10000, {{2248, 2048, 2048, 2048}});
                    Samples raw = rig.quiet;
                    raw[ch] = 2048 + sign * amp;
                    rig.at(24500, raw);
                    rig.idleTo(330000);
                    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
                    TEST_ASSERT_EQUAL_UINT(amp == 1800, rig.events[0].saturated);
                    TEST_ASSERT_EQUAL_UINT(amp == 1800, encoded(rig.events[0]).containsKey("sat"));
                }
            }
        }
    }
    for (bool first : {false, true}) {
        Rig rig;
        rig.hit(10000, {{static_cast<uint16_t>(first ? 1800 : 500), 0, 0, 0}});
        rig.hit(100000, {{static_cast<uint16_t>(first ? 500 : 1800), 0, 0, 0}});
        TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
        TEST_ASSERT_EQUAL_UINT(2, rig.events[0].count);
        TEST_ASSERT_TRUE(rig.events[0].saturated);
    }
}

void test_circuit_raw_and_pins() {
    const uint8_t pins[]{1, 2, 4, 5};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(pins, kXiaoPins.data(), 4);
    const Command raw = parse(R"({"t":"mode","mode":"raw"})");
    TEST_ASSERT_TRUE(raw.type == CommandType::Mode);
    TEST_ASSERT_TRUE(raw.mode == Mode::Raw);
    TEST_ASSERT_EQUAL_STRING("mode", raw.of);
    Rig rig;
    rig.hit(10000, {{500, 0, 0, 0}});
    rig.detector.setMode(raw.mode);
    rig.nextUs = 30000;
    rig.at(30000, {{0, 1000, 2000, 4095}});
    rig.at(39500, {{4095, 2000, 1000, 0}});
    TEST_ASSERT_TRUE(rig.events.empty());
    rig.at(40000, {{200, 300, 400, 500}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    const Samples minimum{{0, 1000, 1000, 0}}, maximum{{4095, 2048, 2048, 4095}};
    TEST_ASSERT_TRUE(rig.events[0].type == EventType::Raw);
    TEST_ASSERT_EQUAL_UINT16_ARRAY(minimum.data(), rig.events[0].rawMin.data(), 4);
    TEST_ASSERT_EQUAL_UINT16_ARRAY(maximum.data(), rig.events[0].rawMax.data(), 4);
    auto doc = encoded(rig.events[0]);
    TEST_ASSERT_EQUAL_STRING("raw", doc["t"]);
    TEST_ASSERT_EQUAL_UINT(4, doc["min"].size());
    TEST_ASSERT_EQUAL_UINT(4095, doc["max"][3].as<unsigned>());
    rig.idleTo(50000);
    TEST_ASSERT_EQUAL_UINT(2, rig.events.size());
    TEST_ASSERT_EQUAL_UINT16(200, rig.events[1].rawMin[0]);
    rig.detector.setMode(parse(R"({"t":"mode","mode":"run"})").mode);
    rig.events.clear();
    rig.hit(60000, {{500, 0, 0, 0}});
    rig.idleTo(380000);
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_TRUE(rig.events[0].type == EventType::Tap);
}

void test_templates_metal_legacy_and_confidence() {
    Calibration cal;
    cal.hasTemplates = true;
    cal.templates = {{{{2, 3, 0, 0}}, {{0, 1, 0, 0}}, {{0, 0, 1, 0}}, {{0, 0, 0, 1}}}};
    cal.strongMin[0] = 650;
    Rig metal;
    TEST_ASSERT_TRUE(metal.detector.setCalibration(cal));
    metal.hit(10000, {{500, 750, 0, 0}});
    metal.idleTo(330000);
    TEST_ASSERT_EQUAL_UINT(0, metal.events[0].region);
    TEST_ASSERT_TRUE(metal.events[0].strong); // amp, not region channel
    TEST_ASSERT_FLOAT_WITHIN(0.0001, 1, metal.events[0].confidence);
    Rig legacy;
    legacy.hit(10000, {{500, 750, 0, 0}});
    legacy.idleTo(330000);
    TEST_ASSERT_EQUAL_UINT(1, legacy.events[0].region);
    TEST_ASSERT_FLOAT_WITHIN(0.0001, 1.0f - 500.0f / 750, legacy.events[0].confidence);
    cal.templates[1] = cal.templates[0];
    Rig tied;
    TEST_ASSERT_TRUE(tied.detector.setCalibration(cal));
    tied.hit(10000, {{500, 750, 0, 0}});
    tied.idleTo(330000);
    TEST_ASSERT_FLOAT_WITHIN(0.0001, 0, tied.events[0].confidence);
}

void test_templates_storage_and_invalid_rows() {
    const char* json = R"({"t":"set_cal","cal":{"threshold":[90,85,100,88],"strongMin":[520,480,600,500],"doubleWindowMs":370,"refractoryMs":250,"templates":[[2,3,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}})";
    const Command command = parse(json);
    TEST_ASSERT_TRUE(command.type == CommandType::SetCalibration);
    TEST_ASSERT_TRUE(command.cal.hasTemplates);
    TEST_ASSERT_FLOAT_WITHIN(0.00001, 2 / std::sqrt(13.0), command.cal.templates[0][0]);
    char buffer[kMaxLine + 1];
    auto length = encodeCalibration(command.cal, buffer, sizeof(buffer));
    TEST_ASSERT_GREATER_THAN(0, length);
    auto restored = parseCommand(buffer, length);
    TEST_ASSERT_TRUE(restored.type == CommandType::SetCalibration);
    TEST_ASSERT_TRUE(restored.cal.hasTemplates);
    TEST_ASSERT_FLOAT_WITHIN(0.00001, command.cal.templates[0][1], restored.cal.templates[0][1]);
    auto legacy = parse(R"({"t":"set_cal","cal":{"threshold":[150,150,150,150],"strongMin":[700,700,700,700],"doubleWindowMs":320,"refractoryMs":70}})");
    TEST_ASSERT_TRUE(legacy.type == CommandType::SetCalibration);
    TEST_ASSERT_FALSE(legacy.cal.hasTemplates);
    for (const char* bad : {"null", "[]", "[[0,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]", "[[1,2,3],[0,1,0,0],[0,0,1,0],[0,0,0,1]]", "[[1e100,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]"}) {
        std::string value(json);
        auto start = value.find("[[2,");
        value.replace(start, value.size() - start - 2, bad);
        TEST_ASSERT_TRUE(parse(value.c_str()).type == CommandType::Invalid);
    }
    Calibration invalid = command.cal;
    invalid.templates[0].fill(0);
    Rig rig;
    TEST_ASSERT_FALSE(rig.detector.setCalibration(invalid));
    invalid.templates[0][0] = std::numeric_limits<float>::infinity();
    TEST_ASSERT_FALSE(rig.detector.setCalibration(invalid));
}

void test_ring_quiet_reset_cap_and_peak_capture() {
    Rig rig;
    rig.detector.setMode(Mode::Calibrate);
    rig.hit(10000, {{500, 0, 0, 0}});
    TEST_ASSERT_EQUAL_UINT(1, rig.events.size());
    TEST_ASSERT_EQUAL_UINT32(10, rig.events[0].ring);
    TEST_ASSERT_EQUAL_UINT32(15, rig.events[0].ms);
    TEST_ASSERT_EQUAL_UINT32(10, encoded(rig.events[0])["ring"].as<unsigned>());
    Rig latePeak;
    latePeak.detector.setMode(Mode::Calibrate);
    latePeak.at(10000, {{2548, 2048, 2048, 2048}});
    latePeak.at(24000, {{2048, 2848, 2048, 2048}});
    latePeak.idleTo(25000);
    TEST_ASSERT_EQUAL_UINT(1, latePeak.events.size());
    TEST_ASSERT_EQUAL_UINT32(10, latePeak.events[0].ring);
    TEST_ASSERT_EQUAL_UINT16(800, latePeak.events[0].peaks[1]);
    Rig ringing;
    ringing.detector.setMode(Mode::Calibrate);
    ringing.at(10000, {{2548, 2048, 2048, 2048}});
    ringing.at(19000, {{2248, 2048, 2048, 2048}});
    ringing.at(28000, {{2248, 2048, 2048, 2048}});
    ringing.idleTo(38000);
    TEST_ASSERT_TRUE(ringing.events.empty());
    ringing.idleTo(38500);
    TEST_ASSERT_EQUAL_UINT(1, ringing.events.size());
    TEST_ASSERT_EQUAL_UINT32(28, ringing.events[0].ring);
    TEST_ASSERT_EQUAL_UINT16(500, ringing.events[0].peaks[0]);
    Rig endless;
    endless.detector.setMode(Mode::Calibrate);
    endless.quiet[0] = 2548;
    endless.idleTo(1000000);
    TEST_ASSERT_TRUE(endless.events.empty());
    endless.idleTo(1000500);
    TEST_ASSERT_EQUAL_UINT(1, endless.events.size());
    TEST_ASSERT_EQUAL_UINT32(1000, endless.events[0].ring);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_templates_metal_legacy_and_confidence);
    RUN_TEST(test_templates_storage_and_invalid_rows);
    RUN_TEST(test_ring_quiet_reset_cap_and_peak_capture);
    RUN_TEST(test_circuit_saturation);
    RUN_TEST(test_circuit_raw_and_pins);
    RUN_TEST(test_biased_bipolar_input_all_channels_and_strengths);
    RUN_TEST(test_defaults_and_invalid_calibration);
    RUN_TEST(test_single_waits_until_onset_deadline);
    RUN_TEST(test_peak_window_uses_later_channel_maximum);
    RUN_TEST(test_region_selected_by_maximum_not_first_trigger);
    RUN_TEST(test_peak_window_excludes_sample_at_end);
    RUN_TEST(test_dc_tracks_quiet_baseline_drift);
    RUN_TEST(test_double_uses_stronger_hit_and_lower_confidence);
    RUN_TEST(test_double_preserves_strong_first_hit);
    RUN_TEST(test_double_at_exact_deadline_finishes_after_deadline);
    RUN_TEST(test_late_second_hit_is_two_singles);
    RUN_TEST(test_other_region_flushes_first_then_becomes_pending);
    RUN_TEST(test_refractory_suppresses_ringing_and_accepts_boundary);
    RUN_TEST(test_dc_offset_negative_signal_and_quiet_do_not_trigger);
    RUN_TEST(test_threshold_strict_and_per_channel_calibration_immediate);
    RUN_TEST(test_equal_peaks_have_zero_confidence);
    RUN_TEST(test_mode_and_calibration_changes_cancel_pending_and_active_hits);
    RUN_TEST(test_noise_peak_rms_duration_and_busy);
    RUN_TEST(test_long_uptime_does_not_wrap_hit_timing);
    RUN_TEST(test_protocol_parses_all_commands_and_float_calibration);
    RUN_TEST(test_protocol_ignores_malformed_and_unknown_lines);
    RUN_TEST(test_protocol_rejects_invalid_mode_and_calibration_atomically);
    RUN_TEST(test_protocol_encodes_all_events);
    RUN_TEST(test_persisted_calibration_round_trips);
    RUN_TEST(test_line_framing_partial_crlf_overflow_and_recovery);
    return UNITY_END();
}
