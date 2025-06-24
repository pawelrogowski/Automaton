#ifndef PATHFINDER_H
#define PATHFINDER_H

#include <napi.h>
#include <string>
#include <vector>
#include <map>
#include <atomic>

// Forward declaration
class AStarWorker;

// A struct to hold all the data for a single map floor
struct MapData {
    int z;
    int minX;
    int minY;
    int width;
    int height;
    std::vector<uint8_t> grid; // 1-bit packed walkability grid
};

class Pathfinder : public Napi::ObjectWrap<Pathfinder> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    Pathfinder(const Napi::CallbackInfo& info);
    ~Pathfinder();

    // Public members for worker access
    std::map<int, MapData> allMapData; // Maps z-level to its data
    AStarWorker* activeWorker = nullptr;
    std::atomic<bool> isLoaded{false};

private:
    // Methods exposed to JavaScript
    Napi::Value LoadMapData(const Napi::CallbackInfo& info);
    Napi::Value FindPath(const Napi::CallbackInfo& info);
    Napi::Value CancelSearch(const Napi::CallbackInfo& info);

    // Accessor for isLoaded
    Napi::Value IsLoadedGetter(const Napi::CallbackInfo& info);

    static Napi::FunctionReference constructor;
};

#endif // PATHFINDER_H