// findHealthBars.cc – EXTREME PERFORMANCE EDITION (LOGIC FIXED)
#include <napi.h>
#include <vector>
#include <thread>
#include <cstdint>
#include <algorithm>
#include <cmath>
#include <immintrin.h>
#include <array>

inline bool IsKnownBarColor(uint32_t c) {
    switch(c) {
        case 49152:      // 0x0000C000
        case 12582912:   // 0x00C00000
        case 6340704:    // 0x0060C060
        case 12632064:   // 0x00C0C000
        case 12595248:   // 0x00C03030
        case 6291456:    // 0x00600000
            return true;
        default:
            return false;
    }
}

struct FoundHealthBar {
    int x, y;
    std::string healthTag;
};

struct WorkerData {
    const uint8_t* bgraData;
    uint32_t width, height, stride;
    uint32_t searchX, searchY, searchW, searchH;
    std::vector<FoundHealthBar>* globalResults;
    std::mutex* resultsMutex;
};

inline bool IsBlack(const uint8_t* p) {
    return p[0] == 0 && p[1] == 0 && p[2] == 0;
}

inline bool ValidateRightBorder(const WorkerData& data, uint32_t x, uint32_t y) {
    const uint32_t right_x = x + 30;
    if (right_x >= data.width) return false;

    const uint8_t* p0 = data.bgraData + (y * data.stride) + (right_x * 4);
    const uint8_t* p1 = data.bgraData + ((y + 1) * data.stride) + (right_x * 4);
    const uint8_t* p2 = data.bgraData + ((y + 2) * data.stride) + (right_x * 4);
    const uint8_t* p3 = data.bgraData + ((y + 3) * data.stride) + (right_x * 4);

    return IsBlack(p0) && IsBlack(p1) && IsBlack(p2) && IsBlack(p3);
}

inline std::string GetHealthTagFromColor(uint32_t color) {
    if (color == 0x600000) return "Critical";
    if (color == 0xC00000 || color == 0xC03030) return "Low";
    if (color == 0xC0C000) return "Medium";
    if (color == 0x60C060) return "High";
    if (color == 0x00C000) return "Full";
    return "Full";
}

thread_local static std::vector<FoundHealthBar> tls_results;

void HealthBarWorker(WorkerData data) {
    tls_results.clear();

    const __m256i zero = _mm256_setzero_si256();
    const __m256i bgr_mask = _mm256_set1_epi32(0x00FFFFFF);

    uint32_t startY = data.searchY;
    uint32_t endY = data.searchY + data.searchH;

    for (uint32_t y = startY; y < endY; ++y) {
        if ((y & 7) == 0) {
            size_t prefetchY = std::min(y + 32, data.height - 1);
            _mm_prefetch((const char*)(data.bgraData + (prefetchY * data.stride)), _MM_HINT_T0);
        }

        if (y + 3 >= endY) break;

        const uint8_t* row0 = data.bgraData + (y * data.stride);
        const uint8_t* row1 = data.bgraData + ((y + 1) * data.stride);
        const uint8_t* row2 = data.bgraData + ((y + 2) * data.stride);
        const uint8_t* row3 = data.bgraData + ((y + 3) * data.stride);

        uint32_t x = data.searchX;
        const uint32_t endX = data.searchX + data.searchW - 31;

        for (; x + 8 <= endX; x += 8) {
            __m256i chunk0 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row0 + x * 4));
            __m256i chunk1 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row1 + x * 4));
            __m256i chunk2 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row2 + x * 4));
            __m256i chunk3 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row3 + x * 4));

            chunk0 = _mm256_and_si256(chunk0, bgr_mask);
            chunk1 = _mm256_and_si256(chunk1, bgr_mask);
            chunk2 = _mm256_and_si256(chunk2, bgr_mask);
            chunk3 = _mm256_and_si256(chunk3, bgr_mask);

            __m256i cmp0 = _mm256_cmpeq_epi32(chunk0, zero);
            __m256i cmp1 = _mm256_cmpeq_epi32(chunk1, zero);
            __m256i cmp2 = _mm256_cmpeq_epi32(chunk2, zero);
            __m256i cmp3 = _mm256_cmpeq_epi32(chunk3, zero);

            __m256i vertical_match = _mm256_and_si256(_mm256_and_si256(cmp0, cmp1), _mm256_and_si256(cmp2, cmp3));
            int mask = _mm256_movemask_ps(_mm256_castsi256_ps(vertical_match));

            if (mask == 0) continue;

            for (int j = 0; j < 8; ++j) {
                if (mask & (1 << j)) {
                    uint32_t current_x = x + j;

                    if (!ValidateRightBorder(data, current_x, y)) continue;

                    const uint8_t* innerPixelPtr = row1 + (current_x + 1) * 4;
                    uint32_t innerColor = (static_cast<uint32_t>(innerPixelPtr[2]) << 16) |
                                          (static_cast<uint32_t>(innerPixelPtr[1]) << 8) |
                                          innerPixelPtr[0];

                    if (!IsKnownBarColor(innerColor)) continue;

                    int centerX = static_cast<int>(current_x + 15);
                    int centerY = static_cast<int>(y + 2);
                    std::string healthTag = GetHealthTagFromColor(innerColor);

                    tls_results.push_back({ centerX, centerY, healthTag });
                }
            }
        }

        for (; x < endX; ++x) {
            if (!IsBlack(row0 + x * 4)) continue;
            if (!IsBlack(row1 + x * 4)) continue;
            if (!IsBlack(row2 + x * 4)) continue;
            if (!IsBlack(row3 + x * 4)) continue;

            if (!ValidateRightBorder(data, x, y)) continue;

            const uint8_t* innerPixelPtr = row1 + (x + 1) * 4;
            uint32_t innerColor = (static_cast<uint32_t>(innerPixelPtr[2]) << 16) |
                                  (static_cast<uint32_t>(innerPixelPtr[1]) << 8) |
                                  innerPixelPtr[0];

            if (!IsKnownBarColor(innerColor)) continue;

            int centerX = static_cast<int>(x + 15);
            int centerY = static_cast<int>(y + 2);
            std::string healthTag = GetHealthTagFromColor(innerColor);

            tls_results.push_back({ centerX, centerY, healthTag });
        }
    }

    if (!tls_results.empty()) {
        std::lock_guard<std::mutex> lock(*data.resultsMutex);
        data.globalResults->insert(data.globalResults->end(), tls_results.begin(), tls_results.end());
    }
}

