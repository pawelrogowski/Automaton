#include "pathfinder.h"
#include "aStarWorker.h"
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

// --- A* Algorithm Implementation ---

namespace AStar {
    // Helper to check if a tile is walkable using the 1-bit packed grid
    bool isWalkable(int x, int y, const MapData& mapData) {
        if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) {
            return false;
        }
        int linearIndex = y * mapData.width + x;
        int byteIndex = linearIndex / 8;
        int bitIndex = linearIndex % 8;
        return (mapData.grid[byteIndex] & (1 << bitIndex)) != 0;
    }

    // Heuristic function (Manhattan distance)
    int heuristic(const Node& a, const Node& b) {
        return (std::abs(a.x - b.x) + std::abs(a.y - b.y)) * 10;
    }

    // Finds the closest walkable neighbor to a given point.
    Node findNearestWalkable(const Node& point, const MapData& mapData) {
        if (isWalkable(point.x, point.y, mapData)) {
            return point;
        }
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
        return {-1, -1, 0, 0, nullptr, point.z}; // Return invalid node
    }

    // The robust A* findPath function
    std::vector<Node> findPath(const Node& start, const Node& end, const MapData& mapData, std::function<void()> onCancelled) {
        std::vector<Node> path;
        std::vector<Node*> allNodes;

        auto cmp = [](const Node* left, const Node* right) { return left->f() > right->f(); };
        std::priority_queue<Node*, std::vector<Node*>, decltype(cmp)> openSet(cmp);
        std::unordered_map<Node, int, NodeHash> gCostMap;

        Node* startNode = new Node{start.x, start.y, 0, heuristic(start, end), nullptr, start.z};
        allNodes.push_back(startNode);
        openSet.push(startNode);
        gCostMap[*startNode] = 0;

        int iterations = 0;
        Node* finalNode = nullptr;

        while (!openSet.empty()) {
            if (++iterations % 1000 == 0) { onCancelled(); }
            Node* current = openSet.top();
            openSet.pop();

            if (current->x == end.x && current->y == end.y) {
                finalNode = current;
                break;
            }

            for (int dx = -1; dx <= 1; ++dx) {
                for (int dy = -1; dy <= 1; ++dy) {
                    if (dx == 0 && dy == 0) continue;
                    int nextX = current->x + dx;
                    int nextY = current->y + dy;
                    if (!isWalkable(nextX, nextY, mapData)) continue;

                    // Increased diagonal cost to prioritize straight paths
                    int moveCost = (dx != 0 && dy != 0) ? 18 : 10;

                    int newG = current->g + moveCost;
                    Node neighborTemplate = {nextX, nextY, 0, 0, nullptr, current->z};
                    auto it = gCostMap.find(neighborTemplate);
                    if (it != gCostMap.end() && newG >= it->second) {
                        continue;
                    }
                    gCostMap[neighborTemplate] = newG;
                    Node* neighbor = new Node{nextX, nextY, newG, heuristic(neighborTemplate, end), current, current->z};
                    allNodes.push_back(neighbor);
                    openSet.push(neighbor);
                }
            }
        }

        if (finalNode != nullptr) {
            Node* current = finalNode;
            while (current != nullptr) {
                path.push_back(*current);
                current = const_cast<Node*>(current->parent);
            }
            std::reverse(path.begin(), path.end());
        }

        for (Node* node : allNodes) {
            delete node;
        }
        return path;
    }
}

// --- Pathfinder N-API Class Implementation ---

Napi::FunctionReference Pathfinder::constructor;

Napi::Object Pathfinder::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Pathfinder", {
        InstanceMethod("loadMapData", &Pathfinder::LoadMapData),
        InstanceMethod("findPath", &Pathfinder::FindPath),
        InstanceMethod("cancelSearch", &Pathfinder::CancelSearch),
        InstanceAccessor("isLoaded", &Pathfinder::IsLoadedGetter, nullptr),
    });
    constructor = Napi::Persistent(func);
    exports.Set("Pathfinder", func);
    return exports;
}

