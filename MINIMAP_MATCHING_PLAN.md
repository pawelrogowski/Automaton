# Minimap Matching Implementation Plan

This document outlines the detailed plan for implementing the functionality to match captured minimap image data with game minimap files to determine the player's `x,y,z` position.

## Objective

To accurately determine the player's absolute `x,y,z` position on the Tibia map by matching live `minimapFull` region captures with pre-processed game minimap data.

## Strategy

Given that the `minimapFull` region (106x109 pixels) is smaller than a single game minimap tile (256x256 pixels), and the requirement for constant monitoring at 10 frames per second, pre-processing the game's minimap PNG files into an optimized format for efficient in-memory lookup is the most suitable approach.

## Phase 1: Data Preparation (Pre-processing Script)

This phase involves converting the game's `Minimap_Color_x_y_z.png` files into a format that can be quickly loaded and searched by our application.

1.  **Identify Minimap Data Directory:**

    - The exact path for Linux is `~/.local/share/CipSoft GmbH/Tibia/packages/Tibia/minimap`.

2.  **Create a Dedicated Pre-processing Script (`scripts/preprocessMinimaps.js`):**

    - This new Node.js script will be run once or on demand, not as part of the main application loop.
    - It will iterate through all `Minimap_Color_x_y_z.png` files found in the specified directory, focusing initially on `z=7`.
    - For each PNG file:
      - **Load Image:** Use a Node.js image processing library (e.g., `sharp`) to load the PNG image. `sharp` is preferred for performance.
      - **Convert to Raw RGB Buffer:** Convert the loaded image data into a raw RGB buffer format. This format must precisely match the output of the `x11RegionCapture` module (3 bytes per pixel, no alpha channel, with an 8-byte header containing width and height as `UInt32LE`).
      - **Store Optimized Data:** Save this raw RGB buffer to a new, organized directory structure (e.g., `resources/preprocessed_minimaps/z7/Minimap_Color_x_y.bin`). This avoids repeated PNG decoding during runtime.
      - **Generate Metadata:** Create an index file (e.g., `resources/preprocessed_minimaps/z7/index.json`) that maps the original `x,y` coordinates of each 256x256 tile to its corresponding pre-processed binary file path and its absolute `x,y` origin. This index will also store the overall bounding box of the `z=7` map.

3.  **Considerations for Pre-processing:**
    - **Image Library Selection:** We will use `sharp` for its performance and efficiency in handling image conversions.
    - **Buffer Format Consistency:** Strict adherence to the `x11RegionCapture` buffer format is crucial for direct comparison.
    - **Error Handling:** The script will include robust error handling for missing or corrupted PNG files.

## Phase 2: Real-time Position Matching (New Module/Worker)

This phase involves using the pre-processed data to find the player's position based on the live `minimapFull` capture.

1.  **Create a New Module for Map Matching Logic (`electron/utils/minimapMatcher.js`):**

    - This module will contain the core logic for loading pre-processed map data and performing the image matching.
    - It will be imported and used by the `minimapMonitor.js` worker.

2.  **Load Pre-processed Data into Memory:**

    - The `minimapMatcher.js` module will be responsible for loading the pre-processed raw minimap data for `z=7` into memory. Loading the entire floor's data (approx. 12MB) into a single large buffer is acceptable and will offer the best performance for matching.
    - It will also load the associated `index.json` metadata.

3.  **Implement Image Matching Algorithm:**

    - The primary challenge is efficiently finding the small `minimapFull` image (106x109) within the much larger pre-processed map data.
    - Since `findSequencesNative` is confirmed to be only for color sequences and not general template matching, we will need to implement a custom template matching algorithm in JavaScript. A basic pixel-by-pixel comparison with a sliding window will be the starting point. Performance will be monitored, and if necessary, we will explore Node.js bindings for a library like OpenCV in a future iteration.

4.  **Calculate Player Position:**

    - Once a match is found, the matching algorithm will return the top-left `(x_match, y_match)` coordinates of the `minimapFull` within the pre-processed map.
    - Since 1 pixel on the minimap equals 1 game square, these `x_match, y_match` coordinates directly represent the player's absolute `x,y` position on the map.
    - The `z` coordinate will be fixed at `7` for this phase.

5.  **Integrate with `minimapMonitor.js`:**
    - The `minimapMonitor.js` worker will import and use the `minimapMatcher.js` module.
    - After capturing the `minimapFull` image data, `minimapMonitor.js` will pass this data to `minimapMatcher.js` for position calculation.
    - The `minimapMatcher.js` will return the calculated `x,y,z` position.
    - `minimapMonitor.js` will then post this position back to the main process, which can dispatch it to the Redux store (e.g., `gameState/updatePlayerPosition`).

## Proposed Architecture Diagram:

```mermaid
graph TD
    A[Tibia Client Window] -->|Captures minimapFull (106x109 RGB)| B(electron/workers/minimapMonitor.js)
    B -->|Sends captured imageData| C(electron/utils/minimapMatcher.js)
    C -->|Loads preprocessed map data| D(resources/preprocessed_minimaps/z7/)
    C -->|Performs Template Matching| E{Custom JS Algorithm}
    E -->|Calculates Player X,Y,Z| F(Player Position: {x, y, z})
    F -->|Returns position to| B
    B -->|Posts position to| G(Main Electron Process)
    G -->|Dispatches to Redux Store| H(Redux Store: gameState/playerPosition)

    subgraph Pre-processing (One-time or On-demand)
        I[Tibia Minimap PNG Files] -->|Read & Convert to Raw RGB Buffer| J(scripts/preprocessMinimaps.js)
        J -->|Save as .bin files & Index| D
    end
```
