# Region Definition Restructuring

This document outlines the proposed changes to the region definition structure, currently located in [`electron/constants/regionColorSequences.js`](electron/constants/regionColorSequences.js), to enhance flexibility, clarity, and extensibility.

## Motivation for Change

The existing `regionColorSequences.js` file uses a flat object structure that lacks the ability to:

1.  **Include comprehensive metadata**: Important parameters like `maxRight` and `maxDown` for bounding box calculations are currently hardcoded in `regionMonitor.js`, leading to scattered and less maintainable configurations.
2.  **Support hierarchical relationships**: Many UI elements exist within larger parent regions (e.g., a health bar within a game window). The current flat structure doesn't allow for defining these nested relationships, making it harder to manage and reason about complex UI layouts.
3.  **Improve developer experience**: The current implicit categorization (e.g., `endsWith('CloseButton')`) and lack of explicit region types make the definitions less intuitive and harder to extend.

The goal of this restructuring is to create a more developer-friendly, clear, and capable system for defining and managing screen regions, simplifying future development and maintenance.

## Capabilities of the New Structure

The new structure introduces a `type` property for each region and supports arbitrary levels of nesting via a `children` property.

### 1. Region Types (`type` property)

Each region definition will have a `type` property, which dictates how the region is identified and its specific properties:

- **`type: 'single'`**:
  - **Purpose**: For regions identified by a single color sequence with a fixed, known width and height.
  - **Properties**:
    - `direction`: `'horizontal'` or `'vertical'`.
    - `offset`: `{ x, y }` (relative to the found sequence point).
    - `sequence`: The array of color values or `'any'`.
    - `width`: The fixed width of the region in pixels.
    - `height`: The fixed height of the region in pixels.
    - `backupSequence` (optional): An alternative sequence to search for if the primary one isn't found.
  - **Example**:
    ```javascript
    healthBar: {
      type: 'single',
      direction: 'horizontal',
      offset: { x: 5, y: 0 },
      sequence: [[241, 97, 97], [219, 91, 91], [103, 55, 55], 'any', 'any', [120, 61, 64]],
      width: 94,
      height: 14,
    }
    ```

- **`type: 'boundingBox'`**:
  - **Purpose**: For regions defined by a `start` and `end` color sequence, where `width` and `height` are calculated based on their positions.
  - **Properties**:
    - `start`: Object with `direction`, `offset`, `sequence` for the starting point.
    - `end`: Object with `direction`, `offset`, `sequence` for the ending point.
    - `maxRight`: Maximum horizontal search distance from `start`'s X. Can be a number or `'fullWidth'`.
    - `maxDown`: Maximum vertical search distance from `start`'s Y. Can be a number or `'fullHeight'`.
    - `backupSequence` (optional): Can be added to `start` or `end` objects.
  - **Example**:
    ```javascript
    gameWorld: {
      type: 'boundingBox',
      start: {
        direction: 'horizontal',
        offset: { x: 1, y: 1 },
        sequence: [[22, 22, 22], [24, 24, 24], [23, 23, 23], [22, 22, 22], [21, 21, 21], [24, 24, 24], [23, 24, 23], [24, 24, 24], [27, 27, 26], [24, 24, 24], [22, 22, 22]],
      },
      end: {
        direction: 'horizontal',
        offset: { x: 9, y: -1 },
        sequence: [[111, 111, 111], [117, 117, 117], [116, 116, 116], [116, 116, 116], [113, 113, 113], [115, 115, 115], [116, 116, 115], [115, 115, 115], [118, 118, 117], [115, 115, 115], [114, 114, 114]],
      },
      maxRight: 'fullWidth',
      maxDown: 'fullHeight',
    }
    ```

- **`type: 'fixed'`**:
  - **Purpose**: For regions with static, predefined absolute `x`, `y`, `width`, and `height` coordinates, requiring no color sequence search.
  - **Properties**:
    - `x`: Absolute X coordinate.
    - `y`: Absolute Y coordinate.
    - `width`: Fixed width.
    - `height`: Fixed height.
  - **Example**:
    ```javascript
    gameLog: {
      type: 'fixed',
      x: 808,
      y: 695,
      width: 125,
      height: 11,
    }
    ```

### 2. Nesting Regions (`children` property)

The `children` property allows defining sub-regions logically contained within a parent region. This enables hierarchical organization mirroring the UI layout.

- **Mechanism**:
  - Any `single` or `boundingBox` type region can have a `children` object.
  - Each entry in `children` is another region definition (of any type).
  - The `offset` (for `single` children) or `x`/`y` (for `fixed` children) within a child definition are **relative to the top-left corner of its parent region** once the parent has been located.
  - This supports arbitrary levels of nesting (e.g., parent -> child -> grandchild).

- **Example with `gameWindow` as a parent and `loginPanel` as a child with its own children**:
  ```javascript
  gameWindow: {
    type: 'boundingBox',
    // ... (parent properties)
    children: {
      loginPanel: { // Child of gameWindow
        type: 'boundingBox',
        start: { offset: { x: 100, y: 150 }, /* ... */ }, // Relative to gameWindow
        end: { offset: { x: 300, y: 400 }, /* ... */ },   // Relative to gameWindow
        maxRight: 500,
        maxDown: 500,
        children: {
          loginButton: { // Child of loginPanel (grandchild of gameWindow)
            type: 'single',
            offset: { x: 50, y: 100 }, // Relative to loginPanel
            sequence: [[50, 50, 50], /* ... */],
            width: 80,
            height: 30,
          },
        },
      },
      healthBar: { // Another child of gameWindow
        type: 'single',
        offset: { x: 5, y: 0 }, // Relative to gameWindow
        sequence: [[241, 97, 97], /* ... */],
        width: 94,
        height: 14,
      },
    },
  }
  ```

