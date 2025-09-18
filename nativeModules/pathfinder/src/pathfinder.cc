// /home/feiron/Dokumenty/Automaton/nativeModules/pathfinder/src/pathfinder.cc
// --- Contains all consolidated features and fixes ---
// --- FINAL CORRECTED axis-preference tie-breaking penalty ---

#include "pathfinder.h"
#include "aStar.h"
#include <napi.h>
#include <iostream>
#include <fstream>
#include <unordered_set>
#include <unordered_map>
#include <algorithm>
#include <queue>
#include <vector>
#include <cmath>
#include <chrono>
#include <string>
#include <functional>
#include <climits>
#include <cstdlib>
#include <ctime>

struct SpecialArea {
    int x, y, z;
    int width, height;
    int avoidance;
};

namespace AStar {
    static constexpr int BASE_MOVE_COST = 10;
    static constexpr int DIAGONAL_MOVE_COST = 30;
    static const int INF_COST = 0x3f3f3f3f;
    static constexpr int CREATURE_BLOCK_COST = 1000000;

    bool isWalkable(int x, int y, const MapData& mapData) {
        if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) return false;
        int linearIndex = y * mapData.width + x;
        int byteIndex = linearIndex / 8;
        int bitIndex = linearIndex % 8;
        if (byteIndex < 0 || byteIndex >= (int)mapData.grid.size()) return false;
        return (mapData.grid[byteIndex] & (1 << bitIndex)) != 0;
    }

    inline bool inBounds(int x, int y, const MapData& mapData) {
        return x >= 0 && x < mapData.width && y >= 0 && y < mapData.height;
    }

    inline int manhattanHeuristic(int x1, int y1, int x2, int y2, int D = BASE_MOVE_COST) {
        int dx = std::abs(x1 - x2);
        int dy = std::abs(y1 - y2);
        return D * (dx + dy);
    }

    struct ScratchBuffers {
        std::vector<int> gScore;
        std::vector<int> parent;
        std::vector<int> mark;
        std::vector<int> closedMark;
        int visitToken = 1;
    };

    static thread_local ScratchBuffers sb;

    static inline void ensureBuffersSize(int required) {
        if ((int)sb.gScore.size() < required) {
            sb.gScore.assign(required, INF_COST);
            sb.parent.assign(required, -1);
            sb.mark.assign(required, 0);
            sb.closedMark.assign(required, 0);
            sb.visitToken = 1;
        }
    }

    static inline void nextVisitToken() {
        sb.visitToken++;
        if (sb.visitToken == 0 || sb.visitToken == INT_MAX) {
            std::fill(sb.mark.begin(), sb.mark.end(), 0);
            std::fill(sb.closedMark.begin(), sb.closedMark.end(), 0);
            sb.visitToken = 1;
        }
    }

    template <typename FindGoalFunc>
    std::vector<Node> findPathGeneric(const Node& start, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled, FindGoalFunc isGoal) {
        std::vector<Node> path;
        int W = mapData.width;
        int H = mapData.height;
        if (W <= 0 || H <= 0) return path;

        int mapSize = W * H;
        ensureBuffersSize(mapSize);
        nextVisitToken();
        int visit = sb.visitToken;
        auto indexOf = [&](int x, int y) { return y * W + x; };

        std::unordered_set<int> creatureIndices;
        for (const auto& creature : creaturePositions) {
            if (creature.z == start.z) {
                int creatureX = creature.x - mapData.minX;
                int creatureY = creature.y - mapData.minY;
                if (inBounds(creatureX, creatureY, mapData)) {
                    creatureIndices.insert(indexOf(creatureX, creatureY));
                }
            }
        }

        using PQItem = std::tuple<int, int, int>; // f, generation, idx
        std::priority_queue<PQItem, std::vector<PQItem>, std::greater<PQItem>> open;

        int startIdx = indexOf(start.x, start.y);
        int h0 = isGoal.heuristic(start.x, start.y);

        sb.gScore[startIdx] = 0;
        sb.parent[startIdx] = -1;
        sb.mark[startIdx] = visit;
        open.emplace(h0, 0, startIdx); // f, generation, idx

        int generation = 0;

        while (!open.empty()) {
            if (++generation % 1000 == 0) onCancelled();
            auto [f, gen, idx] = open.top();
            open.pop();

            int g = sb.gScore[idx];
            if (sb.closedMark[idx] == visit) continue;

            if (isGoal(idx)) {
                int cur = idx;
                while (cur != -1) {
                    path.emplace_back(Node{cur % W, cur / W, 0, 0, nullptr, start.z});
                    cur = sb.parent[cur];
                }
                std::reverse(path.begin(), path.end());
                return path;
            }

            sb.closedMark[idx] = visit;
            int cx = idx % W;
            int cy = idx / W;

            auto processNeighbor = [&](int nx, int ny, bool isDiagonal) {
                if (!inBounds(nx, ny, mapData)) return;

                int nIdx = indexOf(nx, ny);
                if (sb.closedMark[nIdx] == visit) return;

                int tileAvoidance = (nIdx >= 0 && nIdx < (int)cost_grid.size()) ? cost_grid[nIdx] : 0;
                bool isWalkableByMap = isWalkable(nx, ny, mapData);

                if (tileAvoidance == 255 || (!isWalkableByMap && (tileAvoidance > 0 || !isGoal(nIdx)))) {
                    return;
                }

                bool isCreatureTile = (!isGoal(nIdx)) ? creatureIndices.count(nIdx) > 0 : false;
                int baseMoveCost = isDiagonal ? DIAGONAL_MOVE_COST : BASE_MOVE_COST;
                int addedCost = (tileAvoidance > 0) ? tileAvoidance : 0;
                int creatureCost = isCreatureTile ? CREATURE_BLOCK_COST : 0;
                int tentativeG = g + baseMoveCost + addedCost + creatureCost;

                if (!(sb.mark[nIdx] == visit) || tentativeG < sb.gScore[nIdx]) {
                    sb.gScore[nIdx] = tentativeG;
                    sb.parent[nIdx] = idx;
                    sb.mark[nIdx] = visit;
                    int h = isGoal.heuristic(nx, ny);
                    open.emplace(tentativeG + h, generation + 1, nIdx);
                }
            };

            int dx_to_goal = isGoal.end_x - cx;
            int dy_to_goal = isGoal.end_y - cy;

            int dx_abs = std::abs(dx_to_goal);
            int dy_abs = std::abs(dy_to_goal);

            int dir_x = (dx_to_goal > 0) ? 1 : -1;
            int dir_y = (dy_to_goal > 0) ? 1 : -1;

            std::vector<std::pair<int, int>> neighbors;
            if (dx_abs > dy_abs) {
                neighbors.push_back({cx + dir_x, cy});
                neighbors.push_back({cx, cy + dir_y});
                neighbors.push_back({cx, cy - dir_y});
                neighbors.push_back({cx - dir_x, cy});
            } else if (dy_abs > dx_abs) {
                neighbors.push_back({cx, cy + dir_y});
                neighbors.push_back({cx + dir_x, cy});
                neighbors.push_back({cx - dir_x, cy});
                neighbors.push_back({cx, cy - dir_y});
            } else {
                 if (generation % 2 == 0) {
                    neighbors.push_back({cx + dir_x, cy});
                    neighbors.push_back({cx, cy + dir_y});
                    neighbors.push_back({cx - dir_x, cy});
                    neighbors.push_back({cx, cy - dir_y});
                } else {
                    neighbors.push_back({cx, cy + dir_y});
                    neighbors.push_back({cx + dir_x, cy});
                    neighbors.push_back({cx, cy - dir_y});
                    neighbors.push_back({cx - dir_x, cy});
                }
            }

            for(const auto& p : neighbors) {
                processNeighbor(p.first, p.second, false);
            }

            // Diagonals last
            processNeighbor(cx + 1, cy + 1, true);
            processNeighbor(cx - 1, cy - 1, true);
            processNeighbor(cx + 1, cy - 1, true);
            processNeighbor(cx - 1, cy + 1, true);
        }
        return path;
    }

    std::vector<Node> findPathWithCosts(const Node& start, const Node& end, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        int W = mapData.width;
        auto indexOf = [&](int x, int y) { return y * W + x; };
        int endIdx = indexOf(end.x, end.y);

        struct Goal {
            int end_idx;
            int end_x, end_y;
            bool operator()(int idx) const { return idx == end_idx; }
            int heuristic(int x, int y) const { return manhattanHeuristic(x, y, end_x, end_y); }
        };

        return findPathGeneric(start, mapData, cost_grid, creaturePositions, onCancelled, Goal{endIdx, end.x, end.y});
    }

    std::vector<Node> findPathToAny(const Node& start, const std::unordered_set<int>& endIndices, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        int W = mapData.width;
        int heuristicEndX = 0, heuristicEndY = 0;
        if (!endIndices.empty()) {
            int firstGoalIdx = *endIndices.begin();
            heuristicEndX = firstGoalIdx % W;
            heuristicEndY = firstGoalIdx / W;
        }

        struct Goal {
            const std::unordered_set<int>& ends;
            int end_x, end_y;
            int h_x, h_y;
            bool operator()(int idx) const { return ends.count(idx); }
            int heuristic(int x, int y) const { return manhattanHeuristic(x, y, h_x, h_y); }
        };

        return findPathGeneric(start, mapData, cost_grid, creaturePositions, onCancelled, Goal{endIndices, heuristicEndX, heuristicEndY, heuristicEndX, heuristicEndY});
    }

    // --- CRASH FIX HERE ---
    // These functions now correctly assume they receive LOCAL coordinates
    // and pass them directly to the main finder, preventing a double conversion.
    int getPathLength(const Node& start, const Node& end, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        auto path = findPathWithCosts(start, end, mapData, cost_grid, creaturePositions, onCancelled);
        return path.empty() ? -1 : path.size() - 1;
    }

    bool isReachable(const Node& start, const Node& end, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        return !findPathWithCosts(start, end, mapData, cost_grid, creaturePositions, onCancelled).empty();
    }
} // namespace AStar