Pathfinder::Pathfinder(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Pathfinder>(info) {}
Pathfinder::~Pathfinder() {
    if (activeWorker) {
        activeWorker->Cancel();
    }
}

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

Napi::Value Pathfinder::FindPath(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (this->activeWorker) {
        this->activeWorker->Cancel();
    }
    Napi::Object startObj = info[0].As<Napi::Object>();
    Napi::Object endObj = info[1].As<Napi::Object>();
    Node start = {
        startObj.Get("x").As<Napi::Number>().Int32Value(),
        startObj.Get("y").As<Napi::Number>().Int32Value(),
        0, 0, nullptr,
        startObj.Get("z").As<Napi::Number>().Int32Value()
    };
    Node end = {
        endObj.Get("x").As<Napi::Number>().Int32Value(),
        endObj.Get("y").As<Napi::Number>().Int32Value(),
        0, 0, nullptr,
        endObj.Get("z").As<Napi::Number>().Int32Value()
    };
    AStarWorker* worker = new AStarWorker(env, this, start, end);
    worker->Queue();
    return worker->GetPromise();
}

Napi::Value Pathfinder::CancelSearch(const Napi::CallbackInfo& info) {
    if (this->activeWorker) {
        this->activeWorker->Cancel();
    }
    return info.Env().Undefined();
}

// --- AStarWorker N-API Class Implementation ---
AStarWorker::AStarWorker(Napi::Env env, Pathfinder* pathfinderInstance, const Node& start, const Node& end)
    : Napi::AsyncWorker(env), pathfinder(pathfinderInstance), startNode(start), endNode(end), deferred(Napi::Promise::Deferred::New(env)) {
    this->pathfinder->activeWorker = this;
}

AStarWorker::~AStarWorker() {
    if (this->pathfinder->activeWorker == this) {
        this->pathfinder->activeWorker = nullptr;
    }
}

void AStarWorker::Cancel() {
    wasCancelled = true;
}

Napi::Promise AStarWorker::GetPromise() {
    return deferred.Promise();
}

void AStarWorker::Execute() {
    auto startTime = std::chrono::high_resolution_clock::now();
    int z = startNode.z;
    auto it = pathfinder->allMapData.find(z);
    if (it == pathfinder->allMapData.end()) {
        SetError("Map data for this Z-level is not loaded.");
        return;
    }
    const MapData& mapData = it->second;

    Node originalLocalStart = {startNode.x - mapData.minX, startNode.y - mapData.minY, 0, 0, nullptr, z};
    Node originalLocalEnd = {endNode.x - mapData.minX, endNode.y - mapData.minY, 0, 0, nullptr, z};

    Node effectiveStart = AStar::findNearestWalkable(originalLocalStart, mapData);
    Node effectiveEnd = AStar::findNearestWalkable(originalLocalEnd, mapData);

    if (effectiveStart.x == -1) {
        this->searchStatus = "NO_VALID_START";
        this->pathResult.clear();
    } else if (effectiveEnd.x == -1) {
        this->searchStatus = "NO_VALID_END";
        this->pathResult.clear();
    } else if (effectiveStart.x == effectiveEnd.x && effectiveStart.y == effectiveEnd.y) {
        this->searchStatus = "WAYPOINT_REACHED";
        this->pathResult.clear();
    } else {
        const int MAX_PATHFINDING_RANGE = 100;
        int distance = std::abs(effectiveStart.x - effectiveEnd.x) + std::abs(effectiveStart.y - effectiveEnd.y);

        if (distance > MAX_PATHFINDING_RANGE) {
            this->searchStatus = "TARGET_TOO_FAR";
            this->pathResult.clear();
        } else {
            auto cancellationCheck = [this]() {
                if (this->wasCancelled) {
                    throw std::runtime_error("Search cancelled");
                }
            };
            try {
                this->pathResult = AStar::findPath(effectiveStart, effectiveEnd, mapData, cancellationCheck);
                this->searchStatus = this->pathResult.empty() ? "NO_PATH_FOUND" : "PATH_FOUND";
            } catch (const std::runtime_error& e) {
                // Catch cancellation
            }
        }
    }

    auto endTime = std::chrono::high_resolution_clock::now();
    durationMs = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;
}

void AStarWorker::OnError(const Napi::Error& e) {
    Napi::HandleScope scope(Env());
    deferred.Reject(e.Value());
}

void AStarWorker::OnOK() {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);
    if (wasCancelled) {
        deferred.Reject(Napi::Error::New(env, "Search cancelled").Value());
        return;
    }
    Napi::Object result = Napi::Object::New(env);
    Napi::Object performance = Napi::Object::New(env);
    performance.Set("totalTimeMs", Napi::Number::New(env, durationMs));
    result.Set("performance", performance);

    result.Set("reason", Napi::String::New(env, this->searchStatus));

    if (!pathResult.empty()) {
        Napi::Array pathArray = Napi::Array::New(env, pathResult.size());
        const MapData& mapData = pathfinder->allMapData.at(startNode.z);
        for (size_t i = 0; i < pathResult.size(); ++i) {
            Napi::Object point = Napi::Object::New(env);
            point.Set("x", Napi::Number::New(env, pathResult[i].x + mapData.minX));
            point.Set("y", Napi::Number::New(env, pathResult[i].y + mapData.minY));
            pathArray[i] = point;
        }
        result.Set("path", pathArray);
    } else {
        result.Set("path", env.Null());
    }
    deferred.Resolve(result);
}

// --- Module Registration ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Pathfinder::Init(env, exports);
    return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)