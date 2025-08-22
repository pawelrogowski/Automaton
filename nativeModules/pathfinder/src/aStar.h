#ifndef ASTAR_H
#define ASTAR_H

#include <vector>
#include <cmath>
#include <functional>
#include "pathfinder.h"

// Represents a single point/node in the grid
struct Node {
    int x, y;
    int g; // Cost from start
    int h; // Heuristic cost to end
    const Node* parent;
    int z; // <<< FIX: Added z-level member

    int f() const { return g + h; }

    bool operator==(const Node& other) const {
        return x == other.x && y == other.y;
    }
};

// Simple hash for Node, required for unordered_set
struct NodeHash {
    std::size_t operator()(const Node& node) const {
        // Hash on x and y only, as pathfinding is 2D per floor
        return std::hash<int>()(node.y * 10000 + node.x);
    }
};

namespace AStar {
    std::vector<Node> findPathWithCosts( // MODIFIED: Renamed and added creaturePositions
        const Node& start,
        const Node& end,
        const MapData& mapData,
        const std::vector<int>& cost_grid,
        const std::vector<Node>& creaturePositions, // NEW
        std::function<void()> onCancelled
    );

    Node findBestTargetTile( // NEW: Declare findBestTargetTile
        const Node& player,
        const Node& monster,
        const std::string& stance,
        int distance,
        const MapData& mapData,
        const std::vector<int>& cost_grid,
        const std::vector<Node>& creaturePositions // NEW
    );
}

#endif // ASTAR_H