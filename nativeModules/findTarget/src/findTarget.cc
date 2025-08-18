// findTarget.cc – Repurposed to find a single, potentially obstructed target mark.
#include <napi.h>
#include <vector>
#include <thread>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <algorithm>
#include <cmath>
#include <queue>
#include <immintrin.h>

const uint32_t TARGET_BORDER_COLOR = 0xFF0000;
// Minimum number of pixels a cluster must have to be considered part of the border
const size_t MIN_CLUSTER_SIZE = 5;

struct Point {
    uint32_t x, y;
};

struct WorkerData {
    const uint8_t* bgraData;
    uint32_t width, height, stride;
    uint32_t searchX, searchY, searchW, searchH;
    std::atomic<uint32_t>* nextRow;
    std::vector<Point>* results;
    std::mutex* resultsMutex;
};

void TargetWorker(WorkerData data) {
    const uint32_t rowChunkSize = 32; // Larger chunks can be better for simple tasks
    const __m256i bgr_mask = _mm256_set1_epi32(0x00FFFFFF);
    const __m256i target_color_v = _mm256_set1_epi32(TARGET_BORDER_COLOR);

    std::vector<Point> local_results;

    while (true) {
        uint32_t startY = data.nextRow->fetch_add(rowChunkSize);
        if (startY >= data.searchY + data.searchH) break;

        uint32_t endY = std::min(startY + rowChunkSize, data.searchY + data.searchH);

        for (uint32_t y = startY; y < endY; ++y) {
            const uint8_t* row = data.bgraData + (y * data.stride);
            const uint32_t endX = data.searchX + data.searchW;

            for (uint32_t x = data.searchX; x + 8 <= endX; x += 8) {
                __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row + x * 4));
                chunk = _mm256_and_si256(chunk, bgr_mask); // Ignore alpha channel

                __m256i cmp = _mm256_cmpeq_epi32(chunk, target_color_v);
                int mask = _mm256_movemask_ps(_mm256_castsi256_ps(cmp));

                if (mask != 0) {
                    for (int j = 0; j < 8; ++j) {
                        if (mask & (1 << j)) {
                            local_results.push_back({x + j, y});
                        }
                    }
                }
            }
            // Handle remaining pixels that don't fit in an 8-pixel chunk
            for (uint32_t x = (data.searchX + data.searchW) & ~7; x < endX; ++x) {
                 const uint8_t* p = row + x * 4;
                 uint32_t pixelColor = (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[1]) << 8) | p[0];
                 if (pixelColor == TARGET_BORDER_COLOR) {
                     local_results.push_back({x, y});
                 }
            }
        }
    }

    if (!local_results.empty()) {
        std::lock_guard<std::mutex> lock(*data.resultsMutex);
        data.results->insert(data.results->end(), local_results.begin(), local_results.end());
    }
}


Napi::Value FindTarget(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected (Buffer, Object searchArea)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    const uint8_t* bufferData = buffer.Data();
    size_t bufferLength = buffer.Length();

    if (bufferLength < 8) return env.Null();
    uint32_t width  = *reinterpret_cast<const uint32_t*>(bufferData);
    uint32_t height = *reinterpret_cast<const uint32_t*>(bufferData + 4);
    const uint8_t* bgraData = bufferData + 8;
    uint32_t stride = width * 4;
    if (bufferLength - 8 < width * height * 4) return env.Null();

    Napi::Object area = info[1].As<Napi::Object>();
    uint32_t searchX = area.Get("x").As<Napi::Number>().Uint32Value();
    uint32_t searchY = area.Get("y").As<Napi::Number>().Uint32Value();
    uint32_t searchW = area.Get("width").As<Napi::Number>().Uint32Value();
    uint32_t searchH = area.Get("height").As<Napi::Number>().Uint32Value();

    // === STAGE 1: GATHER PIXELS ===
    std::vector<Point> candidatePoints;
    std::mutex resultsMutex;
    std::atomic<uint32_t> nextRow(searchY);

    unsigned numThreads = std::thread::hardware_concurrency();
    if (!numThreads) numThreads = 4;

    std::vector<std::thread> threads;
    for (unsigned i = 0; i < numThreads; ++i) {
        threads.emplace_back(TargetWorker, WorkerData{
            bgraData, width, height, stride,
            searchX, searchY, searchW, searchH,
            &nextRow, &candidatePoints, &resultsMutex
        });
    }
    for (auto& t : threads) t.join();

    if (candidatePoints.empty()) {
        return env.Null();
    }

    // === STAGE 2: CLUSTER & INFER BOUNDING BOX ===
    std::vector<std::vector<Point>> clusters;
    std::vector<bool> visited(width * height, false);

    for (const auto& start_point : candidatePoints) {
        uint32_t start_idx = start_point.y * width + start_point.x;
        if (visited[start_idx]) continue;

        std::vector<Point> current_cluster;
        std::queue<Point> q;

        q.push(start_point);
        visited[start_idx] = true;

        while (!q.empty()) {
            Point p = q.front();
            q.pop();
            current_cluster.push_back(p);

            // Check 8 neighbors (Moore neighborhood)
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    if (dx == 0 && dy == 0) continue;
                    uint32_t nx = p.x + dx;
                    uint32_t ny = p.y + dy;

                    if (nx >= searchX && nx < searchX + searchW && ny >= searchY && ny < searchY + searchH) {
                        uint32_t neighbor_idx = ny * width + nx;
                        if (!visited[neighbor_idx]) {
                           const uint8_t* np = bgraData + ny * stride + nx * 4;
                           uint32_t neighborColor = (static_cast<uint32_t>(np[2]) << 16) | (static_cast<uint32_t>(np[1]) << 8) | np[0];
                           if (neighborColor == TARGET_BORDER_COLOR) {
                               visited[neighbor_idx] = true;
                               q.push({nx, ny});
                           }
                        }
                    }
                }
            }
        }
        if (current_cluster.size() >= MIN_CLUSTER_SIZE) {
            clusters.push_back(current_cluster);
        }
    }

    if (clusters.empty()) {
        return env.Null();
    }

    // === Combine all valid clusters into a single bounding box ===
    uint32_t minX = width, minY = height, maxX = 0, maxY = 0;

    for (const auto& cluster : clusters) {
        for (const auto& p : cluster) {
            minX = std::min(minX, p.x);
            minY = std::min(minY, p.y);
            maxX = std::max(maxX, p.x);
            maxY = std::max(maxY, p.y);
        }
    }

    // Add the 3px border thickness to the max coordinates to get the full creature rect
    // The border is outside the creature, so the creature rect is inside minX+3, minY+3
    uint32_t creatureX = minX + 3;
    uint32_t creatureY = minY + 3;
    uint32_t creatureW = (maxX - 3) - creatureX + 1;
    uint32_t creatureH = (maxY - 3) - creatureY + 1;

    Napi::Object result = Napi::Object::New(env);
    result.Set("x", creatureX);
    result.Set("y", creatureY);
    result.Set("width", creatureW);
    result.Set("height", creatureH);

    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("findTarget", Napi::Function::New(env, FindTarget));
    return exports;
}

NODE_API_MODULE(findTarget, Init)