### 3. Developer Friendliness and Clarity

- **Explicit Types**: Reduces ambiguity by clearly defining how each region is identified.
- **Centralized Metadata**: `maxRight` and `maxDown` are directly part of the bounding box definition.
- **Logical Grouping**: Hierarchical organization mirrors UI layout, improving readability and maintainability.
- **Relative Positioning**: Simplifies updates if parent region's absolute position changes.
- **Extensibility**: The `type` system allows for easy addition of new region identification methods.
- **`category` (optional)**: An optional property (e.g., `'main'`, `'list'`, `'button'`) for further logical grouping or filtering in the worker.

## Limitations

- **Increased Complexity in `regionMonitor.js`**: The `performFullScan` function will become more complex due to the need for recursive processing of nested regions and handling different region types.
- **Initial Migration Effort**: All existing region definitions will need to be manually migrated to the new structure.
- **Performance Overhead (Minor)**: While the new structure is more organized, the recursive search in `regionMonitor.js` might introduce a negligible performance overhead compared to the current flat iteration, but this is expected to be minimal given the typical number of UI regions.

## Detailed Implementation Plan

The implementation will follow the previously outlined steps:

### 1. Refactor `electron/constants/regionColorSequences.js` to `electron/constants/regionDefinitions.js`

- Create a new file [`electron/constants/regionDefinitions.js`](electron/constants/regionDefinitions.js).
- Migrate all existing region definitions from [`electron/constants/regionColorSequences.js`](electron/constants/regionColorSequences.js) into the new structure.
  - Assign `type` (`single`, `boundingBox`, `fixed`) to each region.
  - For `single` type regions, add `width` and `height` properties based on their known dimensions.
  - For `boundingBox` type regions, encapsulate `direction`, `offset`, and `sequence` into `start` and `end` objects, and add `maxRight` and `maxDown` properties with their respective values (or `'fullWidth'`, `'fullHeight'`).
  - Nest regions (e.g., `healthBar`, `manaBar`, `minimap`, `cooldownBar`, `statusBar`, `amuletSlot`, `ringSlot`, `bootsSlot`, `chatOn`, `chatOff`, `onlineMarker`, `preyWindow`) under `gameWindow` as children, adjusting their `offset` to be relative to `gameWindow`'s top-left.
  - Add `gameLog` as a `fixed` type region with its coordinates.
  - Top-level bounding box regions like `battleList`, `partyList`, `overallActionBars`, `skillsWidget`, `chatboxMain`, `chatboxSecondary`, `chatBoxTabRow` will remain at the top level.
  - `connectionLostCloseButton` will remain a top-level `single` region.
- Remove the old [`electron/constants/regionColorSequences.js`](electron/constants/regionColorSequences.js) file.

### 2. Update `electron/workers/regionMonitor.js`

- Change the import statement from `regionColorSequences` to `regionDefinitions`.
- **Modify `findBoundingRect`**:
  - Update its signature to accept a single `regionConfig` object (e.g., `findBoundingRect(buffer, regionConfig, metadata)`).
  - Inside the function, access `regionConfig.start`, `regionConfig.end`, `regionConfig.maxRight`, `regionConfig.maxDown`.
- **Refactor `performFullScan`**:
  - Implement a recursive helper function, e.g., `processRegionDefinitions(definitions, parentAbsoluteX, parentAbsoluteY, buffer, metadata, foundRegions)`.
  - This helper will iterate through `definitions`:
    - If `type: 'single'`: Calculate absolute `x, y` using `parentAbsoluteX`, `parentAbsoluteY`, and `region.offset`. Use `findSequencesNativeBatch` to find the sequence. Store the found region with its `width`, `height`, and `rawPos`.
    - If `type: 'boundingBox'`: Calculate absolute search area for `start` sequence. Call the updated `findBoundingRect` with the region's `start`, `end`, `maxRight`, `maxDown`. Store the found region with its `rawStartPos`, `rawEndPos`.
    - If `type: 'fixed'`: Directly use `region.x`, `region.y`, `region.width`, `region.height` (these are absolute, so no parent offset needed).
    - If a region has `children`: Recursively call `processRegionDefinitions` for its children, passing the _found absolute coordinates_ of the current region as the new `parentAbsoluteX` and `parentAbsoluteY`.
  - The main `performFullScan` will initiate this process by calling `processRegionDefinitions` with the top-level `regionDefinitions` and initial `parentAbsoluteX=0`, `parentAbsoluteY=0`.
  - Remove the old logic that separates regions into `regularRegions`, `closeButtons`, `okButtons` based on name suffixes. Instead, rely on the `type` and `category` properties in the new definitions.
- **Update `performTargetedCheck`**:
  - Adapt the logic to work with the new structure. When verifying a cached region, it will need to know its original `type` (single or boundingBox) to correctly reconstruct the search area for `findSequencesNativeBatch` using `rawPos` or `rawStartPos`/`rawEndPos`.

### 3. Update `electron/workers/screenMonitor.js`

- Change the import statement from `regionColorSequences` to `regionDefinitions`.
- No significant logic changes are expected here. `screenMonitor.js` consumes the flat `regions` object provided by `regionCoordinatesSlice`, which `regionMonitor.js` will continue to produce. The internal logic for `searchTasks` and processing `regions.cooldowns`, `regions.statusBar`, etc., should remain compatible.

### 4. Verify `frontend/redux/slices/regionCoordinatesSlice.js`

- No changes are needed in this file. It will continue to receive and store a flat object of regions with `x`, `y`, `width`, and `height` properties, which is the output format from `regionMonitor.js`.

## Conclusion

This restructuring will provide a more robust, maintainable, and intuitive way to define and manage UI regions, paving the way for easier integration of new features and improved clarity in the codebase.