std::vector<FoundHealthBar> ClusterBars(std::vector<FoundHealthBar>& results) {
    if (results.empty()) return {};

    const int CELL_WIDTH = 32;
    const int CELL_HEIGHT = 4;

    int minX = results[0].x, maxX = results[0].x;
    int minY = results[0].y, maxY = results[0].y;
    for (const auto& r : results) {
        minX = std::min(minX, r.x);
        maxX = std::max(maxX, r.x);
        minY = std::min(minY, r.y);
        maxY = std::max(maxY, r.y);
    }

    int gridW = (maxX - minX) / CELL_WIDTH + 1;
    int gridH = (maxY - minY) / CELL_HEIGHT + 1;

    std::vector<std::vector<std::vector<size_t>>> grid(
        gridH, std::vector<std::vector<size_t>>(gridW)
    );

    for (size_t i = 0; i < results.size(); ++i) {
        int cellX = (results[i].x - minX) / CELL_WIDTH;
        int cellY = (results[i].y - minY) / CELL_HEIGHT;
        if (cellX < 0) cellX = 0;
        if (cellY < 0) cellY = 0;
        if (cellX >= gridW) cellX = gridW - 1;
        if (cellY >= gridH) cellY = gridH - 1;
        grid[cellY][cellX].push_back(i);
    }

    std::vector<bool> visited(results.size(), false);
    std::vector<FoundHealthBar> mergedResults;

    for (size_t i = 0; i < results.size(); ++i) {
        if (visited[i]) continue;

        std::vector<size_t> cluster;
        cluster.push_back(i);
        visited[i] = true;

        size_t head = 0;
        while (head < cluster.size()) {
            size_t current_idx = cluster[head++];
            const auto& current = results[current_idx];

            int cellX = (current.x - minX) / CELL_WIDTH;
            int cellY = (current.y - minY) / CELL_HEIGHT;

            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    int nx = cellX + dx;
                    int ny = cellY + dy;
                    if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;

                    for (size_t j : grid[ny][nx]) {
                        if (visited[j]) continue;
                        const int barWidth = 31;
                        const int barHeight = 4;
                        bool x_touch = std::abs(current.x - results[j].x) <= barWidth;
                        bool y_touch = std::abs(current.y - results[j].y) <= barHeight;
                        if (x_touch && y_touch) {
                            visited[j] = true;
                            cluster.push_back(j);
                        }
                    }
                }
            }
        }

        double sumX = 0, sumY = 0;
        for (size_t idx : cluster) {
            sumX += results[idx].x;
            sumY += results[idx].y;
        }

        mergedResults.push_back({
            static_cast<int>(std::round(sumX / cluster.size())),
            static_cast<int>(std::round(sumY / cluster.size())),
            results[cluster[0]].healthTag
        });
    }

    return mergedResults;
}

Napi::Value FindHealthBars(const Napi::CallbackInfo& info) {
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

    if (x >= width || y >= height) return Napi::Array::New(env, 0);
    w = std::min(w, width - x);
    h = std::min(h, height - y);
    if (w < 32 || h < 4) return Napi::Array::New(env, 0);

    std::vector<FoundHealthBar> globalResults;
    std::mutex globalResultsMutex;

    unsigned numThreads = std::thread::hardware_concurrency();
    if (numThreads == 0) numThreads = 4;
    numThreads = std::min(numThreads, h / 4);
    if (numThreads == 0) numThreads = 1;

    std::vector<std::thread> threads;
    for (unsigned i = 0; i < numThreads; ++i) {
        uint32_t startRow = y + (i * h) / numThreads;
        uint32_t endRow = y + ((i + 1) * h) / numThreads;
        uint32_t chunkHeight = endRow - startRow;

        if (chunkHeight < 4) continue;

        threads.emplace_back(HealthBarWorker, WorkerData{
            bgraData, width, height, stride,
            x, startRow, w, chunkHeight,
            &globalResults,
            &globalResultsMutex
        });
    }

    for (auto& t : threads) {
        if (t.joinable()) t.join();
    }

    std::vector<FoundHealthBar> mergedResults = ClusterBars(globalResults);

    Napi::Array out = Napi::Array::New(env, mergedResults.size());
    for (size_t i = 0; i < mergedResults.size(); ++i) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("x", mergedResults[i].x);
        obj.Set("y", mergedResults[i].y);
        obj.Set("healthTag", Napi::String::New(env, mergedResults[i].healthTag));
        out[i] = obj;
    }

    return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("findHealthBars", Napi::Function::New(env, FindHealthBars));
    return exports;
}

NODE_API_MODULE(findHealthBars, Init)