Napi::FunctionReference Pathfinder::constructor;

Napi::Object Pathfinder::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Pathfinder", {
        InstanceMethod("loadMapData", &Pathfinder::LoadMapData),
        InstanceMethod("findPathSync", &Pathfinder::FindPathSync),
        InstanceMethod("updateSpecialAreas", &Pathfinder::UpdateSpecialAreas),
        InstanceMethod("findPathToGoal", &Pathfinder::FindPathToGoal),
        InstanceMethod("isReachable", &Pathfinder::IsReachable),
        InstanceMethod("getPathLength", &Pathfinder::GetPathLength),
        InstanceMethod("getReachableTiles", &Pathfinder::GetReachableTiles),
        InstanceAccessor("isLoaded", &Pathfinder::IsLoadedGetter, nullptr),
    });
    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();
    exports.Set("Pathfinder", func);
    return exports;
}

Pathfinder::Pathfinder(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Pathfinder>(info) {}

Napi::Value Pathfinder::IsLoadedGetter(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), this->isLoaded.load());
}

int Pathfinder::_getPathLengthInternal(Napi::Env env, const Node& start, const Node& end, const std::vector<Node>& creaturePositions) {
    auto it_map = this->allMapData.find(start.z);
    if (it_map == this->allMapData.end()) {
        return -1;
    }
    const MapData& mapData = it_map->second;

    Node localStart = {start.x - mapData.minX, start.y - mapData.minY, 0, 0, nullptr, start.z};
    Node localEnd = {end.x - mapData.minX, end.y - mapData.minY, 0, 0, nullptr, end.z};

    if (!AStar::inBounds(localStart.x, localStart.y, mapData) || !AStar::inBounds(localEnd.x, localEnd.y, mapData)) {
        return -1;
    }

    auto it_cache = this->cost_grid_cache.find(start.z);
    const std::vector<int>& cost_grid = (it_cache != this->cost_grid_cache.end()) ? it_cache->second : std::vector<int>();

    return AStar::getPathLength(localStart, localEnd, mapData, cost_grid, creaturePositions, [](){});
}

