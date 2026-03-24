#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include <cstdint>
#include <cstring>

// Thread-safe ring buffer for Opus frames, backed by a FreeRTOS queue.
// Max frame size 256 bytes covers all Opus payloads from Roku.

struct AudioFrame {
    uint8_t data[256];
    uint16_t len;
};

class AudioBuffer {
public:
    static const size_t MAX_FRAMES = 250;  // ~5 seconds at 20ms/frame

    AudioBuffer() {
        queue_ = xQueueCreate(MAX_FRAMES, sizeof(AudioFrame));
    }

    ~AudioBuffer() {
        if (queue_) vQueueDelete(queue_);
    }

    void push(const uint8_t* data, size_t len) {
        if (!queue_ || len > sizeof(AudioFrame::data)) return;
        AudioFrame frame;
        frame.len = static_cast<uint16_t>(len);
        memcpy(frame.data, data, len);

        if (xQueueSend(queue_, &frame, 0) != pdTRUE) {
            // Queue full — drop oldest frame and retry
            AudioFrame discard;
            xQueueReceive(queue_, &discard, 0);
            xQueueSend(queue_, &frame, 0);
            overflow_count_ = overflow_count_ + 1;
            // Log every 50 overflows to avoid spamming
            if (overflow_count_ % 50 == 1) {
                ESP_LOGW("audio_buf", "Buffer overflow (total drops: %lu)",
                         (unsigned long)overflow_count_);
            }
        }
    }

    // Blocks until a frame is available or timeout.
    // Returns frame length, or 0 on timeout.
    uint16_t pop(AudioFrame& frame, int timeout_ms = 1000) {
        if (!queue_) return 0;
        if (xQueueReceive(queue_, &frame, pdMS_TO_TICKS(timeout_ms)) == pdTRUE) {
            return frame.len;
        }
        return 0;
    }

    void clear() {
        if (queue_) xQueueReset(queue_);
        overflow_count_ = 0;
    }

    uint32_t overflow_count() const { return overflow_count_; }

private:
    QueueHandle_t queue_ = nullptr;
    volatile uint32_t overflow_count_ = 0;
};
