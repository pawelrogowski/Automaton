// findHealthBars.cc – Final optimization with Multi-Row Vertical SIMD Check
#include <napi.h>
#include <vector>
#include <thread>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <algorithm>
#include <cmath>
#include <chrono>
#include <iostream>
#include <set>
#include <immintrin.h>

const std::set<uint32_t> knownBarColors = {
    49152, 12582912, 6340704, 12632064, 12595248
};

struct FoundHealthBar {
    int x, y;
};

struct WorkerData {
    const uint8_t* bgraData;
    uint32_t width, height, stride;
    uint32_t searchX, searchY, searchW, searchH;
    std::atomic<uint32_t>* nextRow;
    std::vector<FoundHealthBar>* results;
    std::mutex* resultsMutex;
};

inline bool IsBlack(const uint8_t* p) {
    return p[0] == 0 && p[1] == 0 && p[2] == 0;
}

inline bool ValidateRightBorder(const WorkerData& data, uint32_t x, uint32_t y) {
    const uint32_t right_x = x + 30;
    if (!IsBlack(data.bgraData + (y * data.stride) + (right_x * 4))) return false;
    if (!IsBlack(data.bgraData + ((y + 1) * data.stride) + (right_x * 4))) return false;
    if (!IsBlack(data.bgraData + ((y + 2) * data.stride) + (right_x * 4))) return false;
    if (!IsBlack(data.bgraData + ((y + 3) * data.stride) + (right_x * 4))) return false;
    return true;
}

void HealthBarWorker(WorkerData data) {
    const uint32_t rowChunkSize = 16;
    const __m256i zero = _mm256_setzero_si256();
    const __m256i bgr_mask = _mm256_set1_epi32(0x00FFFFFF);

    while (true) {
        uint32_t startY = data.nextRow->fetch_add(rowChunkSize);
        if (startY >= data.searchY + data.searchH) break;

        uint32_t endY = std::min(startY + rowChunkSize, data.searchY + data.searchH);

        // We need to read 4 rows at a time, so adjust the loop boundary
        for (uint32_t y = startY; y < endY - 3; ++y) {
            const uint8_t* row0 = data.bgraData + (y * data.stride);
            const uint8_t* row1 = data.bgraData + ((y + 1) * data.stride);
            const uint8_t* row2 = data.bgraData + ((y + 2) * data.stride);
            const uint8_t* row3 = data.bgraData + ((y + 3) * data.stride);

            uint32_t x = data.searchX;
            const uint32_t endX = data.searchX + data.searchW - 31;

            for (; x + 8 <= endX; x += 8) {
                // --- Stage 1: Find a complete 4-pixel vertical black line using only AVX2 ---
                __m256i chunk0 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row0 + x * 4));
                __m256i chunk1 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row1 + x * 4));
                __m256i chunk2 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row2 + x * 4));
                __m256i chunk3 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row3 + x * 4));

                // Mask out the alpha channel for all 4 rows
                chunk0 = _mm256_and_si256(chunk0, bgr_mask);
                chunk1 = _mm256_and_si256(chunk1, bgr_mask);
                chunk2 = _mm256_and_si256(chunk2, bgr_mask);
                chunk3 = _mm256_and_si256(chunk3, bgr_mask);

                // Compare each row to zero
                __m256i cmp0 = _mm256_cmpeq_epi32(chunk0, zero);
                __m256i cmp1 = _mm256_cmpeq_epi32(chunk1, zero);
                __m256i cmp2 = _mm256_cmpeq_epi32(chunk2, zero);
                __m256i cmp3 = _mm256_cmpeq_epi32(chunk3, zero);

                // Combine the results. A bit is 1 only if it was 1 in ALL FOUR comparisons.
                __m256i vertical_match = _mm256_and_si256(_mm256_and_si256(cmp0, cmp1), _mm256_and_si256(cmp2, cmp3));
                int mask = _mm256_movemask_ps(_mm256_castsi256_ps(vertical_match));

                if (mask == 0) continue; // The fastest path. No vertical black lines found.

                // --- Stage 2 & 3: A vertical line was found, now do the final C++ checks ---
                for (int j = 0; j < 8; ++j) {
                    if (mask & (1 << j)) {
                        uint32_t current_x = x + j;

                        const uint8_t* innerPixelPtr = data.bgraData + ((y + 1) * data.stride) + ((current_x + 1) * 4);
                        uint32_t innerColor = (static_cast<uint32_t>(innerPixelPtr[2]) << 16) | (static_cast<uint32_t>(innerPixelPtr[1]) << 8) | innerPixelPtr[0];

                        if (knownBarColors.count(innerColor)) {
                            if (ValidateRightBorder(data, current_x, y)) {
                                int centerX = static_cast<int>(current_x + 15);
                                int centerY = static_cast<int>(y + 2);
                                std::lock_guard<std::mutex> lock(*data.resultsMutex);
                                data.results->push_back({ centerX, centerY });
                            }
                        }
                    }
                }
            }

            // Remainder loop (unchanged, as it's not performance-critical)
            for (; x < endX; ++x) {
                if (!IsBlack(row0 + x * 4)) continue;
                if (!IsBlack(row1 + x * 4)) continue;
                if (!IsBlack(row2 + x * 4)) continue;
                if (!IsBlack(row3 + x * 4)) continue;

                const uint8_t* innerPixelPtr = row1 + (x + 1) * 4;
                uint32_t innerColor = (static_cast<uint32_t>(innerPixelPtr[2]) << 16) | (static_cast<uint32_t>(innerPixelPtr[1]) << 8) | innerPixelPtr[0];

                if (knownBarColors.count(innerColor)) {
                    if (ValidateRightBorder(data, x, y)) {
                        int centerX = static_cast<int>(x + 15);
                        int centerY = static_cast<int>(y + 2);
                        std::lock_guard<std::mutex> lock(*data.resultsMutex);
                        data.results->push_back({ centerX, centerY });
                    }
                }
            }
        }
    }
}