Napi::Value Pathfinder::GetReachableTiles(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsObject() || !info[1].IsArray() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected start node, creature positions array, and max distance").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object startObj = info[0].As<Napi::Object>();
    Node start = {
        startObj.Get("x").As<Napi::Number>().Int32Value(),
        startObj.Get("y").As<Napi::Number>().Int32Value(),
        0, 0, nullptr,
        startObj.Get("z").As<Napi::Number>().Int32Value()
    };

    Napi::Array creaturePositionsArray = info[1].As<Napi::Array>();
    std::vector<Node> creaturePositions;
    for (uint32_t i = 0; i < creaturePositionsArray.Length(); ++i) {
        Napi::Object creatureObj = creaturePositionsArray.Get(i).As<Napi::Object>();
        creaturePositions.push_back({
            creatureObj.Get("x").As<Napi::Number>().Int32Value(),
            creatureObj.Get("y").As<Napi::Number>().Int32Value(),
            0, 0, nullptr,
            creatureObj.Get("z").As<Napi::Number>().Int32Value()
        });
    }

    int maxDistance = info[2].As<Napi::Number>().Int32Value();

    auto it_map = this->allMapData.find(start.z);
    if (it_map == this->allMapData.end()) {
        return Napi::Object::New(env);
    }
    const MapData& mapData = it_map->second;
    auto it_cache = this->cost_grid_cache.find(start.z);
    const std::vector<int>& cost_grid = (it_cache != this->cost_grid_cache.end()) ? it_cache->second : std::vector<int>();

    Node localStart = {start.x - mapData.minX, start.y - mapData.minY, 0, 0, nullptr, start.z};
    if (!AStar::inBounds(localStart.x, localStart.y, mapData)) {
        return Napi::Object::New(env);
    }

    std::unordered_set<int> allCreatureIndices;
    for (const auto& creature : creaturePositions) {
        if (creature.z == start.z) {
            int creatureX = creature.x - mapData.minX;
            int creatureY = creature.y - mapData.minY;
            if (AStar::inBounds(creatureX, creatureY, mapData)) {
                allCreatureIndices.insert(creatureY * mapData.width + creatureX);
            }
        }
    }

    Napi::Object reachableTiles = Napi::Object::New(env);
    std::queue<std::pair<int, int>> q;
    std::unordered_map<int, int> distance;

    int startIdx = localStart.y * mapData.width + localStart.x;
    q.push({startIdx, 0});
    distance[startIdx] = 0;

    const int dx[] = {0, 0, 1, -1, 1, 1, -1, -1};
    const int dy[] = {1, -1, 0, 0, 1, -1, 1, -1};

    while (!q.empty()) {
        auto curr = q.front();
        q.pop();
        int currIdx = curr.first;
        int currDist = curr.second;

        if (currDist >= maxDistance) continue;

        int cx = currIdx % mapData.width;
        int cy = currIdx / mapData.width;

        for (int i = 0; i < 8; ++i) {
            int nx = cx + dx[i];
            int ny = cy + dy[i];

            if (!AStar::inBounds(nx, ny, mapData)) continue;

            int nextIdx = ny * mapData.width + nx;
            if (distance.count(nextIdx)) continue;

            bool isCreatureTile = allCreatureIndices.count(nextIdx) > 0;

            if (!AStar::isWalkable(nx, ny, mapData) || isCreatureTile) {
                 if (isCreatureTile) {
                    // If the tile is a creature, it's "reachable" in the sense that we can target it.
                    // But we can't path *through* it. So we record its distance and stop exploring from it.
                    int globalX = nx + mapData.minX;
                    int globalY = ny + mapData.minY;
                    std::string key = std::to_string(globalX) + "," + std::to_string(globalY) + "," + std::to_string(start.z);
                    reachableTiles.Set(key, Napi::Number::New(env, currDist + 1));
                 }
                continue;
            }
            
            int tileAvoidance = (nextIdx >= 0 && nextIdx < (int)cost_grid.size()) ? cost_grid[nextIdx] : 0;
            if (tileAvoidance == 255) continue;

            distance[nextIdx] = currDist + 1;
            q.push({nextIdx, currDist + 1});

            int globalX = nx + mapData.minX;
            int globalY = ny + mapData.minY;
            std::string key = std::to_string(globalX) + "," + std::to_string(globalY) + "," + std::to_string(start.z);
            reachableTiles.Set(key, Napi::Number::New(env, currDist + 1));
        }
    }

    return reachableTiles;
}


