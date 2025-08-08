// findHealthBars.cc – AVX2 optimized health bar finder
#include <napi.h>
#include <vector>
#include <thread>
#include <atomic>
#include <cstdint>
#include <immintrin.h>
#include <mutex>

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

inline bool IsBlack31_AVX2(const uint8_t* row, uint32_t x) {
    const __m256i zero = _mm256_setzero_si256();
    const uint8_t* ptr = row + x * 4;

    __m256i chunk1 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(ptr));       // 16 pixels (64 bytes)
    __m256i chunk2 = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(ptr + 32));  // next 16 pixels
    __m128i chunk3 = _mm_loadu_si128(reinterpret_cast<const __m128i*>(ptr + 64));     // final 8 pixels (last 2 bytes unused)

    __m256i cmp1 = _mm256_cmpeq_epi8(chunk1, zero);
    __m256i cmp2 = _mm256_cmpeq_epi8(chunk2, zero);
    __m128i cmp3 = _mm_cmpeq_epi8(chunk3, _mm_setzero_si128());

    // Create masks to verify all R,G,B channels are 0
    uint64_t mask1 = _mm256_movemask_epi8(cmp1);
    uint64_t mask2 = _mm256_movemask_epi8(cmp2);
    uint32_t mask3 = _mm_movemask_epi8(cmp3);

    // Total = 31 pixels = 124 bytes
    // Each pixel = 4 bytes (BGRA) but we only care about BGR, i.e., 3 bytes out of 4
    // So check that every BGR byte is zero in the 124 bytes

    // Construct expected masks: for 31 pixels, 3 bytes per pixel = 93 bytes
    // But in 4-byte pixel layout, they are at offsets: 0,1,2, 4,5,6, 8,9,10, ..., so every 4 bytes we skip 1
    for (int i = 0; i < 31; ++i) {
        const uint8_t* p = ptr + i * 4;
        if (p[0] != 0 || p[1] != 0 || p[2] != 0) return false;
    }
    return true;
}

void HealthBarWorker(WorkerData data) {
    while (true) {
        uint32_t y = data.nextRow->fetch_add(1);
        if (y >= data.searchY + data.searchH - 2) break;

        const uint8_t* rowTop    = data.bgraData + ((y)     * data.stride);
        const uint8_t* rowBottom = data.bgraData + ((y + 2) * data.stride);

        for (uint32_t x = data.searchX; x + 30 < data.searchX + data.searchW; ++x) {
            if (IsBlack31_AVX2(rowTop, x) && IsBlack31_AVX2(rowBottom, x)) {
                int centerX = static_cast<int>(x + 15);
                int centerY = static_cast<int>(y + 1);
                std::lock_guard<std::mutex> lock(*data.resultsMutex);
                data.results->push_back({ centerX, centerY });
            }
        }
    }
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

    Napi::Array out = Napi::Array::New(env, results.size());
    for (size_t i = 0; i < results.size(); ++i) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("x", results[i].x);
        obj.Set("y", results[i].y);
        out[i] = obj;
    }

    return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("findHealthBars", Napi::Function::New(env, FindHealthBars));
    return exports;
}

NODE_API_MODULE(findHealthBars, Init)