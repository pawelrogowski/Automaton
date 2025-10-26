# Automaton Project Documentation

This document provides an exhaustive overview of the Automaton project, designed to serve as comprehensive context for any coding LLM queries related to development, debugging, enhancement, or maintenance. It covers the project's purpose, architecture, detailed workings, key components, challenges faced, optimization strategies, code style guidelines, build processes, and future considerations. The goal is to equip developers or AI assistants with deep contextual understanding to make informed decisions without needing to repeatedly explore the codebase.

## Project Overview

### What is Automaton?
Automaton is an advanced desktop automation tool built as an Electron application, specifically tailored for automating tasks in the MMORPG *Tibia*. *Tibia* is a 2D massively multiplayer online role-playing game developed by CipSoft, known for its pixel-art graphics, complex gameplay involving exploration, combat, and resource management, and a large player base. Automation in this context refers to scripting and AI-driven behaviors to handle repetitive in-game actions such as navigation, combat targeting, health monitoring, and resource gathering—commonly known as "botting."

**Important Note on Usage and Ethics**: While powerful for legitimate testing, scripting education, or single-player simulations, automating *Tibia* gameplay violates the game's Terms of Service (ToS) and can result in account bans. This project is intended for educational purposes, research into computer vision and automation, or offline/private server use. Developers using this tool assume all risks related to game policies. The project emphasizes modular design to allow adaptation for non-game automation scenarios, such as general screen interaction or scripting interfaces.

### Core Goals
- **Automation Efficiency**: Enable precise, low-latency control over game inputs (keyboard, mouse) and analysis of game state via screen capture and OCR.
- **Extensibility**: Support custom Lua scripts for user-defined behaviors, integrated via a WebAssembly-based Lua runtime (wasmOon).
- **User Interface**: Provide an intuitive React-based frontend for configuring bots, monitoring status, and visualizing game data.
- **Performance**: Run smoothly on Linux (primary target OS) with minimal CPU/GPU overhead, leveraging native C++ modules for performance-critical tasks.
- **Cross-Platform Potential**: Built with Electron for easy portability to Windows/macOS, though native modules are Linux-focused (X11-based).

### Project Scope and Limitations
- **Target Platform**: Linux (Ubuntu/Debian recommended), using X11 for window management and screen capture. Windows support would require rewriting native modules (e.g., using WinAPI).
- **Dependencies**: Node.js (v18+), Electron (v25+), React (v18+), Webpack for bundling, and various npm packages (see `package.json` for full list).
- **Non-Goals**: Real-time multiplayer cheating detection evasion (though some obfuscation tactics are discussed); mobile support; or integration with official *Tibia* APIs (none exist for automation).

### History and Evolution
The project originated as a personal tool for *Tibia* scripting experiments around 2022. It has evolved from a simple Python script using OpenCV for image recognition to a full-fledged Electron app with native performance modules. Key milestones:
- **v0.1**: Basic Electron shell with manual keyboard simulation.
- **v0.5**: Integration of C++ N-API modules for faster screen analysis.
- **v1.0**: React frontend with Redux state management and Lua scripting support.
Current version (as of documentation): v1.2, focusing on optimization for multi-monitor setups and improved minimap pathfinding.

## Architecture

Automaton follows a client-server-like architecture within Electron's main/renderer process model, augmented by native C++ modules and Lua scripting. The project is divided into distinct directories for separation of concerns:

