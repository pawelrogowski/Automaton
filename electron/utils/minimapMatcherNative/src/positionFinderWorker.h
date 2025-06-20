
#ifndef POSITION_FINDER_WORKER_H
#define POSITION_FINDER_WORKER_H

#include <napi.h>
#include <chrono>
#include "minimapMatcher.h"

// --- Native Data Structures for results ---
struct NativePosition {
    bool found = false;
    int x = 0;
    int y = 0;
    int z = 0;
    int mapViewX = 0;
    int mapViewY = 0;
};

// --- The Asynchronous Worker Declaration ---
class PositionFinderWorker : public Napi::AsyncWorker {
public:
    PositionFinderWorker(
        Napi::Env env,
        MinimapMatcher* matcher,
        const std::vector<uint8_t>& unpackedMinimap,
        int minimapWidth,
        int minimapHeight,
        int targetZ
    );

    ~PositionFinderWorker();

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& e) override;
    Napi::Promise GetPromise();
    void Cancel();

private:
    MinimapMatcher* matcherInstance; // Now we have the full type info

    // Input Data
    std::vector<uint8_t> unpackedMinimap;
    int minimapWidth;
    int minimapHeight;
    int targetZ;

    // Cancellation Flag
    std::atomic<bool> wasCancelled{false};

    // Result Data
    NativePosition resultPosition;
    std::string searchMethod;
    double durationMs;

    Napi::Promise::Deferred deferred;
};

#endif // POSITION_FINDER_WORKER_H