#ifndef PATHFINDER_H
#define PATHFINDER_H

#include <napi.h>
#include <string>
#include <vector>
#include <atomic>
#include <unordered_map>
#include <functional> // For std::hash

// Data Structures - Kept from original
struct Node {
    int x, y;
    int g, h;
    const Node* parent;
    int z;

    int f() const { return g + h; }
    // This operator is correct. It ensures uniqueness is based on position only.
    bool operator==(const Node& other) const { return x == other.x && y == other.y; }
};

// This hash function is correct. It corresponds to the operator==.
struct NodeHash {
    std::size_t operator()(const Node& node) const {
        return std::hash<int>()(node.x) ^ (std::hash<int>()(node.y) << 1);
    }
};

struct MapData {
    int z;
    int minX, minY, width, height;
    std::vector<uint8_t> grid;
};

class Pathfinder : public Napi::ObjectWrap<Pathfinder> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    Pathfinder(const Napi::CallbackInfo& info);

private:
    static Napi::FunctionReference constructor;

    Napi::Value LoadMapData(const Napi::CallbackInfo& info);
    Napi::Value FindPathSync(const Napi::CallbackInfo& info);
    Napi::Value IsLoadedGetter(const Napi::CallbackInfo& info);

    std::unordered_map<int, MapData> allMapData;
    std::atomic<bool> isLoaded{false};
};

#endif // PATHFINDER_H