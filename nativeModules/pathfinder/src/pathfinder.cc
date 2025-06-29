#include "pathfinder.h"
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

// Internal-only helper struct.
struct SpecialArea {
    int x, y, z;
    int width, height;
    int avoidance;
};

namespace AStar {
    // isWalkable is shared and unchanged.
    bool isWalkable(int x, int y, const MapData& mapData) {
        if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) return false;
        int linearIndex = y * mapData.width + x;
        int byteIndex = linearIndex / 8;
        int bitIndex = linearIndex % 8;
        return (mapData.grid[byteIndex] & (1 << bitIndex)) != 0;
    }

    // REVERTED: Heuristic back to Manhattan distance, as it's more suitable with high diagonal costs.
    int heuristic(const Node& a, const Node& b) {
        return (std::abs(a.x - b.x) + std::abs(a.y - b.y)) * 10;
    }

    // findNearestWalkable is shared and unchanged.
    Node findNearestWalkable(const Node& point, const MapData& mapData) {
        if (isWalkable(point.x, point.y, mapData)) return point;
        for (int dy = -1; dy <= 1; ++dy) {
            for (int dx = -1; dx <= 1; ++dx) {
                if (dx == 0 && dy == 0) continue;
                int checkX = point.x + dx;
                int checkY = point.y + dy;
                if (isWalkable(checkX, checkY, mapData)) {
                    return {checkX, checkY, 0, 0, nullptr, point.z};
                }
            }
        }
        return {-1, -1, 0, 0, nullptr, point.z};
    }

    // --- VERSION 1: The fast, default A* without cost grid logic ---
    // EDITED: Removed turn penalty. Diagonals are now always allowed but have a very high cost.
    std::vector<Node> findPath(const Node& start, const Node& end, const Node& heuristicTarget, const MapData& mapData, std::function<void()> onCancelled) {
        std::vector<Node> path;
        std::vector<Node*> allNodes;
        const int BASE_MOVE_COST = 10;
        // A diagonal move costs the same as 5 straight moves.
        const int DIAGONAL_MOVE_COST = 50;

        auto cmp = [](const Node* left, const Node* right) { if (left->f() != right->f()) return left->f() > right->f(); return left->h > right->h; };
        std::priority_queue<Node*, std::vector<Node*>, decltype(cmp)> openSet(cmp);
        std::unordered_map<Node, int, NodeHash> gCostMap;
        Node* startNode = new Node{start.x, start.y, 0, heuristic(start, heuristicTarget), nullptr, start.z};
        allNodes.push_back(startNode);
        openSet.push(startNode);
        gCostMap[*startNode] = 0;
        Node* finalNode = nullptr;
        int iterations = 0;
        while (!openSet.empty()) {
            if (++iterations % 1000 == 0) onCancelled();
            Node* current = openSet.top();
            openSet.pop();
            if (gCostMap.count(*current) && current->g > gCostMap.at(*current)) continue;
            if (current->x == end.x && current->y == end.y) { finalNode = current; break; }

            for (int dx = -1; dx <= 1; ++dx) {
                for (int dy = -1; dy <= 1; ++dy) {
                    if (dx == 0 && dy == 0) continue;

                    int nextX = current->x + dx, nextY = current->y + dy;
                    if (!isWalkable(nextX, nextY, mapData)) continue;

                    bool isDiagonal = (dx != 0 && dy != 0);
                    int moveCost = isDiagonal ? DIAGONAL_MOVE_COST : BASE_MOVE_COST;
                    int newG = current->g + moveCost;

                    Node neighborTemplate = {nextX, nextY, 0, 0, nullptr, current->z};
                    auto it = gCostMap.find(neighborTemplate);
                    if (it != gCostMap.end() && newG >= it->second) continue;
                    gCostMap[neighborTemplate] = newG;
                    Node* neighbor = new Node{nextX, nextY, newG, heuristic(neighborTemplate, heuristicTarget), current, current->z};
                    allNodes.push_back(neighbor);
                    openSet.push(neighbor);
                }
            }
        }
        if (finalNode) {
            Node* current = finalNode;
            while (current) { path.push_back(*current); current = const_cast<Node*>(current->parent); }
            std::reverse(path.begin(), path.end());
        }
        for (Node* node : allNodes) delete node;
        return path;
    }

    // --- VERSION 2: The A* that handles cost grids ---
    // EDITED: Removed turn penalty. Diagonals are now always allowed but have a very high cost.
    std::vector<Node> findPathWithCosts(const Node& start, const Node& end, const Node& heuristicTarget, const MapData& mapData, const std::vector<int>& cost_grid, std::function<void()> onCancelled) {
        std::vector<Node> path;
        std::vector<Node*> allNodes;
        const int BASE_MOVE_COST = 10;
        // A diagonal move costs the same as 5 straight moves.
        const int DIAGONAL_MOVE_COST = 50;

        auto cmp = [](const Node* left, const Node* right) { if (left->f() != right->f()) return left->f() > right->f(); return left->h > right->h; };
        std::priority_queue<Node*, std::vector<Node*>, decltype(cmp)> openSet(cmp);
        std::unordered_map<Node, int, NodeHash> gCostMap;
        Node* startNode = new Node{start.x, start.y, 0, heuristic(start, heuristicTarget), nullptr, start.z};
        allNodes.push_back(startNode);
        openSet.push(startNode);
        gCostMap[*startNode] = 0;
        Node* finalNode = nullptr;
        int iterations = 0;
        while (!openSet.empty()) {
            if (++iterations % 1000 == 0) onCancelled();
            Node* current = openSet.top();
            openSet.pop();
            if (gCostMap.count(*current) && current->g > gCostMap.at(*current)) continue;
            if (current->x == end.x && current->y == end.y) { finalNode = current; break; }

            for (int dx = -1; dx <= 1; ++dx) {
                for (int dy = -1; dy <= 1; ++dy) {
                    if (dx == 0 && dy == 0) continue;

                    int nextX = current->x + dx, nextY = current->y + dy;
                    if (!isWalkable(nextX, nextY, mapData)) continue;

                    int additional_cost = 0;
                    int cost_grid_index = nextY * mapData.width + nextX;
                    if(cost_grid_index >= 0 && cost_grid_index < cost_grid.size()) {
                        additional_cost = cost_grid[cost_grid_index];
                    }

                    bool isDiagonal = (dx != 0 && dy != 0);
                    int moveCost = (isDiagonal ? DIAGONAL_MOVE_COST : BASE_MOVE_COST) + additional_cost;
                    int newG = current->g + moveCost;

                    Node neighborTemplate = {nextX, nextY, 0, 0, nullptr, current->z};
                    auto it = gCostMap.find(neighborTemplate);
                    if (it != gCostMap.end() && newG >= it->second) continue;
                    gCostMap[neighborTemplate] = newG;
                    Node* neighbor = new Node{nextX, nextY, newG, heuristic(neighborTemplate, heuristicTarget), current, current->z};
                    allNodes.push_back(neighbor);
                    openSet.push(neighbor);
                }
            }
        }
        if (finalNode) {
            Node* current = finalNode;
            while (current) { path.push_back(*current); current = const_cast<Node*>(current->parent); }
            std::reverse(path.begin(), path.end());
        }
        for (Node* node : allNodes) delete node;
        return path;
    }
}