Napi::Value Pathfinder::GetPathLength(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsObject() || !info[1].IsObject() || !info[2].IsArray()) {
        Napi::TypeError::New(env, "Expected start node, end node, and creature positions array").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object startObj = info[0].As<Napi::Object>();
    Node start = {startObj.Get("x").As<Napi::Number>().Int32Value(), startObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, startObj.Get("z").As<Napi::Number>().Int32Value()};

    Napi::Object endObj = info[1].As<Napi::Object>();
    Node end = {endObj.Get("x").As<Napi::Number>().Int32Value(), endObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, endObj.Get("z").As<Napi::Number>().Int32Value()};

    Napi::Array creaturePositionsArray = info[2].As<Napi::Array>();
    std::vector<Node> creaturePositions;
    for (uint32_t i = 0; i < creaturePositionsArray.Length(); ++i) {
        Napi::Object creatureObj = creaturePositionsArray.Get(i).As<Napi::Object>();
        creaturePositions.push_back({
            creatureObj.Get("x").As<Napi::Number>().Int32Value(),
            creatureObj.Get("y").As<Napi::Number>().Int32Value(),
            0, 0, nullptr,
            creatureObj.Get("z").As<Napi::Number>().Int32Value()
        });
    }

    int length = _getPathLengthInternal(env, start, end, creaturePositions);
    return Napi::Number::New(env, length);
}

