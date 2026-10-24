#include <Arduino.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include <Detector.h>
#include <BoardPins.h>
#include <Protocol.h>

namespace {
using namespace deskapi;

constexpr uint64_t kSamplePeriodUs = 500; // One complete four-channel frame at 2 kHz.
QueueHandle_t commandQueue = nullptr;
QueueHandle_t eventQueue = nullptr;
QueueHandle_t responseQueue = nullptr;
SemaphoreHandle_t responseSlots = nullptr;
TaskHandle_t samplingTask = nullptr;
esp_timer_handle_t sampleTimer = nullptr;
Preferences preferences;
bool storageReady = false;
bool calibrated = false; // Used only by loop(), never by the sampling task.
LineBuffer input;

void queueEvent(const Event& event, void*) {
    // A stalled host must never block ADC acquisition. 64 events buffer several
    // seconds of physical hits; overflow drops new telemetry, not sampling.
    xQueueSend(eventQueue, &event, 0);
}

Detector detector(queueEvent);

void sendEvent(const Event& event) {
    char json[kMaxLine + 2];
    const size_t length = encodeEvent(event, json, sizeof(json));
    if (length) {
#if ARDUINO_USB_CDC_ON_BOOT && ARDUINO_USB_MODE
        // One complete line or nothing; never wait for an absent/stalled host.
        if (Serial.availableForWrite() < static_cast<int>(length + 1)) return;
#endif
        json[length] = '\n';
        Serial.write(reinterpret_cast<const uint8_t*>(json), length + 1);
    }
}

void ack(const char* of, bool ok, const char* error = "") {
    Event event{};
    event.type = EventType::Ack;
    event.of = of;
    event.ok = ok;
    event.error = error;
    sendEvent(event);
}

void hello() {
    Event event{};
    event.type = EventType::Hello;
    event.calibrated = calibrated;
    sendEvent(event);
}

void handleCommand(const Command& command) {
    switch (command.type) {
    case CommandType::Ignore:
        return;
    case CommandType::Ping:
        hello();
        return;
    case CommandType::Invalid:
        ack(command.of, false, command.error);
        return;
    default:
        break;
    }
    // Only loop() produces commands, so this free slot cannot be taken by a
    // second producer while an NVS write is in progress.
    const bool needsAck = command.type == CommandType::Mode || command.type == CommandType::SetCalibration;
    if (uxQueueSpacesAvailable(commandQueue) == 0) {
        if (command.type == CommandType::Mode || command.type == CommandType::SetCalibration) {
            ack(command.of, false, "busy");
        }
        return;
    }
    // Reserve an acknowledgement slot until loop() has consumed the result.
    // This includes commands currently in flight on the other CPU core.
    if (needsAck && xSemaphoreTake(responseSlots, 0) != pdTRUE) {
        ack(command.of, false, "busy");
        return;
    }
    if (command.type == CommandType::SetCalibration) {
        char json[kMaxLine + 1];
        const size_t length = encodeCalibration(command.cal, json, sizeof(json));
        if (!storageReady || length == 0 || preferences.putString("cal_v1", json) != length) {
            xSemaphoreGive(responseSlots);
            ack("set_cal", false, "nvs_write_failed");
            return;
        }
        calibrated = true;
    }
    xQueueSend(commandQueue, &command, 0);
}

void timerTick(void*) {
    // ESP_TIMER_TASK callback (not ISR); keep it short, ADC work is separate.
    xTaskNotifyGive(samplingTask);
}

void sampleTask(void*) {
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        const uint64_t nowUs = static_cast<uint64_t>(esp_timer_get_time());
        Command command{};
        // Bounded work per frame, even if a host floods commands.
        if (xQueueReceive(commandQueue, &command, 0) == pdTRUE) {
            Event response{};
            response.type = EventType::Ack;
            response.of = command.of;
            if (command.type == CommandType::Mode) {
                detector.setMode(command.mode);
                xQueueSend(responseQueue, &response, 0);
            } else if (command.type == CommandType::SetCalibration) {
                detector.setCalibration(command.cal);
                xQueueSend(responseQueue, &response, 0);
            } else if (command.type == CommandType::MeasureNoise) {
                detector.measureNoise(command.durationMs, nowUs);
            }
        }
        Samples raw{};
        for (unsigned i = 0; i < kChannels; ++i) raw[i] = analogRead(kPins[i]);
        detector.sample(raw, nowUs);
    }
}

} // namespace

void setup() {
#if ARDUINO_USB_CDC_ON_BOOT && ARDUINO_USB_MODE
    Serial.setTxBufferSize(1024); // More than one maximum protocol line.
    Serial.begin(115200);
    Serial.setTxTimeoutMs(0);
#else
    Serial.begin(115200, SERIAL_8N1);
#endif
    analogReadResolution(12);
    for (uint8_t pin : kPins) {
        pinMode(pin, INPUT);
        // Arduino-ESP32 2.x calls the highest (nominal 12 dB) setting ADC_11db.
        analogSetPinAttenuation(pin, ADC_11db);
        analogRead(pin); // Initialize ADC drivers before starting the timer.
    }

    storageReady = preferences.begin("deskapi", false);
    if (storageReady) {
        char json[kMaxLine + 1];
        // Preferences::getString(char*) returns the size INCLUDING the NUL.
        const size_t storedSize = preferences.isKey("cal_v1") ?
            preferences.getString("cal_v1", json, sizeof(json)) : 0;
        if (storedSize > 1 && storedSize <= sizeof(json)) {
            const Command saved = parseCommand(json, storedSize - 1);
            if (saved.type == CommandType::SetCalibration) {
                calibrated = detector.setCalibration(saved.cal);
            }
        }
    }

    commandQueue = xQueueCreate(8, sizeof(Command));
    eventQueue = xQueueCreate(64, sizeof(Event));
    responseQueue = xQueueCreate(16, sizeof(Event));
    responseSlots = xSemaphoreCreateCounting(16, 16);
    configASSERT(commandQueue && eventQueue && responseQueue && responseSlots);
    const BaseType_t created = xTaskCreatePinnedToCore(sampleTask, "deskapi-adc", 4096,
                                                     nullptr, 20, &samplingTask, 1);
    configASSERT(created == pdPASS);
    esp_timer_create_args_t timerArgs{};
    timerArgs.callback = timerTick;
    timerArgs.dispatch_method = ESP_TIMER_TASK;
    timerArgs.name = "deskapi-2khz";
    timerArgs.skip_unhandled_events = true;
    ESP_ERROR_CHECK(esp_timer_create(&timerArgs, &sampleTimer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(sampleTimer, kSamplePeriodUs));
    hello();
}

void loop() {
    Event event{};
    for (unsigned sent = 0; sent < 16 && xQueueReceive(responseQueue, &event, 0) == pdTRUE; ++sent) {
        xSemaphoreGive(responseSlots);
        sendEvent(event);
    }
    for (unsigned sent = 0; sent < 8 && xQueueReceive(eventQueue, &event, 0) == pdTRUE; ++sent) {
        sendEvent(event);
    }
    // Never wait for a complete line or allow unbounded host input work.
    for (unsigned read = 0; read < 128 && Serial.available() > 0; ++read) {
        if (input.push(static_cast<char>(Serial.read()))) {
            handleCommand(parseCommand(input.data(), input.size()));
        }
    }
    delay(1);
}
