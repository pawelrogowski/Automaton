# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Automaton is an Electron-based automation tool for the game Tibia, featuring a sophisticated multi-worker architecture with native C++ modules for performance-critical operations. The application combines React frontend with Node.js backend, utilizing Redux for state management and SharedArrayBuffer for efficient inter-process communication.

## Essential Commands

### Development & Building
```bash
# Start development build with debug
npm run dev

# Production build and start
npm run start

# Build for production
npm run build

# Package for distribution
npm run package

# Complete build process (clean, pre-build, build, package)
npm run make

# Install native dependencies
npm run rebuild
```

### Code Quality
```bash
# Lint all JavaScript files
npm run lint

# Format code with Prettier
npx prettier --write .
```

### Specialized Scripts
```bash
# Generate walkable data for pathfinding
npm run generate-walkable

# Preprocess minimap resources
npm run preprocess-minimaps

# Combine scripts for analysis
npm run combine-scripts
```

### Native Module Development
All native modules are in `nativeModules/` directory. Each contains binding.gyp and requires rebuilding after changes:
```bash
# Rebuild specific native module (example)
cd nativeModules/findHealthBars && node-gyp rebuild

# Rebuild all native modules
npm run rebuild
```

## Architecture Overview

### Multi-Process Structure
- **Main Process** (`electron/main.js`): Application lifecycle, window management, worker coordination
- **Renderer Process** (`frontend/index.js`): React-based UI with Redux state management  
- **Worker Threads** (`electron/workers/`): Specialized workers for different automation tasks
- **Native Modules** (`nativeModules/`): C++ addons for performance-critical operations

### Core Workers
- `captureWorker`: Screen capture and SharedArrayBuffer updates
- `screenMonitor`: Health/mana/status extraction via OCR
- `minimapMonitor`: Player position tracking and navigation
- `creatureMonitor`: Battle list and creature detection
- `cavebotWorker`: Automated movement and actions
- `targetingWorker`: Combat targeting logic
- `luaScriptWorker`: User script execution with comprehensive API
- `inputOrchestrator`: Centralized keyboard/mouse input management
- `pathfinderWorker`: A* pathfinding with obstacle avoidance

### Communication Architecture
- **IPC**: Main ↔ Renderer communication via `ipcListeners.js`
- **SharedArrayBuffer**: High-performance data sharing between workers
- **Redux Store**: Centralized state with batched updates via `setGlobalState.js`
- **Worker Messages**: Event-driven communication through `workerManager.js`

### State Management
State is divided into specialized slices:
- `global`: Application-wide settings and bot status
- `gameState`: Player stats, position, online status
- `targeting`: Combat targeting configuration
- `cavebot`: Waypoint navigation and automation
- `battleList`: Creature tracking and combat data
- `lua`: Script execution state and variables
- `ocr`: Text recognition regions and results
- `regionCoordinates`: Screen region definitions for monitoring

## Key Configuration Files

### Build Configuration
- `webpack.config.cjs`: Frontend bundling with React, handles .node files and Monaco editor
- `package.json`: Dependencies include custom native modules via file: references
- `.babelrc`: ES6+ and React transformation
- `.eslintrc.json`: Code quality rules with React and Prettier integration

### Application Structure
- `electron/createMainWindow.js`: Window management, system tray, application menu
- `electron/workerManager.js`: Worker lifecycle, SharedArrayBuffer management, state synchronization
- `electron/store.js`: Redux store configuration with combined reducers
- `electron/saveManager.js`: Persistent state management with schema-driven serialization

## Lua Scripting System

Automaton includes a comprehensive Lua API for user scripting:

### Global State Variables (read-only, prefixed with $)
- Player vitals: `$hppc`, `$mppc`, `$cap`, `$stamina`, `$level`
- Position: `$pos` (table with x,y,z), `$target` (current target info)
- Game state: `$isOnline`, `$characterName`, `$battleList`, `$players`
- Bot state: `$cavebot`, `$targeting`, `$healing`, `$scripts`

### Key API Functions
- **Input**: `keyPress()`, `typeText()`, `clickTile()`, `drag()`
- **Movement**: `getDistanceTo()`, `isLocation()`, `isTileReachable()`
- **Detection**: `caround()`, `paround()`, `maround()`, `canUse()`
- **Utility**: `wait()`, `alert()`, `print()`, `log()`

Scripts run in isolated workers with access to full Redux state and can interact with all game systems.

## Native Modules

Performance-critical operations are handled by C++ addons:

- `findHealthBars`: Health/mana bar detection
- `findSequences`: Pattern matching for screen elements  
- `findTarget`: Creature detection and tracking
- `fontOcr`: Text recognition from game elements
- `keypress`: Low-level keyboard input simulation
- `minimapMatcher`: Minimap position matching
- `mouseController`: Precise mouse control
- `pathfinder`: A* pathfinding algorithm
- `windowInfo`: System window management
- `x11RegionCapture`: Linux screen capture optimization

Each module requires `node-addon-api` and follows Node.js C++ addon patterns.

## Development Notes

### Worker State Dependencies
Workers receive selective state updates based on `WORKER_STATE_DEPENDENCIES` in `workerManager.js`. This optimization prevents unnecessary data transfer and improves performance.

### SharedArrayBuffer Usage
Large data structures (screen captures, battle lists, pathfinding data) are shared via SharedArrayBuffer with defined sizes in `sharedConstants.js`.

### Error Handling
Workers implement graceful restart mechanisms with cooldown periods. The `workerManager` tracks restart attempts and prevents infinite restart loops.

### Security
- Hardware ID generation for licensing (`hardwareId.js`)
- Sandboxed renderer process with limited API exposure via `preload.js`
- Native modules for secure system integration

### Performance Optimizations
- Batched state updates to prevent IPC flooding
- Debounced worker communications (16ms intervals)
- Selective screen region monitoring based on worker interests
- Pre-calculated worker payloads with caching

## Testing & Debugging

- Workers support Node.js inspector protocol (ports 9230+)
- Comprehensive logging system with configurable levels
- Debug builds include source maps and inspection capabilities
- Lua scripts include dedicated testing framework in `docs/lua_api_test.lua`