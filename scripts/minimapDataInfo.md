# Minimap Preprocessor

This document describes the minimap preprocessor, a script designed to convert the raw Tibia minimap PNGs into highly-optimized data structures for fast, real-time use in an application.

The primary goal is to solve two major performance challenges:

1.  **Visual Positioning:** How can we determine the player's exact `(x, y, z)` coordinates by looking at the small portion of the map visible on their screen? Searching for a 106x109 pixel image within a massive map image in real-time is computationally impossible.
2.  **Pathfinding:** How can we perform efficient pathfinding (e.g., using A\*) without loading and parsing large, inefficient PNG files for walkability information?

To solve this, the script generates two key assets for each map floor (Z-level):

1.  **A Landmark Index (`landmarks.bin`):** An efficient, 4-bit packed index of small, truly unique 3x3 pixel "landmarks" for near-instant visual searching.
2.  **A Walkability Grid (`walkable.bin`):** A highly-compressed, 1-bit packed binary grid and its metadata (`walkable.json`) for memory-efficient pathfinding.

## Pre-processing Pipeline Overview

The script uses a sophisticated, multi-stage process to generate the final data.

### Stage 1: Map Discovery and Assembly

Before any processing can begin, the script needs to understand the full dimensions of each floor.

1.  **Scan:** It reads the entire Tibia `minimap` directory.
2.  **Index:** It parses the filenames of all `Minimap_Color_...` and `Minimap_WaypointCost_...` PNGs to extract their `x`, `y`, and `z` coordinates.
3.  **Calculate Boundaries:** For each Z-level, it determines the minimum and maximum X and Y coordinates (`minX`, `maxX`, `minY`, `maxY`). This defines the total size of the map for that floor.
4.  **Stitch Full Map:** Using these boundaries, it creates a massive in-memory bitmap for each Z-level. It then reads each 256x256 tile and "pastes" its pixel data into the correct location on this large bitmap, effectively reassembling the entire floor map.

### Stage 2: Landmark Generation (A Two-Pass Coverage Strategy)

This is the core of the visual positioning solution. The goal is to find the smallest possible set of landmarks that guarantees that no matter where the player is on the map, their screen will contain at least a few of these unique landmarks.

#### Pass 1: Identify All Unique Candidates

1.  **Scan for Patterns:** The script slides a small `3x3` window across every single pixel of the fully assembled color map.
2.  **Extract & Validate:** It extracts the `3x3` pixel pattern at each position. If the pattern contains any "noise" colors (like the black background), it is discarded.
3.  **Count Occurrences:** It keeps a count of how many times every single valid `3x3` pattern appears on the entire map.
4.  **Filter for Uniqueness:** Any pattern that appears only once (`uniqueness_threshold <= 1`) is considered a "unique landmark candidate". This gives us a large list of all possible landmarks on the map.

#### Pass 2: Intelligent Placement for Full Coverage

Having thousands of landmarks is inefficient. This pass intelligently "thins" the candidate list to a minimal, optimal set.

1.  **Shuffle:** The list of unique landmark candidates is randomly shuffled. This is crucial to prevent geographic bias and ensure the final landmarks are distributed evenly across the map.
2.  **Simulate Visibility:** The script iterates through the shuffled candidates. For each candidate, it asks the question: "Is this landmark _needed_?"
3.  **Check Coverage:** To answer this, it simulates the player's viewport (e.g., 106x109 pixels). It checks if any pixel that would be visible on-screen alongside this landmark is "under-covered" (i.e., is seen by fewer than `REQUIRED_COVERAGE_COUNT` landmarks, which is `2` by default).
4.  **Place or Discard:**
    - If the landmark is needed to improve coverage for any under-covered pixel, it is **kept** and added to the `finalLandmarks` list. The coverage count for all pixels it can "see" is then incremented.
    - If all pixels within its potential view are already sufficiently covered by other landmarks, this candidate is redundant and is **discarded**.
5.  **Final Output:** This process results in a small, efficient set of landmarks that provide robust coverage across the entire map. These are then packed into the `landmarks.bin` file.

### Stage 3: Pathfinding Grid Generation

This process converts the `WaypointCost` PNGs into a simple, fast, and compact format.

1.  **Assemble Map:** Similar to the color map, it assembles a full `WaypointCost` map for the Z-level.
2.  **Analyze Pixels:** It iterates over every pixel of the assembled waypoint map.
3.  **Generate Boolean Grid:**
    - If a pixel is yellow (`#FFFF00`, non-walkable) or magenta (`#FF00FF`, unexplored), it is marked as `0` (non-walkable).
    - All other pixels are considered walkable and marked as `1`.
4.  **Compress and Save:** This simple `1/0` grid is then packed into a highly compressed binary format (1 bit per pixel) and saved as `walkable.bin`. Its metadata (dimensions and origin coordinates) is saved in `walkable.json`.

---

## Raw Data Format

### Visual map data

Each file with a name of the form `Minimap_Color_x_y_z.png` contains the visual map data for a tile of 256×256 pixels. The coordinates in the file name look like this:

- **x** is the absolute X coordinate of the top-left pixel of the tile. At the moment, this value ranges from 31744 (left-most tile) to 33536 (right-most tile), but this range could be extended in the future if CipSoft decides to add new areas outside the current boundaries of the map.
- **y** is the absolute Y coordinate of the top-left pixel of the tile. It currently goes from 30976 (top-most tile) to 32768 (bottom-most tile).
- **z** is the floor ID of the tile. 0 is the highest floor; 7 is the ground floor; 15 is the deepest underground.

### Pathfinding data

Each file with a name of the form `Minimap_WaypointCost_x_y_z.png` contains the pathfinding data for a tile of 256×256 pixels. This is the map that is used for pathfinding, e.g. to calculate the fastest route to a destination when map-clicking. Each of these pixels represents the walking speed friction on a specific tile. Each of the RGB color components (in most cases R=G=B) contains the friction value at a given position. In general, the darker the color, the lower the friction value, and the higher your movement speed on that tile. There are two special cases:

- `#FF00FF` (magenta) tiles are unexplored.
- `#FFFF00` (yellow) tiles are non-walkable.

These aren’t just ordinary PNGs, though — the Tibia client expects them to use a very particular color palette. As a result, PNGs exported from Photoshop or other image editors won’t render properly in the Tibia client. The same goes for PNGs that have been optimized by minimizing the palette.
