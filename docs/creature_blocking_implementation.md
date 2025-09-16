# Creature Blocking Detection and Reporting Implementation

This document outlines the technical implementation of the creature path blocking detection mechanism. The system is designed to identify when the only available path to a destination is obstructed by a creature, report this situation, and flag the specific creature involved without initiating any combat action.

## System Architecture

The implementation spans three main components:

1.  **C++ Pathfinder Core (`pathfinder.cc`):** The native module responsible for all pathfinding calculations.
2.  **Pathfinder Worker (`pathfinder/logic.js`):** The Node.js worker that interfaces with the C++ addon and communicates results via a SharedArrayBuffer (SAB).
3.  **Creature Monitor (`creatureMonitor.js`):** The worker responsible for detecting and tracking all creatures on screen.

### Data Flow

1.  **Path Request:** The `cavebotWorker` or `targetingWorker` requests a path to a destination.
2.  **High-Cost Pathfinding (C++):**
    *   Creature tiles are no longer treated as impassable walls. Instead, they are assigned an extremely high movement cost (`CREATURE_BLOCK_COST`).
    *   The A* algorithm searches for the lowest-cost path. If no path exists without crossing a creature tile, it will find a path *through* a creature, resulting in a total path cost exceeding `CREATURE_BLOCK_COST`.
3.  **Block Detection (C++):**
    *   After finding a path, the C++ module checks if the final path cost is greater than or equal to `CREATURE_BLOCK_COST`.
    *   If it is, the module flags the path as blocked (`isBlocked: true`) and iterates through the path nodes to find the first one that matches a known creature's location.
    *   The coordinates of this blocking creature are returned alongside the path data.
4.  **Reporting via SAB (Pathfinder Worker):**
    *   The `pathfinder/logic.js` worker receives the result from the C++ module.
    *   It sees the `isBlocked: true` flag.
    *   It writes a new status, `PATH_STATUS_BLOCKED_BY_CREATURE`, to the `pathDataSAB`.
    *   It also writes the `x`, `y`, and `z` coordinates of the blocking creature into newly designated slots in the `pathDataSAB`.
5.  **Data Enrichment (Creature Monitor):**
    *   The `creatureMonitor.js` worker continuously reads the status from the `pathDataSAB`.
    *   On each processing cycle, it first ensures all creatures in its `activeCreatures` list have `isBlockingPath` set to `false`. This resets the state from the previous cycle.
    *   It then checks if the current status is `PATH_STATUS_BLOCKED_BY_CREATURE`.
    *   If it is, the monitor reads the blocking coordinates from the SAB.
    *   It finds the creature in its `activeCreatures` list whose `gameCoords` match the blocking coordinates and sets its `isBlockingPath` property to `true`.
    *   Finally, it sends the complete, updated list of all on-screen creatures (including the new `isBlockingPath` flag) to the Redux store.

## Future Work: Targeting Integration

This implementation successfully handles the detection and reporting of blocking creatures. The next step, to be handled in a future session, will be to make the `targetingWorker` act on this information.

The `targeting/actions.js` script will be modified to prioritize any creature with the `isBlockingPath: true` flag, overriding all other targeting rules to clear the path.