// ... (IsTouching, FindHealthBars, and Init functions are unchanged) ...
bool IsTouching(const FoundHealthBar& a, const FoundHealthBar& b) {
    const int barWidth = 31;
    const int barHeight = 4;
    bool x_touch = std::abs(a.x - b.x) <= barWidth;
    bool y_touch = std::abs(a.y - b.y) <= barHeight;
    return x_touch && y_touch;
}

Napi::Value FindHealthBars(const Napi::CallbackInfo& info) {
    auto startTime = std::chrono::high_resolution_clock::now();
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected (Buffer, Object searchArea)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    const uint8_t* bufferData = buffer.Data();
    size_t bufferLength = buffer.Length();

    if (bufferLength < 8) {
        Napi::Error::New(env, "Buffer too small for header").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t width  = *reinterpret_cast<const uint32_t*>(bufferData);
    uint32_t height = *reinterpret_cast<const uint32_t*>(bufferData + 4);
    const uint8_t* bgraData = bufferData + 8;
    size_t dataLength = bufferLength - 8;
    uint32_t stride = width * 4;

    if (dataLength < width * height * 4) {
        Napi::Error::New(env, "Buffer does not contain full image data").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object area = info[1].As<Napi::Object>();
    uint32_t x = area.Get("x").As<Napi::Number>().Uint32Value();
    uint32_t y = area.Get("y").As<Napi::Number>().Uint32Value();
    uint32_t w = area.Get("width").As<Napi::Number>().Uint32Value();
    uint32_t h = area.Get("height").As<Napi::Number>().Uint32Value();

    std::vector<FoundHealthBar> results;
    std::mutex resultsMutex;
    std::atomic<uint32_t> nextRow(y);

    unsigned numThreads = std::thread::hardware_concurrency();
    if (!numThreads) numThreads = 4;

    std::vector<std::thread> threads;
    for (unsigned i = 0; i < numThreads; ++i) {
        threads.emplace_back(HealthBarWorker, WorkerData{
            bgraData, width, height, stride,
            x, y, w, h,
            &nextRow, &results, &resultsMutex
        });
    }

    for (auto& t : threads) t.join();

    size_t initialResultsCount = results.size();

    std::vector<FoundHealthBar> isolatedResults;
    if (!results.empty()) {
        std::vector<bool> visited(results.size(), false);
        for (size_t i = 0; i < results.size(); ++i) {
            if (visited[i]) continue;
            std::vector<size_t> q;
            q.push_back(i);
            visited[i] = true;
            size_t head = 0;
            while(head < q.size()){
                size_t current_idx = q[head++];
                for (size_t j = 0; j < results.size(); ++j) {
                    if (!visited[j] && IsTouching(results[current_idx], results[j])) {
                        visited[j] = true;
                        q.push_back(j);
                    }
                }
            }
            if (q.size() == 1) {
                isolatedResults.push_back(results[i]);
            }
        }
    }

    Napi::Array out = Napi::Array::New(env, isolatedResults.size());
    for (size_t i = 0; i < isolatedResults.size(); ++i) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("x", isolatedResults[i].x);
        obj.Set("y", isolatedResults[i].y);
        out[i] = obj;
    }

    auto endTime = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count();
    std::cout << "[findHealthBars] Processed in " << duration << "us. "
              << "Threads: " << numThreads << ". "
              << "Initial Detections: " << initialResultsCount << ". "
              << "Final Results: " << isolatedResults.size() << "." << std::endl;

    return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("findHealthBars", Napi::Function::New(env, FindHealthBars));
    return exports;
}

NODE_API_MODULE(findHealthBars, Init)