### Directory Structure
```
Automaton/
├── electron/          # Main process: IPC, hardware control, workers
│   ├── main.js        # Entry point: Window creation, IPC setup
│   ├── ipcHandlers.js # Event handlers for renderer communication
│   ├── screenMonitor.js # Continuous screen capture and analysis
│   ├── inputController.js # Keyboard/mouse simulation
│   ├── workerPool.js  # Threaded workers for heavy computations
│   └── saveManager.js # Persistent storage (JSON/encrypted)
├── frontend/          # Renderer process: UI with React/Redux
│   ├── src/
│   │   ├── components/ # Reusable UI elements (e.g., BotPanel, MapViewer)
│   │   ├── pages/      # Route-based views (e.g., Dashboard, ScriptEditor)
│   │   ├── hooks/      # Custom React hooks (e.g., useBotState, useOcr)
│   │   ├── store/      # Redux setup: actions, reducers, store config
│   │   └── assets/     # Images, fonts, icons
│   ├── index.html     # Renderer entry
│   └── index.js       # React root rendering
├── nativeModules/     # C++ N-API modules for performance-critical ops
│   ├── findHealthBars/ # Detects HP/mana bars via pixel matching
│   ├── findTarget/    # Identifies combat targets by color/shape
│   ├── fontOcr/       # OCR for in-game text (e.g., chat, stats)
│   ├── keypress/      # Simulates keyboard events via X11
│   ├── mouseController/ # Precise mouse movements/clicks
│   ├── minimapMatcher/ # Pattern matching for minimap navigation
│   ├── pathfinder/    # A* pathfinding on minimap data
│   ├── x11RegionCapture/ # Efficient screen region grabs
│   └── windowInfo/    # Queries *Tibia* window position/size
├── lua_scripts/       # User scripts: Bot logic in Lua
│   ├── examples/      # Sample bots (e.g., auto-heal.lua, cavebot.lua)
│   └── runtime.js     # WasmOon integration for safe execution
├── webpack.config.cjs # Bundling configs for main/renderer
├── package.json       # Dependencies, scripts
├── AGENTS.md          # Build commands, style guide (internal)
├── automaton.md       # This documentation file
└── dist/              # Build output (generated)
```

### High-Level Data Flow
1. **Initialization**: Main process (`electron/main.js`) creates the Electron window, loads the React renderer, and initializes native modules via `require('path/to/module')`.
2. **IPC Communication**: Renderer sends commands (e.g., "startBot") via `ipcRenderer.invoke` to main, which handles them in `ipcHandlers.js` and responds with data (e.g., screen analysis results).
3. **Screen Analysis Loop**: `screenMonitor.js` uses `x11RegionCapture` to grab *Tibia* window regions at ~30 FPS, feeding data to modules like `findHealthBars` or `minimapMatcher`.
4. **Decision Making**: Analyzed data is passed to Lua scripts via `runtime.js`, which execute bot logic (e.g., "if HP < 50%, use potion").
5. **Action Execution**: Lua outputs actions to `inputController.js`, which uses `keypress` and `mouseController` for inputs.
6. **UI Updates**: Results stream back to Redux store, triggering React re-renders for real-time dashboards.
7. **Persistence**: `saveManager.js` handles config/scripts in encrypted JSON files.

### Tech Stack Details
- **Electron**: v25+ for desktop app shell. Uses `BrowserWindow` with nodeIntegration disabled for security.
- **React + Redux**: Functional components with hooks; Redux Toolkit for state (slices for bots, UI, hardware).
- **Webpack**: Separate configs for main (Node.js target) and renderer (web target). Outputs to `dist/`.
- **Native Modules**: Node.js N-API (C++ bindings). Compiled with `node-gyp`. Dependencies: libx11-dev, g++.
- **Lua Integration**: wasmoon (WebAssembly Lua VM) for sandboxed execution, preventing crashes from bad scripts.
- **Other Libs**: Lodash for utils, PixiJS for map rendering, Tesseract.js (fallback OCR, but native preferred).

## How It Works in Detail

### Bootstrapping and Runtime
- **Launch**: `npm start` runs production build (`dist/main.js`), creating a transparent overlay window on the *Tibia* client.
- **Window Management**: `windowInfo` module detects *Tibia* process (via `xdotool` or X11 queries) and positions the app accordingly. Supports multi-monitor by querying X11 screens.
- **Event Loop**: Main process runs a 33ms tick loop (30 FPS):
  1. Capture region (e.g., minimap: 200x200 pixels).
  2. Process with native modules (e.g., template matching for landmarks).
  3. Serialize data to Lua (JSON-like via wasmoon API).
  4. Execute script step, collect actions.
  5. Queue inputs with anti-detection delays (random 50-200ms jitter).
  6. Update UI via IPC.

### Key Features Breakdown

