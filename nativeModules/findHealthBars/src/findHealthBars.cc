// findHealthBars.cc – EXTREME PERFORMANCE EDITION (FULL BORDER VALIDATION + NEW COLOR)
#include <napi.h>
#include <vector>
#include <thread>
#include <cstdint>
#include <algorithm>
#include <cmath>
#include <immintrin.h>
#include <array>
#include <mutex>

inline bool IsKnownBarColor(uint32_t c) {
    switch(c) {
        case 0:          // 0x00000000 (Black - treat as valid interior for empty/critical bars)
        case 49152:      // 0x0000C000
        case 12582912:   // 0x00C00000
        case 6340704:    // 0x0060C060
        case 12632064:   // 0x00C0C000
        case 12595248:   // 0x00C03030
        case 6291456:    // 0x00600000
        // --- NEW COLOR ADDED ---
        case 12632256:   // 0x00C0C0C0 (Gray [192, 192, 192])
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

    // Exclusion mask is restricted to the search area for better cache locality.
    // maskWidth = searchW, maskHeight = searchH, origin at (searchX, searchY).
    uint32_t maskWidth;
    uint32_t maskHeight;
    uint32_t maskOffsetX;
    uint32_t maskOffsetY;

    std::vector<FoundHealthBar>* globalResults;
    std::mutex* resultsMutex;
    uint8_t* exclusionMask; // 0 = not excluded, 1 = excluded
};

inline bool IsBlack(const uint8_t* p) {
    return p[0] == 0 && p[1] == 0 && p[2] == 0;
}


inline std::string GetHealthTagFromColor(uint32_t color) {
    if (color == 0x600000 || color == 0) return "Critical";
    if (color == 0xC00000 || color == 0xC03030) return "Low";
    if (color == 0xC0C000) return "Medium";
    if (color == 0x60C060) return "High";
    if (color == 0x00C000) return "Full";
    // --- NEW TAG ADDED ---
    if (color == 0xC0C0C0) return "Obstructed";
    return "Full";
}

thread_local static std::vector<FoundHealthBar> tls_results;

// Forward declaration
inline void ValidateHealthBarAtPosition(const WorkerData& data, const uint8_t* row, uint32_t x, uint32_t y);

void HealthBarWorker(WorkerData data) {
    tls_results.clear();

    const __m256i zero = _mm256_setzero_si256();
    const __m256i bgr_mask = _mm256_set1_epi32(0x00FFFFFF);

    // Clamp endY so we always have room for 4 rows below (for exclusion),
    // matching the existing runtime check but hoisted.
    uint32_t startY = data.searchY;
    uint32_t endY = data.searchY + data.searchH;
    if (endY > data.height) {
        endY = data.height;
    }
    if (endY > data.height - 4) {
        if (data.height < 4) {
            endY = startY; // nothing to do
        } else {
            endY = data.height - 4;
        }
    }

    for (uint32_t y = startY; y < endY; ++y) {
        const uint8_t* row = data.bgraData + (y * data.stride);
        uint32_t x = data.searchX;
        const uint32_t endX = data.searchX + data.searchW - 31;

        // SIMD scan for potential left borders (black pixels)
        for (; x + 8 <= endX; x += 8) {
            // Exclusion mask lookup mapped to search-area-local coordinates
            const uint32_t my = y - data.maskOffsetY;
            const uint32_t mxBase = x - data.maskOffsetX;
            if (my < data.maskHeight) {
                // Fast path: if any of the 8 positions are excluded, we still need
                // per-lane checks, so we defer to per-lane mask checks.
            }

            __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row + x * 4));
            chunk = _mm256_and_si256(chunk, bgr_mask);
            __m256i cmp = _mm256_cmpeq_epi32(chunk, zero);
            int mask = _mm256_movemask_ps(_mm256_castsi256_ps(cmp));

            if (mask == 0) continue;

            for (int j = 0; j < 8; ++j) {
                if (mask & (1 << j)) {
                    uint32_t current_x = x + j;

                    // Check exclusion mask per candidate
                    if (my < data.maskHeight) {
                        uint32_t mx = current_x - data.maskOffsetX;
                        if (mx < data.maskWidth &&
                            data.exclusionMask[my * data.maskWidth + mx]) {
                            continue;
                        }
                    }

                    ValidateHealthBarAtPosition(data, row, current_x, y);
                }
            }
        }

        // Scalar scan for remaining positions
        for (; x < endX; ++x) {
            const uint32_t my = y - data.maskOffsetY;
            if (my < data.maskHeight) {
                uint32_t mx = x - data.maskOffsetX;
                if (mx < data.maskWidth &&
                    data.exclusionMask[my * data.maskWidth + mx]) {
                    continue;
                }
            }
            ValidateHealthBarAtPosition(data, row, x, y);
        }
    }

    if (!tls_results.empty()) {
        std::lock_guard<std::mutex> lock(*data.resultsMutex);
        data.globalResults->insert(
            data.globalResults->end(),
            tls_results.begin(),
            tls_results.end()
        );
    }
}
inline void ValidateHealthBarAtPosition(const WorkerData& data, const uint8_t* row, uint32_t x, uint32_t y) {
    // Check if right border (30 pixels away) is black
    uint32_t right_x = x + 30;
    if (right_x >= data.width || !IsBlack(row + right_x * 4)) return;

    // SIMD-accelerated interior validation
    // Load 8 pixels at a time (32 bytes = 8 pixels * 4 bytes)
    uint32_t healthColor = 0;
    bool hasHealthColor = false;

    // Process interior in chunks of 8 pixels
    for (uint32_t ix = x + 1; ix < x + 30; ix += 8) {
        uint32_t chunk_end = std::min(ix + 8, x + 30);
        uint32_t chunk_size = chunk_end - ix;

        // Load chunk
        __m256i chunk;
        if (chunk_size == 8) {
            chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row + ix * 4));
        } else {
            // Handle partial chunk at end
            uint8_t temp[32] = {0};
            memcpy(temp, row + ix * 4, chunk_size * 4);
            chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(temp));
        }

        chunk = _mm256_and_si256(chunk, _mm256_set1_epi32(0x00FFFFFF));

        // Extract colors and validate
        uint32_t colors[8];
        _mm256_storeu_si256(reinterpret_cast<__m256i*>(colors), chunk);

        for (uint32_t k = 0; k < chunk_size; ++k) {
            uint32_t color = colors[k];
            if (color == 0) {
                // Black is allowed
            } else if (IsKnownBarColor(color)) {
                if (!hasHealthColor) {
                    healthColor = color;
                    hasHealthColor = true;
                } else if (color != healthColor) {
                    // Multiple different health colors not allowed
                    return;
                }
            } else {
                // Unknown color
                return;
            }
        }
    }

    // If we didn't see any colored health pixels in the interior, we may have a full-black bar.
    // Accept it as a valid health bar only if EVERY interior pixel is black.
    if (!hasHealthColor) {
        for (uint32_t ix = x + 1; ix < x + 30; ++ix) {
            const uint8_t* pixel = row + ix * 4;
            if (!IsBlack(pixel)) {
                // Mixed or unknown colors: not a pure black bar -> reject
                return;
            }
        }

        // Valid full-black bar: report as "Critical"
        int centerX = static_cast<int>(x + 15);
        int centerY = static_cast<int>(y);
        std::string healthTag = "Critical";

        tls_results.push_back({ centerX, centerY, healthTag });

        // Exclude pixels directly below for next 4 rows within the search-area-local mask.
        for (int dy = 1; dy <= 4; ++dy) {
            int excludeY = y + dy;
            if (excludeY >= static_cast<int>(data.height)) break;

            uint32_t my = static_cast<uint32_t>(excludeY) - data.maskOffsetY;
            if (my >= data.maskHeight) continue;

            for (int ex = static_cast<int>(x); ex <= static_cast<int>(right_x); ++ex) {
                if (ex >= static_cast<int>(data.width)) break;
                uint32_t mx = static_cast<uint32_t>(ex) - data.maskOffsetX;
                if (mx >= data.maskWidth) continue;
                data.exclusionMask[my * data.maskWidth + mx] = 1;
            }
        }

        return;
    }

    // Validate health color distribution: all health colors must be contiguous from left
    int firstHealthIndex = -1;
    bool afterHealth = false;

    for (uint32_t ix = x + 1; ix < x + 30; ++ix) {
        const uint8_t* pixel = row + ix * 4;
        uint32_t color = (static_cast<uint32_t>(pixel[2]) << 16) |
                        (static_cast<uint32_t>(pixel[1]) << 8) |
                        pixel[0];

        if (color == healthColor) {
            if (afterHealth) return; // Gap in health colors
            if (firstHealthIndex == -1) firstHealthIndex = ix - x;
        } else if (firstHealthIndex != -1) {
            afterHealth = true;
            if (!IsBlack(pixel)) return; // Must be black after health colors
        }
    }

    // Valid health bar found
    int centerX = static_cast<int>(x + 15);
    int centerY = static_cast<int>(y);
    std::string healthTag = GetHealthTagFromColor(healthColor);

    tls_results.push_back({ centerX, centerY, healthTag });

    // Exclude pixels directly below for next 4 rows within the search-area-local mask.
    for (int dy = 1; dy <= 4; ++dy) {
        int excludeY = y + dy;
        if (excludeY >= static_cast<int>(data.height)) break;

        uint32_t my = static_cast<uint32_t>(excludeY) - data.maskOffsetY;
        if (my >= data.maskHeight) continue;

        for (int ex = static_cast<int>(x); ex <= static_cast<int>(right_x); ++ex) {
            if (ex >= static_cast<int>(data.width)) break;
            uint32_t mx = static_cast<uint32_t>(ex) - data.maskOffsetX;
            if (mx >= data.maskWidth) continue;
            data.exclusionMask[my * data.maskWidth + mx] = 1;
        }
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

    // Exclusion mask restricted to search area for better cache locality.
    const uint32_t maskWidth = w;
    const uint32_t maskHeight = h;
    std::vector<uint8_t> exclusionMask(maskWidth * maskHeight, 0);

    // Thread count heuristic:
    // - Base on hardware concurrency.
    // - Ensure a minimum number of rows per thread to avoid oversubscription.
    unsigned numThreads = std::thread::hardware_concurrency();
    if (numThreads == 0) numThreads = 4;

    constexpr uint32_t MIN_ROWS_PER_THREAD = 32;
    unsigned maxByHeight = (h / MIN_ROWS_PER_THREAD) ? (h / MIN_ROWS_PER_THREAD) : 1;
    if (numThreads > maxByHeight) numThreads = maxByHeight;
    if (numThreads == 0) numThreads = 1;

    std::vector<std::thread> threads;
    threads.reserve(numThreads);

    for (unsigned i = 0; i < numThreads; ++i) {
        uint32_t startRow = y + (i * h) / numThreads;
        uint32_t endRow = y + ((i + 1) * h) / numThreads;
        if (endRow <= startRow) continue;

        uint32_t chunkHeight = endRow - startRow;
        if (chunkHeight < 4) continue; // bar is 4px high; keep this guard

        WorkerData wd{
            bgraData,
            width,
            height,
            stride,
            x,
            startRow,
            w,
            chunkHeight,
            maskWidth,
            maskHeight,
            x, // maskOffsetX
            y, // maskOffsetY
            &globalResults,
            &globalResultsMutex,
            exclusionMask.data()
        };

        threads.emplace_back(HealthBarWorker, wd);
    }

    if (threads.empty()) {
        // Fallback to single-threaded if splitting produced no valid chunks.
        WorkerData wd{
            bgraData,
            width,
            height,
            stride,
            x,
            y,
            w,
            h,
            maskWidth,
            maskHeight,
            x, // maskOffsetX
            y, // maskOffsetY
            &globalResults,
            &globalResultsMutex,
            exclusionMask.data()
        };
        HealthBarWorker(wd);
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