// --- N-API Section ---
Napi::FunctionReference Pathfinder::constructor;

Napi::Object Pathfinder::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Pathfinder", {
        InstanceMethod("loadMapData", &Pathfinder::LoadMapData),
        InstanceMethod("findPathSync", &Pathfinder::FindPathSync),
        InstanceMethod("updateSpecialAreas", &Pathfinder::UpdateSpecialAreas),
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
        map.grid.assign(gridBuffer.Data(), gridBuffer.Data() + gridBuffer.Length());
        this->allMapData[z] = std::move(map);
    }
    this->isLoaded = true;
    return env.Undefined();
}

Napi::Value Pathfinder::UpdateSpecialAreas(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Expected an array of special area objects").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    this->cost_grid_cache.clear();
    Napi::Array areas_array = info[0].As<Napi::Array>();
    if (areas_array.Length() == 0) {
        return env.Undefined();
    }

    std::vector<SpecialArea> all_special_areas;
    for (uint32_t i = 0; i < areas_array.Length(); ++i) {
        Napi::Object area_obj = areas_array.Get(i).As<Napi::Object>();
        SpecialArea area;
        area.x = area_obj.Get("x").As<Napi::Number>().Int32Value();
        area.y = area_obj.Get("y").As<Napi::Number>().Int32Value();
        area.z = area_obj.Get("z").As<Napi::Number>().Int32Value();
        area.avoidance = area_obj.Get("avoidance").As<Napi::Number>().Int32Value();
        area.width = area_obj.Get("width").As<Napi::Number>().Int32Value();
        area.height = area_obj.Get("height").As<Napi::Number>().Int32Value();
        all_special_areas.push_back(area);
    }

    for (auto const& [z_level, mapData] : this->allMapData) {
        std::vector<int> cost_grid(mapData.width * mapData.height, 0);
        bool grid_was_modified = false;
        for (const auto& area : all_special_areas) {
            if (area.z != z_level) continue;
            grid_was_modified = true;
            int local_start_x = area.x - mapData.minX;
            int local_start_y = area.y - mapData.minY;
            for (int dx = 0; dx < area.width; ++dx) {
                for (int dy = 0; dy < area.height; ++dy) {
                    int current_x = local_start_x + dx;
                    int current_y = local_start_y + dy;
                    if (current_x >= 0 && current_x < mapData.width && current_y >= 0 && current_y < mapData.height) {
                        cost_grid[current_y * mapData.width + current_x] = std::max(cost_grid[current_y * mapData.width + current_x], area.avoidance);
                    }
                }
            }
        }
        if (grid_was_modified) {
            this->cost_grid_cache[z_level] = std::move(cost_grid);
        }
    }
    return env.Undefined();
}