bool Pathfinder::_isReachableInternal(Napi::Env env, const Node& start, const Node& end, const std::vector<Node>& creaturePositions) {
    auto it_map = this->allMapData.find(start.z);
    if (it_map == this->allMapData.end()) {
        return false;
    }
    const MapData& mapData = it_map->second;
    Node localStart = {start.x - mapData.minX, start.y - mapData.minY, 0, 0, nullptr, start.z};
    Node localEnd = {end.x - mapData.minX, end.y - mapData.minY, 0, 0, nullptr, end.z};
    if (!AStar::inBounds(localStart.x, localStart.y, mapData) || !AStar::inBounds(localEnd.x, localEnd.y, mapData)) {
        return false;
    }
    auto it_cache = this->cost_grid_cache.find(start.z);
    const std::vector<int>& cost_grid = (it_cache != this->cost_grid_cache.end()) ? it_cache->second : std::vector<int>();
    return AStar::isReachable(localStart, localEnd, mapData, cost_grid, creaturePositions, [](){});
}
Napi::Value Pathfinder::IsReachable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsObject() || !info[1].IsObject() || !info[2].IsArray()) {
        Napi::TypeError::New(env, "Expected start node, end node, and creature positions array").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object startObj = info[0].As<Napi::Object>();
    Node start = {startObj.Get("x").As<Napi::Number>().Int32Value(), startObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, startObj.Get("z").As<Napi::Number>().Int32Value()};
    Napi::Object endObj = info[1].As<Napi::Object>();
    Node end = {endObj.Get("x").As<Napi::Number>().Int32Value(), endObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, endObj.Get("z").As<Napi::Number>().Int32Value()};
    Napi::Array creaturePositionsArray = info[2].As<Napi::Array>();
    std::vector<Node> creaturePositions;
    for (uint32_t i = 0; i < creaturePositionsArray.Length(); ++i) {
        Napi::Object creatureObj = creaturePositionsArray.Get(i).As<Napi::Object>();
        creaturePositions.push_back({
            creatureObj.Get("x").As<Napi::Number>().Int32Value(),
            creatureObj.Get("y").As<Napi::Number>().Int32Value(),
            0, 0, nullptr,
            creatureObj.Get("z").As<Napi::Number>().Int32Value()
        });
    }
    bool result = _isReachableInternal(env, start, end, creaturePositions);
    return Napi::Boolean::New(env, result);
}
Napi::Value Pathfinder::LoadMapData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected an object mapping Z-levels to map data").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object mapDataObj = info[0].As<Napi::Object>();
    Napi::Array zLevels = mapDataObj.GetPropertyNames();
    this->allMapData.clear();
    for (uint32_t i = 0; i < zLevels.Length(); ++i) {
        Napi::Value zKey = zLevels.Get(i);
        int z = std::stoi(zKey.As<Napi::String>().Utf8Value());
        Napi::Object dataForZ = mapDataObj.Get(zKey).As<Napi::Object>();
        Napi::Buffer<uint8_t> gridBuffer = dataForZ.Get("grid").As<Napi::Buffer<uint8_t>>();
        MapData map;
        map.z = z;
        map.minX = dataForZ.Get("minX").As<Napi::Number>().Int32Value();
        map.minY = dataForZ.Get("minY").As<Napi::Number>().Int32Value();
        map.width = dataForZ.Get("width").As<Napi::Number>().Int32Value();
        map.height = dataForZ.Get("height").As<Napi::Number>().Int32Value();
        size_t expectedBytes = ((size_t)map.width * (size_t)map.height + 7) / 8;
        if (gridBuffer.Length() < expectedBytes) {
            Napi::TypeError::New(env, "Grid buffer shorter than expected for provided width/height").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        map.grid.assign(gridBuffer.Data(), gridBuffer.Data() + gridBuffer.Length());
        this->allMapData[z] = std::move(map);
    }
    this->isLoaded = true;
    return env.Undefined();
}
Napi::Value Pathfinder::UpdateSpecialAreas(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected an array of special area objects and current Z-level").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array areas_array = info[0].As<Napi::Array>();
    int z_to_update = info[1].As<Napi::Number>().Int32Value();

    auto it_map = this->allMapData.find(z_to_update);
    if (it_map == this->allMapData.end()) {
        return env.Undefined(); // No map for this Z-level, so we can't update its cost grid.
    }
    const MapData& mapData = it_map->second;

    std::vector<int> cost_grid(mapData.width * mapData.height, 0);

    for (uint32_t i = 0; i < areas_array.Length(); ++i) {
        Napi::Object area_obj = areas_array.Get(i).As<Napi::Object>();
        
        if (area_obj.Get("z").As<Napi::Number>().Int32Value() != z_to_update) {
            continue; // Ignore areas that are not for the z-level we are updating
        }

        SpecialArea area;
        area.x = area_obj.Get("x").As<Napi::Number>().Int32Value();
        area.y = area_obj.Get("y").As<Napi::Number>().Int32Value();
        area.z = area_obj.Get("z").As<Napi::Number>().Int32Value();
        area.avoidance = area_obj.Get("avoidance").As<Napi::Number>().Int32Value();
        area.width = area_obj.Get("width").As<Napi::Number>().Int32Value();
        area.height = area_obj.Get("height").As<Napi::Number>().Int32Value();
        
        int local_start_x = area.x - mapData.minX;
        int local_start_y = area.y - mapData.minY;
        for (int dx = 0; dx < area.width; ++dx) {
            for (int dy = 0; dy < area.height; ++dy) {
                int current_x = local_start_x + dx;
                int current_y = local_start_y + dy;
                if (current_x >= 0 && current_x < mapData.width && current_y >= 0 && current_y < mapData.height) {
                    int index = current_y * mapData.width + current_x;
                    cost_grid[index] = std::max(cost_grid[index], area.avoidance);
                }
            }
        }
    }
    this->cost_grid_cache[z_to_update] = std::move(cost_grid);
    return env.Undefined();
}
Napi::Value Pathfinder::_findPathInternal(Napi::Env env, const Node& start, const Node& end, const std::vector<Node>& creaturePositions) {
    auto startTime = std::chrono::high_resolution_clock::now();
    Napi::Object result = Napi::Object::New(env);
    std::string searchStatus = "UNKNOWN";
    std::vector<Node> pathResult;
    bool isBlockedByCreature = false;
    Napi::Object blockingCreatureCoords = Napi::Object::New(env);

    auto it_map = this->allMapData.find(start.z);
    if (it_map == this->allMapData.end()) {
        Napi::Error::New(env, "Map data for this Z-level is not loaded.").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const MapData& mapData = it_map->second;
    Node localStart = {start.x - mapData.minX, start.y - mapData.minY, 0, 0, nullptr, start.z};
    Node localEnd = {end.x - mapData.minX, end.y - mapData.minY, 0, 0, nullptr, end.z};

    if (!AStar::inBounds(localStart.x, localStart.y, mapData)) {
        searchStatus = "NO_VALID_START";
    } else {
        auto it_cache = this->cost_grid_cache.find(start.z);
        const std::vector<int>& cost_grid = (it_cache != this->cost_grid_cache.end()) ? it_cache->second : std::vector<int>();
        pathResult = AStar::findPathWithCosts(localStart, localEnd, mapData, cost_grid, creaturePositions, [](){});

        if (!pathResult.empty()) {
            searchStatus = "PATH_FOUND";
            int W = mapData.width;
            int endIdx = localEnd.y * W + localEnd.x;
            if (AStar::sb.gScore[endIdx] >= AStar::CREATURE_BLOCK_COST) {
                isBlockedByCreature = true;
                searchStatus = "BLOCKED_BY_CREATURE";
                for (const auto& p : pathResult) {
                    for (const auto& creature : creaturePositions) {
                        if (p.x == creature.x - mapData.minX && p.y == creature.y - mapData.minY && p.z == creature.z) {
                            blockingCreatureCoords.Set("x", creature.x);
                            blockingCreatureCoords.Set("y", creature.y);
                            blockingCreatureCoords.Set("z", creature.z);
                            goto found_blocker; 
                        }
                    }
                }
                found_blocker:;
            }
        } else {
            searchStatus = "NO_PATH_FOUND";
        }
    }

    auto endTime = std::chrono::high_resolution_clock::now();
    double durationMs = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;
    Napi::Object performance = Napi::Object::New(env);
    performance.Set("totalTimeMs", Napi::Number::New(env, durationMs));
    result.Set("performance", performance);
    result.Set("reason", Napi::String::New(env, searchStatus));
    result.Set("isBlocked", Napi::Boolean::New(env, isBlockedByCreature));
    if (isBlockedByCreature) {
        result.Set("blockingCreatureCoords", blockingCreatureCoords);
    }

    if (!pathResult.empty()) {
        Napi::Array pathArray = Napi::Array::New(env, pathResult.size());
        for (size_t i = 0; i < pathResult.size(); ++i) {
            Napi::Object point = Napi::Object::New(env);
            point.Set("x", Napi::Number::New(env, pathResult[i].x + mapData.minX));
            point.Set("y", Napi::Number::New(env, pathResult[i].y + mapData.minY));
            point.Set("z", Napi::Number::New(env, pathResult[i].z));
            pathArray[i] = point;
        }
        result.Set("path", pathArray);
    } else {
        result.Set("path", env.Null());
    }
    return result;
}
Napi::Value Pathfinder::FindPathSync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsObject() || !info[1].IsObject() || !info[2].IsArray()) {
        Napi::TypeError::New(env, "Expected start and end objects, and creature positions array as arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object startObj = info[0].As<Napi::Object>();
    Node start = {startObj.Get("x").As<Napi::Number>().Int32Value(), startObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, startObj.Get("z").As<Napi::Number>().Int32Value()};
    Napi::Object endObj = info[1].As<Napi::Object>();
    Node end = {endObj.Get("x").As<Napi::Number>().Int32Value(), endObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, endObj.Get("z").As<Napi::Number>().Int32Value()};
    Napi::Array creaturePositionsArray = info[2].As<Napi::Array>();
    std::vector<Node> creaturePositions;
    for (uint32_t i = 0; i < creaturePositionsArray.Length(); ++i) {
        Napi::Object creatureObj = creaturePositionsArray.Get(i).As<Napi::Object>();
        creaturePositions.push_back({
            creatureObj.Get("x").As<Napi::Number>().Int32Value(),
            creatureObj.Get("y").As<Napi::Number>().Int32Value(),
            0, 0, nullptr,
            creatureObj.Get("z").As<Napi::Number>().Int32Value()
        });
    }
    return _findPathInternal(env, start, end, creaturePositions);
}

Napi::Value Pathfinder::FindPathToGoal(const Napi::CallbackInfo& info) {
    auto startTime = std::chrono::high_resolution_clock::now();
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsObject() || !info[1].IsObject() || !info[2].IsArray()) {
        Napi::TypeError::New(env, "Expected start node, goal object, and creature positions array").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object startObj = info[0].As<Napi::Object>();
    Node start = {startObj.Get("x").As<Napi::Number>().Int32Value(), startObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, startObj.Get("z").As<Napi::Number>().Int32Value()};
    Napi::Object goalObj = info[1].As<Napi::Object>();
    std::string stance = goalObj.Get("stance").As<Napi::String>().Utf8Value();

    Napi::Object monsterPosObj = goalObj.Get("targetCreaturePos").As<Napi::Object>();
    Node monster = {monsterPosObj.Get("x").As<Napi::Number>().Int32Value(), monsterPosObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, monsterPosObj.Get("z").As<Napi::Number>().Int32Value()};

    Napi::Array creaturePositionsArray = info[2].As<Napi::Array>();
    std::vector<Node> creaturePositions;
    for (uint32_t i = 0; i < creaturePositionsArray.Length(); ++i) {
        Napi::Object creatureObj = creaturePositionsArray.Get(i).As<Napi::Object>();
        creaturePositions.push_back({
            creatureObj.Get("x").As<Napi::Number>().Int32Value(),
            creatureObj.Get("y").As<Napi::Number>().Int32Value(),
            0, 0, nullptr,
            creatureObj.Get("z").As<Napi::Number>().Int32Value()
        });
    }

    auto it_map = this->allMapData.find(start.z);
    if (it_map == this->allMapData.end()) {
        Napi::Error::New(env, "Map data for this Z-level is not loaded.").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const MapData& mapData = it_map->second;
    auto it_cache = this->cost_grid_cache.find(start.z);
    const std::vector<int>& cost_grid = (it_cache != this->cost_grid_cache.end()) ? it_cache->second : std::vector<int>();

    std::vector<Node> pathResult;
    std::string searchStatus = "UNKNOWN";
    Node localStart = {start.x - mapData.minX, start.y - mapData.minY, 0, 0, nullptr, start.z};

    if (stance == "Reach") {
        Node localEnd = {monster.x - mapData.minX, monster.y - mapData.minY, 0, 0, nullptr, monster.z};

        std::vector<Node> otherCreaturePositions;
        for (const auto& creature : creaturePositions) {
            if (creature.x != monster.x || creature.y != monster.y || creature.z != monster.z) {
                otherCreaturePositions.push_back(creature);
            }
        }

        pathResult = AStar::findPathWithCosts(localStart, localEnd, mapData, cost_grid, otherCreaturePositions, [](){});

    }


    if (!pathResult.empty()) {
        searchStatus = "PATH_FOUND";
    } else {
        searchStatus = "NO_PATH_FOUND";
    }

    auto endTime = std::chrono::high_resolution_clock::now();
    double durationMs = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;

    Napi::Object result = Napi::Object::New(env);
    Napi::Object performance = Napi::Object::New(env);
    performance.Set("totalTimeMs", Napi::Number::New(env, durationMs));
    result.Set("performance", performance);
    result.Set("reason", Napi::String::New(env, searchStatus));

    if (!pathResult.empty()) {
        Napi::Array pathArray = Napi::Array::New(env, pathResult.size());
        for (size_t i = 0; i < pathResult.size(); ++i) {
            Napi::Object point = Napi::Object::New(env);
            point.Set("x", Napi::Number::New(env, pathResult[i].x + mapData.minX));
            point.Set("y", Napi::Number::New(env, pathResult[i].y + mapData.minY));
            point.Set("z", Napi::Number::New(env, pathResult[i].z));
            pathArray[i] = point;
        }
        result.Set("path", pathArray);
    } else {
        result.Set("path", env.Null());
    }

    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Pathfinder::Init(env, exports);
    return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
