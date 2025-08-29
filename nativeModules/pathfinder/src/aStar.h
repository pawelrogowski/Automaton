// /home/feiron/Dokumenty/Automaton/nativeModules/pathfinder/src/aStar.h
#ifndef ASTAR_H
#define ASTAR_H

#include <vector>
#include <cmath>
#include <functional>
#include <unordered_set>
#include "pathfinder.h"

struct Node;
struct NodeHash;

namespace AStar {
    std::vector<Node> findPathWithCosts(
        const Node& start,
        const Node& end,
        const MapData& mapData,
        const std::vector<int>& cost_grid,
        const std::vector<Node>& creaturePositions,
        std::function<void()> onCancelled
    );

    std::vector<Node> findPathToAny(
        const Node& start,
        const std::unordered_set<int>& endIndices,
        const MapData& mapData,
        const std::vector<int>& cost_grid,
        const std::vector<Node>& creaturePositions,
        std::function<void()> onCancelled
    );

    bool isReachable(
        const Node& start,
        const Node& end,
        const MapData& mapData,
        const std::vector<int>& cost_grid,
        const std::vector<Node>& creaturePositions,
        std::function<void()> onCancelled
    );

    int getPathLength(
        const Node& start,
        const Node& end,
        const MapData& mapData,
        const std::vector<int>& cost_grid,
        const std::vector<Node>& creaturePositions,
        std::function<void()> onCancelled
    );

    // --- FIX: Corrected declaration. It no longer returns a Node, but a set of indices. ---
    std::unordered_set<int> findBestTargetTile(
        const Node& player,
        const Node& monster,
        const std::string& stance,
        int distance,
        const MapData& mapData,
        const std::vector<int>& cost_grid,
        const std::vector<Node>& creaturePositions
    );
}

#endif // ASTAR_H