#### 1. Screen Capture and Computer Vision
- **x11RegionCapture**: Uses X11's `XGetImage` for low-overhead grabs (faster than full screenshots). Captures specific regions (e.g., health bar: top-left 300x50 pixels) to minimize data (RGBA buffers).
- **findHealthBars**: Pixel-based detection: Scans for green/red gradients (HP/mana colors). Thresholds: >80% match confidence. Outputs: { hp: 75, mana: 40 }.
- **findTarget**: Shape detection via contour finding (OpenCV-inspired in C++). Matches skull icons or creature outlines. Handles lighting variations with histogram equalization.
- **minimapMatcher**: Template matching (normalized cross-correlation) against pre-loaded map templates (PNG assets). Detects player position as (x, y) on 640x480 minimap.
- **fontOcr**: Custom bitmap font recognizer for *Tibia*'s fixed-width font. Maps pixel patterns to chars (e.g., inventory counts). Fallback to Tesseract for chat.

#### 2. Input Simulation
- **keypress**: X11 `XTest` extension for fake key events. Supports modifiers (Ctrl+1 for spells). Rate-limited to avoid spam detection.
- **mouseController**: Absolute positioning via `XWarpPointer`. Clicks with `XTestFakeButtonEvent`. Includes human-like curves (Bezier interpolation for movements).

#### 3. Pathfinding and Navigation
- **pathfinder**: A* algorithm on a grid representation of the minimap (32x32 cells). Nodes: walkable (green/gray) vs. obstacles (black/water). Heuristics: Manhattan distance. Integrates with `minimapMatcher` for real-time updates.
- **Usage**: Lua script requests path to waypoint; module returns sequence of mouse clicks on minimap.

#### 4. Scripting Interface
- **Lua Runtime**: Scripts run in isolated wasmoon instances (one per bot). Exposed APIs: `getHealth()`, `moveTo(x,y)`, `castSpell('exura')`.
- **Example Script** (auto-heal.lua):
  ```lua
  function onTick()
      local hp = getHealth()
      if hp < 80 then
          useItem('hotkey1')  -- Potion
      end
      if findTarget() then
          attack('target')
      end
  end
  ```
- **Safety**: Scripts timeout after 5s; no direct file/network access.

#### 5. Frontend Interactions
- **Dashboard Page**: Real-time gauges for HP/mana, minimap overlay (PixiJS canvas), script logs.
- **Script Editor**: Monaco Editor integration for Lua editing, with syntax highlighting and auto-complete for APIs.
- **Redux State**: Centralized store for bot configs (e.g., { active: true, waypoints: [...] }), synced via IPC.

### Build and Deployment
- **Development**: `npm run dev` – Hot-reload renderer, Electron inspect on 5858.
- **Production**: `npm run build` – Webpack bundles to `dist/`. `npm start` launches.
- **Packaging**: `npm run make` – Uses electron-builder for Linux AppImage (portable executable).
- **Linting/Formatting**: `npm run lint` enforces ESLint + Prettier.

## Challenges Faced

### 1. Performance and Latency
- **Issue**: *Tibia* requires sub-100ms response times for combat; full-screen captures spike CPU to 50%+.
- **Impact**: Dropped frames lead to missed heals or poor targeting.
- **Mitigations**: Region-specific captures (e.g., only 10% of screen); native C++ for CV (10x faster than JS libs like Jimp); worker threads offload analysis.

### 2. Game Detection and Anti-Bot Measures
- **Issue**: *Tibia* detects bots via pattern inputs (perfect timing) or anomalous behaviors (24/7 uptime).
- **Impact**: Frequent bans during testing.
- **Mitigations**: Random delays/jitters in inputs; simulate human errors (occasional misclicks); session limits (auto-pause after 2h). No server-side evasion (e.g., proxying)—focus on client-side realism.

### 3. Cross-Platform Compatibility
- **Issue**: Native modules rely on X11; Windows/macOS need WinAPI/CGEvent.
- **Impact**: Linux-only currently; portability requires full rewrites.
- **Mitigations**: Abstract input/capture in JS wrappers; plan for robotjs as fallback (pure JS, slower).

### 4. Accuracy in Variable Conditions
- **Issue**: Lighting changes, UI scaling, or mods alter pixel patterns, breaking CV.
- **Impact**: False positives in targeting (e.g., attacking NPCs).
- **Mitigations**: Adaptive thresholds (e.g., dynamic color calibration); multiple templates per asset; user-configurable regions.

