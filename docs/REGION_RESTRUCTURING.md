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
