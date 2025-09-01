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
    static constexpr int DIAGONAL_TIE_PENALTY = 1;
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

    inline int octileHeuristic(int x1, int y1, int x2, int y2, int D = BASE_MOVE_COST, int D2 = DIAGONAL_MOVE_COST) {
        int dx = std::abs(x1 - x2);
        int dy = std::abs(y1 - y2);
        int mn = std::min(dx, dy);
        return D * (dx + dy) + (D2 - 2 * D) * mn;
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

    int getPathLength(const Node& start, const Node& end, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        int W = mapData.width;
        int H = mapData.height;
        if (W <= 0 || H <= 0) return -1;
        int mapSize = W * H;
        ensureBuffersSize(mapSize);
        nextVisitToken();
        int visit = sb.visitToken;

        auto indexOf = [&](int x, int y) { return y * W + x; };

        if (!inBounds(end.x, end.y, mapData)) return -1;

        int h0 = octileHeuristic(start.x, start.y, end.x, end.y);

        using PQItem = std::tuple<int,int,int,int>;
        struct Compare {
            bool operator()(PQItem const& a, PQItem const& b) const {
                if (std::get<0>(a) != std::get<0>(b)) return std::get<0>(a) > std::get<0>(b);
                if (std::get<1>(a) != std::get<1>(b)) return std::get<1>(a) > std::get<1>(b);
                return std::get<2>(a) > std::get<2>(b);
            }
        };
        std::priority_queue<PQItem, std::vector<PQItem>, Compare> open;

        int startIdx = indexOf(start.x, start.y);
        int endIdx = indexOf(end.x, end.y);

        sb.gScore[startIdx] = 0;
        sb.parent[startIdx] = -1;
        sb.mark[startIdx] = visit;
        open.emplace(h0 + 0, h0, 0, startIdx);

        int iterations = 0;
        const int dxs[8] = { -1, 1, 0, 0, -1, 1, -1, 1 };
        const int dys[8] = { 0, 0, 1, -1, 1, -1, 1, -1 };

        while (!open.empty()) {
            if (++iterations % 1000 == 0) onCancelled();

            auto [f, h, g, idx] = open.top();
            open.pop();

            if (sb.closedMark[idx] == visit || !(sb.mark[idx] == visit) || g > sb.gScore[idx]) continue;

            if (idx == endIdx) {
                int length = 0;
                int cur = endIdx;
                while (cur != -1 && cur != startIdx) {
                    length++;
                    cur = sb.parent[cur];
                }
                return length;
            }

            sb.closedMark[idx] = visit;
            int cx = idx % W;
            int cy = idx / W;

            for (int dir = 0; dir < 8; ++dir) {
                int nx = cx + dxs[dir];
                int ny = cy + dys[dir];
                if (!inBounds(nx, ny, mapData)) continue;

                int nIdx = indexOf(nx, ny);
                int tileAvoidance = (nIdx >= 0 && nIdx < (int)cost_grid.size()) ? cost_grid[nIdx] : 0;
                bool isWalkableByMap = isWalkable(nx, ny, mapData);

                if (tileAvoidance == 255 || (!isWalkableByMap && tileAvoidance > 0) || (!isWalkableByMap && tileAvoidance == 0 && !(nx == end.x && ny == end.y))) {
                    continue;
                }

                bool isCreatureTile = false;
                for (const auto& creature : creaturePositions) {
                    if (creature.x - mapData.minX == nx && creature.y - mapData.minY == ny && creature.z == start.z) {
                        isCreatureTile = true;
                        break;
                    }
                }
                int creatureCost = (isCreatureTile && !(nx == end.x && ny == end.y)) ? CREATURE_BLOCK_COST : 0;

                bool isDiagonal = (dxs[dir] != 0 && dys[dir] != 0);
                int baseMoveCost = isDiagonal ? DIAGONAL_MOVE_COST : BASE_MOVE_COST;
                int addedCost = (tileAvoidance > 0) ? tileAvoidance : 0;

                int tieBreakerCost = 0;
                if (!isDiagonal) {
                    int dx_from_current = std::abs(end.x - cx);
                    int dy_from_current = std::abs(end.y - cy);
                    if (dx_from_current > dy_from_current) {
                        if (nx == cx) tieBreakerCost = 11; // --- MODIFICATION: Penalty increased to 11
                    } else if (dy_from_current > dx_from_current) {
                        if (ny == cy) tieBreakerCost = 11; // --- MODIFICATION: Penalty increased to 11
                    }
                }

                int tentativeG = (sb.mark[idx] == visit ? sb.gScore[idx] : INF_COST) + baseMoveCost + addedCost + creatureCost + tieBreakerCost;

                if (!(sb.mark[nIdx] == visit) || tentativeG < sb.gScore[nIdx]) {
                    sb.gScore[nIdx] = tentativeG;
                    sb.parent[nIdx] = idx;
                    sb.mark[nIdx] = visit;
                    int nh = octileHeuristic(nx, ny, end.x, end.y);
                    int nf = tentativeG + nh;
                    if (isDiagonal) nf += DIAGONAL_TIE_PENALTY;
                    open.emplace(nf, nh, tentativeG, nIdx);
                }
            }
        }
        return -1;
    }

    bool isReachable(const Node& start, const Node& end, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        return getPathLength(start, end, mapData, cost_grid, creaturePositions, onCancelled) != -1;
    }

    std::vector<Node> findPathWithCosts(const Node& start, const Node& end, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        std::vector<Node> path;
        int W = mapData.width;
        int H = mapData.height;
        if (W <= 0 || H <= 0) return path;
        int mapSize = W * H;
        ensureBuffersSize(mapSize);
        nextVisitToken();
        int visit = sb.visitToken;
        auto indexOf = [&](int x, int y) { return y * W + x; };
        if (!inBounds(end.x, end.y, mapData)) return path;

        int h0 = octileHeuristic(start.x, start.y, end.x, end.y);

        using PQItem = std::tuple<int,int,int,int>;
        struct Compare {
            bool operator()(PQItem const& a, PQItem const& b) const {
                if (std::get<0>(a) != std::get<0>(b)) return std::get<0>(a) > std::get<0>(b);
                if (std::get<1>(a) != std::get<1>(b)) return std::get<1>(a) > std::get<1>(b);
                return std::get<2>(a) > std::get<2>(b);
            }
        };
        std::priority_queue<PQItem, std::vector<PQItem>, Compare> open;
        int startIdx = indexOf(start.x, start.y);
        int endIdx = indexOf(end.x, end.y);
        sb.gScore[startIdx] = 0;
        sb.parent[startIdx] = -1;
        sb.mark[startIdx] = visit;
        open.emplace(h0 + 0, h0, 0, startIdx);
        int iterations = 0;
        const int dxs[8] = { -1, 1, 0, 0, -1, 1, -1, 1 };
        const int dys[8] = { 0, 0, 1, -1, 1, -1, 1, -1 };
        while (!open.empty()) {
            if (++iterations % 1000 == 0) onCancelled();
            auto [f, h, g, idx] = open.top();
            open.pop();
            if (sb.closedMark[idx] == visit) continue;
            if (!(sb.mark[idx] == visit)) continue;
            if (g > sb.gScore[idx]) continue;
            int cx = idx % W;
            int cy = idx / W;
            if (idx == endIdx) {
                int cur = endIdx;
                while (cur != -1) {
                    Node node_to_add;
                    node_to_add.x = cur % W;
                    node_to_add.y = cur / W;
                    node_to_add.z = start.z;
                    path.push_back(node_to_add);
                    cur = sb.parent[cur];
                }
                std::reverse(path.begin(), path.end());
                return path;
            }
            sb.closedMark[idx] = visit;
            for (int dir = 0; dir < 8; ++dir) {
                int nx = cx + dxs[dir];
                int ny = cy + dys[dir];
                if (!inBounds(nx, ny, mapData)) continue;
                int nIdx = indexOf(nx, ny);
                int tileAvoidance = 0;
                if (nIdx >= 0 && nIdx < (int)cost_grid.size()) {
                    tileAvoidance = cost_grid[nIdx];
                }
                bool isWalkableByMap = isWalkable(nx, ny, mapData);
                if (tileAvoidance == 255 || (!isWalkableByMap && tileAvoidance > 0) || (!isWalkableByMap && tileAvoidance == 0 && !(nx == end.x && ny == end.y))) {
                    continue;
                }
                bool isCreatureTile = false;
                for (const auto& creature : creaturePositions) {
                    if (creature.x - mapData.minX == nx && creature.y - mapData.minY == ny && creature.z == start.z) {
                        isCreatureTile = true;
                        break;
                    }
                }
                int creatureCost = 0;
                if (isCreatureTile && !(nx == end.x && ny == end.y)) {
                    creatureCost = CREATURE_BLOCK_COST;
                }
                bool isDiagonal = (dxs[dir] != 0 && dys[dir] != 0);
                int baseMoveCost = isDiagonal ? DIAGONAL_MOVE_COST : BASE_MOVE_COST;
                int addedCost = (tileAvoidance > 0) ? tileAvoidance : 0;

                int tieBreakerCost = 0;
                if (!isDiagonal) {
                    int dx_from_current = std::abs(end.x - cx);
                    int dy_from_current = std::abs(end.y - cy);
                    if (dx_from_current > dy_from_current) {
                        if (nx == cx) tieBreakerCost = 11; // --- MODIFICATION: Penalty increased to 11
                    } else if (dy_from_current > dx_from_current) {
                        if (ny == cy) tieBreakerCost = 11; // --- MODIFICATION: Penalty increased to 11
                    }
                }

                int tentativeG = (sb.mark[idx] == visit ? sb.gScore[idx] : INF_COST) + baseMoveCost + addedCost + creatureCost + tieBreakerCost;

                if (!(sb.mark[nIdx] == visit) || tentativeG < sb.gScore[nIdx]) {
                    sb.gScore[nIdx] = tentativeG;
                    sb.parent[nIdx] = idx;
                    sb.mark[nIdx] = visit;
                    int nh = octileHeuristic(nx, ny, end.x, end.y);
                    int nf = tentativeG + nh;
                    if (isDiagonal) nf += DIAGONAL_TIE_PENALTY;
                    open.emplace(nf, nh, tentativeG, nIdx);
                }
            }
        }
        return path;
    }

    std::vector<Node> findPathToAny(const Node& start, const std::unordered_set<int>& endIndices, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions, std::function<void()> onCancelled) {
        std::vector<Node> path;
        int W = mapData.width;
        int H = mapData.height;
        if (W <= 0 || H <= 0 || endIndices.empty()) return path;

        int mapSize = W * H;
        ensureBuffersSize(mapSize);
        nextVisitToken();
        int visit = sb.visitToken;
        auto indexOf = [&](int x, int y) { return y * W + x; };

        int firstGoalIdx = *endIndices.begin();
        int heuristicEndX = firstGoalIdx % W;
        int heuristicEndY = firstGoalIdx / W;

        using PQItem = std::tuple<int,int,int,int>;
        struct Compare {
             bool operator()(PQItem const& a, PQItem const& b) const {
                if (std::get<0>(a) != std::get<0>(b)) return std::get<0>(a) > std::get<0>(b);
                if (std::get<1>(a) != std::get<1>(b)) return std::get<1>(a) > std::get<1>(b);
                return std::get<2>(a) > std::get<2>(b);
            }
        };
        std::priority_queue<PQItem, std::vector<PQItem>, Compare> open;

        int startIdx = indexOf(start.x, start.y);
        int h0 = octileHeuristic(start.x, start.y, heuristicEndX, heuristicEndY);

        sb.gScore[startIdx] = 0;
        sb.parent[startIdx] = -1;
        sb.mark[startIdx] = visit;
        open.emplace(h0, h0, 0, startIdx);

        int iterations = 0;
        const int dxs[8] = { -1, 1, 0, 0, -1, 1, -1, 1 };
        const int dys[8] = { 0, 0, 1, -1, 1, -1, 1, -1 };

        while (!open.empty()) {
            if (++iterations % 1000 == 0) onCancelled();

            auto [f, h, g, idx] = open.top();
            open.pop();

            if (sb.closedMark[idx] == visit || !(sb.mark[idx] == visit) || g > sb.gScore[idx]) continue;

            if (endIndices.count(idx)) {
                int cur = idx;
                while (cur != -1) {
                    Node node_to_add;
                    node_to_add.x = cur % W;
                    node_to_add.y = cur / W;
                    node_to_add.z = start.z;
                    path.push_back(node_to_add);
                    cur = sb.parent[cur];
                }
                std::reverse(path.begin(), path.end());
                return path;
            }

            sb.closedMark[idx] = visit;
            int cx = idx % W;
            int cy = idx / W;

            for (int dir = 0; dir < 8; ++dir) {
                int nx = cx + dxs[dir];
                int ny = cy + dys[dir];
                if (!inBounds(nx, ny, mapData)) continue;

                int nIdx = indexOf(nx, ny);
                int tileAvoidance = (nIdx >= 0 && nIdx < (int)cost_grid.size()) ? cost_grid[nIdx] : 0;
                bool isWalkableByMap = isWalkable(nx, ny, mapData);

                if (tileAvoidance == 255 || (!isWalkableByMap && tileAvoidance > 0) || (!isWalkableByMap && tileAvoidance == 0)) {
                     continue;
                }

                bool isCreatureTile = false;
                for (const auto& creature : creaturePositions) {
                    if (creature.x - mapData.minX == nx && creature.y - mapData.minY == ny && creature.z == start.z) {
                        isCreatureTile = true;
                        break;
                    }
                }

                if (isCreatureTile && endIndices.count(nIdx) == 0) {
                    continue;
                }
                int creatureCost = isCreatureTile ? CREATURE_BLOCK_COST : 0;

                bool isDiagonal = (dxs[dir] != 0 && dys[dir] != 0);
                int baseMoveCost = isDiagonal ? DIAGONAL_MOVE_COST : BASE_MOVE_COST;
                int addedCost = (tileAvoidance > 0) ? tileAvoidance : 0;

                int tieBreakerCost = 0;
                if (!isDiagonal) {
                    int dx_from_current = std::abs(heuristicEndX - cx);
                    int dy_from_current = std::abs(heuristicEndY - cy);
                    if (dx_from_current > dy_from_current) {
                        if (nx == cx) tieBreakerCost = 11; // --- MODIFICATION: Penalty increased to 11
                    } else if (dy_from_current > dx_from_current) {
                        if (ny == cy) tieBreakerCost = 11; // --- MODIFICATION: Penalty increased to 11
                    }
                }

                int tentativeG = (sb.mark[idx] == visit ? sb.gScore[idx] : INF_COST) + baseMoveCost + addedCost + creatureCost + tieBreakerCost;

                if (!(sb.mark[nIdx] == visit) || tentativeG < sb.gScore[nIdx]) {
                    sb.gScore[nIdx] = tentativeG;
                    sb.parent[nIdx] = idx;
                    sb.mark[nIdx] = visit;
                    int nh = octileHeuristic(nx, ny, heuristicEndX, heuristicEndY);
                    int nf = tentativeG + nh;
                    if (isDiagonal) nf += DIAGONAL_TIE_PENALTY;
                    open.emplace(nf, nh, tentativeG, nIdx);
                }
            }
        }
        return path;
    }

    // ... (rest of file is unchanged) ...
    std::unordered_set<int> findBestTargetTile(const Node& player, const Node& monster, const std::string& stance, int distance, const MapData& mapData, const std::vector<int>& cost_grid, const std::vector<Node>& creaturePositions) {
        std::unordered_set<int> target_indices;
        Node monsterLocal = {monster.x - mapData.minX, monster.y - mapData.minY, 0, 0, nullptr, monster.z};
        std::queue<std::pair<Node, int>> q;
        std::unordered_set<int> visited;
        auto indexOf = [&](int x, int y) { return y * mapData.width + x; };

        if (!AStar::inBounds(monsterLocal.x, monsterLocal.y, mapData)) return target_indices;

        q.push({monsterLocal, 0});
        visited.insert(indexOf(monsterLocal.x, monsterLocal.y));

        while (!q.empty()) {
            auto [current, dist] = q.front();
            q.pop();

            if (stance == "keepAway" && dist == distance) {
                int currentIdx = indexOf(current.x, current.y);
                int tileAvoidance = cost_grid.empty() ? 0 : cost_grid[currentIdx];
                bool isCreatureOnTile = false;
                for (const auto& creature : creaturePositions) {
                    if (creature.x - mapData.minX == current.x && creature.y - mapData.minY == current.y && creature.z == player.z) {
                        isCreatureOnTile = true;
                        break;
                    }
                }
                bool isWalkableNode = (tileAvoidance != 255) && isWalkable(current.x, current.y, mapData) && !isCreatureOnTile;
                if (isWalkableNode) {
                    target_indices.insert(currentIdx);
                }
            }

            if (stance == "keepAway" && dist >= distance) {
                continue;
            }

            for (int dx = -1; dx <= 1; ++dx) {
                for (int dy = -1; dy <= 1; ++dy) {
                    if (dx == 0 && dy == 0) continue;
                    Node neighbor = {current.x + dx, current.y + dy, 0, 0, nullptr, current.z};
                    if (AStar::inBounds(neighbor.x, neighbor.y, mapData)) {
                        int neighborIdx = indexOf(neighbor.x, neighbor.y);
                        if (visited.find(neighborIdx) == visited.end()) {
                            visited.insert(neighborIdx);
                            q.push({neighbor, dist + 1});
                        }
                    }
                }
            }
        }
        return target_indices;
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
    this->cost_grid_cache.clear();
    Napi::Array areas_array = info[0].As<Napi::Array>();
    int current_z = info[1].As<Napi::Number>().Int32Value();
    std::vector<SpecialArea> areas_on_current_z;
    for (uint32_t i = 0; i < areas_array.Length(); ++i) {
        Napi::Object area_obj = areas_array.Get(i).As<Napi::Object>();
        SpecialArea area;
        area.x = area_obj.Get("x").As<Napi::Number>().Int32Value();
        area.y = area_obj.Get("y").As<Napi::Number>().Int32Value();
        area.z = area_obj.Get("z").As<Napi::Number>().Int32Value();
        area.avoidance = area_obj.Get("avoidance").As<Napi::Number>().Int32Value();
        area.width = area_obj.Get("width").As<Napi::Number>().Int32Value();
        area.height = area_obj.Get("height").As<Napi::Number>().Int32Value();
        if (area.z == current_z) {
            areas_on_current_z.push_back(area);
        }
    }
    auto it_map = this->allMapData.find(current_z);
    if (it_map == this->allMapData.end()) {
        return env.Undefined();
    }
    const MapData& mapData = it_map->second;
    std::vector<int> cost_grid(mapData.width * mapData.height, 0);
    for (const auto& area : areas_on_current_z) {
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
    this->cost_grid_cache[current_z] = std::move(cost_grid);
    return env.Undefined();
}
Napi::Value Pathfinder::_findPathInternal(Napi::Env env, const Node& start, const Node& end, const std::vector<Node>& creaturePositions) {
    auto startTime = std::chrono::high_resolution_clock::now();
    Napi::Object result = Napi::Object::New(env);
    std::string searchStatus = "UNKNOWN";
    std::vector<Node> pathResult;
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
        if (it_cache != this->cost_grid_cache.end()) {
            pathResult = AStar::findPathWithCosts(localStart, localEnd, mapData, it_cache->second, creaturePositions, [](){});
        } else {
            std::vector<int> empty_costs;
            pathResult = AStar::findPathWithCosts(localStart, localEnd, mapData, empty_costs, creaturePositions, [](){});
        }
        if (!pathResult.empty()) {
            searchStatus = "PATH_FOUND";
        } else {
            searchStatus = "NO_PATH_FOUND";
        }
    }
    if (pathResult.size() > 1 && pathResult[0].x == localStart.x && pathResult[0].y == localStart.y) {
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

    } else if (stance == "keepAway") {
        int distance = goalObj.Get("distance").As<Napi::Number>().Int32Value();
        std::unordered_set<int> target_indices = AStar::findBestTargetTile(start, monster, stance, distance, mapData, cost_grid, creaturePositions);

        if (!target_indices.empty()) {
            pathResult = AStar::findPathToAny(localStart, target_indices, mapData, cost_grid, creaturePositions, [](){});
        }
    }


    if (!pathResult.empty()) {
        searchStatus = "PATH_FOUND";
    } else {
        searchStatus = "NO_PATH_FOUND";
    }

    if (pathResult.size() > 1 && pathResult[0].x == (start.x - mapData.minX) && pathResult[0].y == (start.y - mapData.minY)) {
        pathResult.erase(pathResult.begin());
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