### 5. Security and Stability
- **Issue**: Lua scripts could crash the app or access system files; Electron's Chromium exposes vulnerabilities.
- **Impact**: Data loss or exploits in shared environments.
- **Mitigations**: Sandboxed Lua VM; encrypted saves (crypto-js); nodeIntegration=false, contextIsolation=true.

### 6. Development Complexity
- **Issue**: Bridging JS/C++/Lua increases debug time; N-API bindings error-prone.
- **Impact**: Bugs in native code hard to trace.
- **Mitigations**: Extensive logging (winston); unit tests for modules (Jest for JS, manual for C++); modular design for isolated testing.

## Optimization Tactics Used

### 1. Performance Optimizations
- **Native Code**: Offload CV/input to C++ (e.g., `findHealthBars` processes 300x50 image in <5ms vs. 50ms in JS).
- **Efficient Data Handling**: Use Uint8Array buffers for images; avoid JSON serialization where possible (direct IPC binary transfer).
- **Throttling**: Adaptive FPS: 60Hz for inputs, 10Hz for analysis during idle.
- **Memory Management**: Pool capture buffers; garbage collect workers periodically. Target <200MB RAM usage.
- **GPU Acceleration**: Potential future: OpenCL for CV matching (currently CPU-only).

### 2. Anti-Detection Optimizations
- **Humanization**: Bezier curves for mouse paths; variable keypress durations (80-120ms).
- **Randomization**: Seed RNG per session for delays/paths; occasional "idle" actions (e.g., random chat).
- **Low Profile**: No overlays on game window; run as background process.

### 3. Build and Runtime Optimizations
- **Webpack**: Tree-shaking, code-splitting for renderer (lazy-load pages); minification reduces bundle to ~50MB.
- **Caching**: Pre-compile native modules; cache map templates in memory.
- **Profiling**: Use Electron's devtools + Chrome Tracing for bottlenecks (e.g., IPC latency <1ms target).

### 4. Scalability Tactics
- **Modular Bots**: Run multiple Lua instances in parallel (up to 4 workers) for multi-character support.
- **Config-Driven**: JSON configs for regions/colors allow quick adaptations without recompiles.

## Code Style and Best Practices

Adhere to guidelines in `AGENTS.md`:
- **Formatting**: Prettier (80 chars, single quotes, trailing commas, 2 spaces).
- **Linting**: ESLint (Babel, React, Prettier plugins). No TypeScript—stick to JS/JSX/MJS.
- **Components**: Arrow functions, e.g., `const BotPanel = () => <div>...</div>;`.
- **Imports**: ES6; native: `import { findHealth } from 'file:///path/to/build/Release/findHealthBars.node';`.
- **Naming**: camelCase vars/functions, PascalCase components.
- **Error Handling**: Try-catch everywhere; log with levels (debug/info/error).
- **Testing**: Jest for unit (80% coverage target); manual integration tests for natives.
- **Commits**: Semantic (feat:, fix:, docs:); branches: feature/xxx.

## Future Considerations and Roadmap

### Planned Enhancements
- **AI Integration**: ML models (TensorFlow.js) for better target recognition (e.g., classify creature types).
- **Plugin System**: NPM-like for community Lua libs.
- **Windows Support**: Port natives using node-ffi or rewrite in Rust (via neon).
- **Analytics**: Built-in telemetry for bot performance (opt-in, local-only).
- **VR/AR Extensions**: Overlay AR paths on physical screens (experimental).

### Potential Risks
- **Legal**: Evolving game ToS; monitor CipSoft updates.
- **Tech Debt**: Native modules need ABI stability checks for Node upgrades.
- **Community**: Open-source? (Currently private; weigh ban risks.)

### Debugging Tips for LLMs/Developers
- **Start Here**: Run `npm run dev`; inspect main/renderer separately.
- **Logs**: Check `~/.automaton/logs/`; enable verbose in `electron/main.js`.
- **Test Natives**: `node testNative.js` in module dirs.
- **Common Pitfalls**: X11 permissions (run as non-root); mismatched *Tibia* resolution.
- **Query Context**: When asking LLMs, reference this doc + specific file (e.g., "In electron/screenMonitor.js, optimize the capture loop").

This documentation is versioned with the project—update it after major changes. For questions, consult `AGENTS.md` or the codebase directly.

Last Updated: [Insert Date]