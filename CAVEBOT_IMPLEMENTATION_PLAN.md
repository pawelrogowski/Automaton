# Cavebot Page Implementation Plan

## Overall Goal

Implement a new 'Cavebot' page with an interactive minimap, positioned adjacent to the 'Game State' page, displaying preprocessed map tiles and dynamically centering on the player's coordinates with panning, zooming, and Z-level view.

## High-Level Steps

1.  **Frontend Integration:**

    - Create a new React component for the `Cavebot` page.
    - Add a new navigation button for 'Cavebot' in `frontend/pages/Layout.js` next to 'Game State'.
    - Add a new route for the `Cavebot` page in `frontend/pages/Layout.js`.
    - Create a styled component for the `Cavebot` page layout.

2.  **Minimap Component Development:**

    - Create a new React component for the interactive minimap.
    - Implement a canvas for rendering the map tiles.
    - Load preprocessed PNG map tiles (`_map_debug_zX.png`) based on the current Z-level.
    - Implement logic to dynamically center the map on the player's coordinates from Redux state.
    - Implement panning functionality (drag to move map).
    - Implement zooming functionality (scroll to zoom).
    - Implement Z-level changing functionality (buttons/slider for 0-15).
    - Ensure map display synchronizes with coordinate state changes.

3.  **Redux State Management:**

    - Verify `playerMinimapPosition` in `frontend/redux/slices/gameStateSlice.js` is correctly updated and accessible.

4.  **Webpack Configuration:**
    - Ensure Webpack is configured to handle the loading of preprocessed PNG map tiles from `resources/preprocessed_minimaps/`.

## Detailed Plan

### Phase 1: Frontend Structure and Navigation

- **Step 1.1: Create `Cavebot.js` page component.**
  - Create a new file: `frontend/pages/Cavebot.js`.
  - This component will initially be a placeholder.
- **Step 1.2: Create `Cavebot.styled.js` for styling.**
  - Create a new file: `frontend/pages/Cavebot.styled.js`.
  - Define basic styling for the `Cavebot` page.
- **Step 1.3: Add 'Cavebot' navigation button in `Layout.js`.**
  - Modify `frontend/pages/Layout.js`.
  - Add a new `<NavButton>` component in the `<Header>` section, positioned to the right of the 'Game State' button. I will use a placeholder icon for now.
- **Step 1.4: Add 'Cavebot' route in `Layout.js`.**
  - Modify `frontend/pages/Layout.js`.
  - Add a new `<Route>` for `/cavebot` that renders the `Cavebot` component.

### Phase 2: Interactive Minimap Component

- **Step 2.1: Create `Minimap.jsx` component.**
  - Create a new file: `frontend/components/Minimap/Minimap.jsx`.
  - This component will contain the `<canvas>` element and all minimap rendering/interaction logic.
- **Step 2.2: Create `Minimap.styled.js` for styling.**
  - Create a new file: `frontend/components/Minimap/Minimap.styled.js`.
  - Define styling for the minimap canvas and controls.
- **Step 2.3: Implement basic canvas rendering.**
  - In `Minimap.jsx`, get a reference to the canvas context and draw a placeholder.
- **Step 2.4: Load and render map tiles.**
  - Implement a function to load the `_map_debug_z${z}.png` for the current Z-level from `resources/preprocessed_minimaps/zX/`.
  - Use React's `useEffect` hook to re-render the map when player coordinates or Z-level changes.
- **Step 2.5: Implement player centering.**
  - Subscribe to `playerMinimapPosition` from Redux using `useSelector`.
  - Calculate the offset needed to center the player on the 400x400px canvas and adjust the canvas drawing origin.
- **Step 2.6: Implement Z-level control.**
  - Add UI elements (e.g., buttons or a slider) to change the `z` value (0-15).
  - Update the Redux state or a local state that triggers map re-rendering with the new Z-level.
- **Step 2.7: Implement panning.**
  - Add mouse event listeners (`mousedown`, `mousemove`, `mouseup`) to the canvas.
  - Calculate pan offsets based on mouse movement and adjust the canvas drawing origin.
- **Step 2.8: Implement zooming.**
  - Add mouse wheel event listener to the canvas.
  - Adjust a zoom level state variable and scale the canvas context, adjusting drawing origin to zoom around the mouse cursor.

### Phase 3: Redux Integration and Data Flow

- **Step 3.1: Verify `gameStateSlice.js` `playerMinimapPosition` access.**
  - Confirm that `state.playerMinimapPosition` is correctly updated by `minimapMonitor.js` and accessible in the React components.

### Phase 4: Webpack Configuration for Map Tiles

- **Step 4.1: Review `webpack.config.cjs` for image loading.**
  - Ensure the existing `.png` rule or a new `CopyWebpackPlugin` rule correctly handles the `resources/preprocessed_minimaps/zX/_map_debug_zX.png` files so they are accessible in the frontend build.

## Mermaid Diagram

```mermaid
graph TD
    A[User Request: Implement Cavebot Page] --> B{Architect Mode: Plan}

    B --> C[Phase 1: Frontend Structure & Navigation]
        C --> C1[Create frontend/pages/Cavebot.js]
        C --> C2[Create frontend/pages/Cavebot.styled.js]
        C --> C3[Modify frontend/pages/Layout.js: Add NavButton for Cavebot]
        C --> C4[Modify frontend/pages/Layout.js: Add Route for /cavebot]

    B --> D[Phase 2: Interactive Minimap Component]
        D --> D1[Create frontend/components/Minimap/Minimap.jsx]
        D --> D2[Create frontend/components/Minimap/Minimap.styled.js]
        D --> D3[Implement Canvas Rendering]
        D --> D4[Load & Render Map Tiles (PNGs from resources/preprocessed_minimaps)]
        D --> D5[Implement Player Centering (from Redux playerMinimapPosition)]
        D --> D6[Implement Z-level Control (0-15)]
        D --> D7[Implement Panning]
        D --> D8[Implement Zooming]

    B --> E[Phase 3: Redux State Management]
        E --> E1[Verify playerMinimapPosition in gameStateSlice.js]

    B --> F[Phase 4: Webpack Configuration]
        F --> F1[Review/Adjust webpack.config.cjs for map tile loading]

    C --> G[Integrate Minimap into Cavebot Page]
    D --> G
    E --> D5
    F --> D4

    G --> H[Final Review & Approval]
    H --> I[Switch to Code Mode for Implementation]
```