Napi::Value Pathfinder::FindPathSync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto startTime = std::chrono::high_resolution_clock::now();

    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected start and end objects as arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object startObj = info[0].As<Napi::Object>();
    Node start = {startObj.Get("x").As<Napi::Number>().Int32Value(), startObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, startObj.Get("z").As<Napi::Number>().Int32Value()};
    Napi::Object endObj = info[1].As<Napi::Object>();
    Node end = {endObj.Get("x").As<Napi::Number>().Int32Value(), endObj.Get("y").As<Napi::Number>().Int32Value(), 0, 0, nullptr, endObj.Get("z").As<Napi::Number>().Int32Value()};

    std::string waypointType = "";
    if (info.Length() > 2 && info[2].IsObject()) {
        Napi::Object options = info[2].As<Napi::Object>();
        if (options.Has("waypointType")) waypointType = options.Get("waypointType").As<Napi::String>().Utf8Value();
    }

    Napi::Object result = Napi::Object::New(env);
    std::string searchStatus = "UNKNOWN";
    std::vector<Node> pathResult;

    auto it_map = this->allMapData.find(start.z);
    if (it_map == this->allMapData.end()) {
        Napi::Error::New(env, "Map data for this Z-level is not loaded.").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const MapData& mapData = it_map->second;

    Node originalLocalStart = {start.x - mapData.minX, start.y - mapData.minY, 0, 0, nullptr, start.z};
    Node originalLocalEnd = {end.x - mapData.minX, end.y - mapData.minY, 0, 0, nullptr, end.z};
    int dx_abs = std::abs(originalLocalStart.x - originalLocalEnd.x);
    int dy_abs = std::abs(originalLocalStart.y - originalLocalEnd.y);
    bool isAdjacent = (dx_abs <= 1 && dy_abs <= 1 && (dx_abs + dy_abs > 0));
    bool isAlreadyAtTarget = (dx_abs == 0 && dy_abs == 0);

    if (isAlreadyAtTarget) {
        searchStatus = "WAYPOINT_REACHED";
    } else if (isAdjacent) {
        bool isCardinalMove = (dx_abs + dy_abs) == 1;
        bool canMoveDiagonally = (waypointType == "Stand" || waypointType == "Machete" || waypointType == "Rope" || waypointType == "Shovel");
        if (isCardinalMove || canMoveDiagonally) {
            pathResult.push_back(originalLocalEnd);
            searchStatus = "PATH_FOUND";
        } else {
            isAdjacent = false;
        }
    }

    if (!isAdjacent && !isAlreadyAtTarget) {
        Node effectiveStart = AStar::findNearestWalkable(originalLocalStart, mapData);
        if (effectiveStart.x == -1) {
            searchStatus = "NO_VALID_START";
        } else {
            bool endIsWalkable = AStar::isWalkable(originalLocalEnd.x, originalLocalEnd.y, mapData);
            Node effectiveEnd = endIsWalkable ? originalLocalEnd : AStar::findNearestWalkable(originalLocalEnd, mapData);
            if (effectiveEnd.x == -1) {
                searchStatus = "NO_VALID_END";
            } else if (effectiveStart.x == effectiveEnd.x && effectiveStart.y == effectiveEnd.y) {
                if (!endIsWalkable) pathResult.push_back(originalLocalEnd);
                searchStatus = "WAYPOINT_REACHED";
            } else {
                auto it_cache = this->cost_grid_cache.find(start.z);
                if (it_cache != this->cost_grid_cache.end()) {
                    pathResult = AStar::findPathWithCosts(effectiveStart, effectiveEnd, originalLocalEnd, mapData, it_cache->second, [](){});
                } else {
                    pathResult = AStar::findPath(effectiveStart, effectiveEnd, originalLocalEnd, mapData, [](){});
                }

                if (!pathResult.empty()) {
                    searchStatus = "PATH_FOUND";
                    if (!endIsWalkable) pathResult.push_back(originalLocalEnd);
                } else {
                    searchStatus = "NO_PATH_FOUND";
                }
            }
        }
    }

    if (!pathResult.empty() && pathResult[0].x == originalLocalStart.x && pathResult[0].y == originalLocalStart.y) {
        pathResult.erase(pathResult.begin());
    }

    auto endTime = std::chrono::high_resolution_clock::now();
    double durationMs = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;
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