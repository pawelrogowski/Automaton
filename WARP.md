# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

**Automaton** is an Electron-based automation tool for the MMORPG Tibia. It features a React frontend with Redux state management, an Electron backend with multi-threaded workers, and high-performance C++ native modules for screen capture, OCR, pathfinding, and input control.

The application uses a sophisticated architecture with SharedArrayBuffer (SAB) for zero-copy inter-worker communication, enabling real-time bot features like automated healing, targeting, cave exploration (cavebot), and Lua scripting.

---

## Common Commands

### Development
```fish
# Install dependencies (includes native module compilation)
npm install

# Development build with debugger (Chrome DevTools on localhost:5858)
npm run dev

# Production build (webpack only, no app start)
npm run build

# Production mode (build + run)
npm start

# Lint JavaScript/JSX files
npm run lint
```

### Building & Packaging
```fish
# Clean build and create distributable (Linux AppImage)
npm run make

# Just create electron-builder package (no clean)
npm run package

# Rebuild native modules for current Electron version
npm run rebuild
```

### Native Modules
Native modules are automatically compiled on `npm install` via `postinstall` hook. To rebuild individually:

```fish
# Navigate to specific module
cd nativeModules/findSequences
node-gyp rebuild
```

**Available native modules:**
- `findSequences` - High-performance pixel sequence detection
- `findHealthBars` - Health bar recognition (SIMD-optimized)
- `findTarget` - Target detection
- `fontOcr` - Custom bitmap font OCR
- `keypress` - X11 keyboard input simulation
- `mouseController` - X11 mouse control with human-like movements
- `minimapMatcher` - Minimap position matching
- `pathfinder` - A* pathfinding with obstacle avoidance
- `windowInfo` - X11 window enumeration
- `x11RegionCapture` - Fast X11 screen region capture

### Utility Scripts
```fish
# Generate walkable tile data from Tibia maps
npm run generate-walkable

# Preprocess minimap images for fast matching
npm run preprocess-minimaps

# Combine Lua scripts into single file
npm run combine-scripts
```

---

## Architecture Overview

### High-Level Structure

**Automaton** follows a multi-process, multi-threaded architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Process (Electron)                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Redux Store (Backend)  ←──→  IPC  ←──→  Frontend    │  │
│  │  (electron/store.js)              (React + Redux)    │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                 │
│                   WorkerManager (workerManager.js)          │
│                            │                                 │
│          ┌─────────────────┴────────────────────┐          │
│          │   SharedArrayBuffer (SABState)        │          │
│          │   Zero-copy inter-worker state        │          │
│          └──────────────────┬────────────────────┘          │
│                             │                                │
│    ┌────────────────────────┼─────────────────────────┐    │
│    │     Worker Threads (worker_threads)             │    │
│    ├─────────────────────────────────────────────────┤    │
│    │ • captureWorker     - Screen capture @ 60Hz     │    │
│    │ • regionMonitor     - Region coordinate detect  │    │
│    │ • screenMonitor     - HP/Mana/Status detection  │    │
│    │ • minimapMonitor    - Player position tracking  │    │
│    │ • ocrWorker         - Text recognition          │    │
│    │ • creatureMonitor   - Creature tracking         │    │
│    │ • targetingWorker   - Auto-targeting logic      │    │
│    │ • cavebotWorker     - Waypoint navigation       │    │
│    │ • pathfinderWorker  - A* pathfinding            │    │
│    │ • inputOrchestrator - Input action priority mgr │    │
│    │ • luaScriptWorker(s)- User Lua script executors│    │
│    └─────────────────────────────────────────────────┘    │
│                             │                                │
│              ┌──────────────┴──────────────┐               │
│              │   Native Modules (C++)       │               │
│              │   - x11RegionCapture         │               │
│              │   - findSequences (SIMD)     │               │
│              │   - fontOcr                  │               │
│              │   - keypress/mouseController │               │
│              │   - pathfinder               │               │
│              └──────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

#### 1. SharedArrayBuffer State Management
All workers communicate via a unified `SABState` (SharedArrayBuffer State) system located in `electron/workers/sabState/`:

- **Zero-copy reads**: Workers poll SAB @ ~20Hz instead of message passing
- **Optimistic concurrency**: Version counters prevent torn reads
- **Explicit control flow**: No callbacks, just synchronous reads in worker loops
- **Schema-driven**: All properties defined in `sabState/schema.js`

**Key properties:**
- `playerPos` - Minimap coordinates (x, y, z)
- `creatures` - Array of detected creatures with positions, HP, reachability
- `battleList` - In-game battle list entries
- `target` - Current targeting data
- `cavebotPathData` / `targetingPathData` - Pathfinding results
- Config properties - Redux state pushed to SAB for worker consumption

#### 2. Redux State Synchronization
The app maintains **two Redux stores**:

- **Backend Store** (`electron/store.js`): Source of truth, runs in main process
- **Frontend Store** (`frontend/redux/store.js`): UI-only, receives batched updates via IPC

**Update flow:**
1. Frontend dispatches action → IPC middleware batches actions (50ms window)
2. Backend receives batch → applies to backend store
3. Backend store changes → WorkerManager debounces (16ms) → pushes to SAB
4. Backend sends state updates back to frontend via IPC
5. Frontend store updates → React re-renders

**State slices:** `global`, `gameState`, `rules`, `lua`, `cavebot`, `targeting`, `statusMessages`, `regionCoordinates`, `ocr`, `uiValues`, `battleList`, `pathfinder`

#### 3. Worker Lifecycle Management
`WorkerManager` (`electron/workerManager.js`) handles:

- **Dynamic worker spawning**: Workers started/stopped based on config
- **State dependency tracking**: Each worker receives only required state slices
- **Graceful shutdown**: Workers receive `shutdown` message with 10s timeout
- **Automatic restart**: Failed workers restart with exponential backoff (max 5 attempts)
- **Lua script workers**: Dynamically created per active Lua script (UUID-based)

#### 4. Input Action Priority System
All input actions go through `inputOrchestrator` with priority levels:

```javascript
Priority (lower = higher priority):
0: userRule      (manual healing/mana rules)
1: movement      (cavebot waypoint walking)
2: looting       (picking up items)
3: script        (Lua scripts) ← CRITICAL: Must be 'script', not 'luaScript'
4: targeting     (attacking creatures)
5: hotkey        (spell/item usage)
10: default      (fallback priority)
100: mouseNoise  (randomized mouse movements - not in PRIORITY_MAP)
```

**Mouse noise pauses** for priorities 0-5 to prevent interference with critical actions.

#### 5. Lua Scripting Architecture
Lua scripts run in isolated workers using `wasmoon` (Lua 5.4 WASM):

- **Lua API**: 100+ functions exposed via `electron/workers/luaApi.js`
- **Sandboxed execution**: Each script runs in separate worker thread
- **Async/await support**: Lua callbacks for async operations (movement, clicks, etc.)
- **Priority integration**: All Lua input actions use `type: 'script'` with priority 2

**Common Lua functions:** `keyPress()`, `clickTile()`, `mapClick()`, `useItemOnSelf()`, `moveToPosition()`, `getPlayerPos()`, `getCreatures()`, `wait()`

#### 6. Native Module Integration
Native modules are Node.js addons (node-gyp) with N-API bindings:

- **SIMD optimization**: `findSequences` uses AVX2 for 4-8x speedup
- **Multi-threaded**: Some modules spawn C++ threads (e.g., pathfinder, findSequences)
- **Zero-copy buffers**: Direct SharedArrayBuffer access where possible
- **X11-specific**: All input/capture modules use X11 APIs (Linux-only currently)

---

## Development Guidelines

### Working with Workers

**Starting a new worker:**
1. Create worker file in `electron/workers/` (e.g., `myWorker.js`)
2. Add worker to `workerManager.js`:
   - Add to `DEFAULT_WORKER_CONFIG`
   - Add state dependencies to `WORKER_STATE_DEPENDENCIES`
   - Add region dependencies to `WORKER_REGION_DEPENDENCIES` (if using screen data)
3. Implement message handlers: `'initialize'`, `'state-update'`, `'shutdown'`
4. Use `sabState.get('propertyName')` for SAB reads
5. Post messages back: `parentPort.postMessage({ type: 'myEvent', data })`

**Worker communication:**
- **Worker → Manager**: `parentPort.postMessage()`
- **Manager → Worker**: `worker.postMessage()`
- **Worker ↔ Worker**: Use SAB properties or Control Channel
- **Worker → Redux**: Post `'state-change'` message with action

### Working with SharedArrayBuffer

**Reading from SAB:**
```javascript
import { SABState } from './sabState/index.js';

const sabState = new SABState(existingSAB);
const { data, version } = sabState.get('playerPos');
console.log(`Player at ${data.x}, ${data.y}, ${data.z}`);
```

**Writing to SAB:**
```javascript
sabState.set('playerPos', { x: 100, y: 200, z: 7 });
```

**Adding new SAB property:**
1. Add schema definition in `electron/workers/sabState/schema.js`
2. Update `LAYOUT` calculation in schema.js
3. Add to relevant `WORKER_STATE_DEPENDENCIES` in workerManager.js

### Working with Native Modules

**Modifying existing module:**
1. Edit C++ source in `nativeModules/<module>/src/`
2. Rebuild: `cd nativeModules/<module> && node-gyp rebuild`
3. Test in Electron context (Node.js version differs!)

**Creating new native module:**
1. Create directory: `nativeModules/myModule/`
2. Add `package.json`, `binding.gyp`, `src/myModule.cc`
3. Add to root `package.json` dependencies: `"my-module-native": "file:./nativeModules/myModule"`
4. Run `npm install`

### Working with Lua Scripts

**Testing Lua API functions:**
1. Open Lua Scripts page in app UI
2. Create test script with function calls
3. Enable script and observe logs in Console tab
4. Check `electron/workers/luaApi.js` for function definitions

**Adding new Lua API function:**
1. Add function to `electron/workers/luaApi.js`
2. Export in `exposedLuaFunctions` object
3. Add to `luaScriptProcessor.js` if needed for standalone scripts
4. Document in Lua API section of UI

### State Management Rules

**Frontend (React) changes:**
- Always dispatch Redux actions, never mutate state
- Use selectors from slice files for derived state
- Actions flow: Component → dispatch → IPC → Backend → SAB → Backend → IPC → Frontend

**Backend (Worker) changes:**
- Workers read from SAB, post `state-change` messages for Redux updates
- Never write to Redux directly from workers
- Use SABState for real-time worker-to-worker communication

### Debugging

**Worker debugging:**
```fish
# Dev mode enables inspector on port 5858 (main) and 9230+ (workers)
npm run dev

# Connect Chrome DevTools to:
# Main: chrome://inspect (default port)
# Workers: chrome://inspect or chrome-devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=127.0.0.1:9230
```

**Common issues:**
- **Worker not receiving state**: Check `WORKER_STATE_DEPENDENCIES` in workerManager.js
- **Lua actions ignored**: Verify `type: 'script'` (NOT `'luaScript'`) in luaApi.js
- **Native module crashes**: Rebuild with `npm run rebuild` after Electron updates
- **SAB torn reads**: Ensure version checking in `SABState.get()`

---

## Important Files

### Core System
- `electron/main.js` - Electron app entry, window management
- `electron/workerManager.js` - Worker lifecycle, state distribution (1300+ lines)
- `electron/store.js` - Backend Redux store
- `frontend/redux/store.js` - Frontend Redux store with IPC middleware
- `webpack.config.cjs` - Webpack build configuration

### Worker System
- `electron/workers/sabState/SABState.js` - SharedArrayBuffer manager class
- `electron/workers/sabState/schema.js` - SAB memory layout definitions
- `electron/workers/sharedConstants.js` - Constants shared across workers
- `electron/workers/inputOrchestrator.js` - Input action priority queue

### Key Workers
- `electron/workers/captureWorker.js` - X11 screen capture loop
- `electron/workers/creatureMonitor.js` - Creature detection & tracking (1000+ lines)
- `electron/workers/targetingWorker.js` - Auto-targeting FSM
- `electron/workers/cavebot/index.js` - Cavebot waypoint execution FSM
- `electron/workers/luaScriptWorker.js` - Lua script executor
- `electron/workers/luaApi.js` - Lua API function implementations (2000+ lines)

### Frontend
- `frontend/pages/Layout.js` - Main app layout with routing
- `frontend/pages/Healing.js` - Healing rules UI
- `frontend/pages/Targeting.js` - Targeting configuration UI
- `frontend/pages/Cavebot.js` - Cavebot waypoint editor UI
- `frontend/pages/LuaScripts.js` - Lua script management UI
- `frontend/redux/slices/` - Redux slice definitions

### Build & Utilities
- `scripts/preprocessMinimaps.js` - Minimap image preprocessing
- `scripts/generateWalkableData.js` - Tibia map walkability data generator
- `scripts/set-random-name.js` - Randomizes app name for obfuscation

---

## Known Issues & Gotchas

### CRITICAL: Lua API Action Type
**All Lua API input actions must use `type: 'script'`** (not `'luaScript'`).  
This was a critical bug fixed in October 2024. See `LUA_API_PRIORITY_FIX.md`.

If adding new Lua input actions, always use:
```javascript
postInputAction({
  type: 'script',  // ← MUST be 'script'
  action: { /* ... */ }
});
```

### SharedArrayBuffer Concurrency
When reading multiple SAB properties that must be consistent (e.g., creatures + playerPos), use `sabState.getMany(['creatures', 'playerPos'])` for atomic snapshot reads.

### Worker Restart Behavior
Workers automatically restart on crashes (max 5 attempts). If a worker is failing repeatedly:
1. Check console logs for error messages
2. Verify state dependencies are correct
3. Look for unhandled promise rejections in worker code

### Native Module Electron Version Mismatch
After updating Electron version, always run `npm run rebuild` to recompile native modules against the new V8 engine.

### Region Coordinates
`regionCoordinates` in Redux contains screen positions for UI elements (health bar, minimap, etc.). These are detected by `regionMonitor` worker on startup and must be valid before most workers can function.

---

## Testing Approach

This project has no automated test suite. Testing is manual:

1. **Feature testing**: Enable feature in UI, observe behavior in-game
2. **Worker testing**: Check console logs for worker messages
3. **Lua testing**: Write test scripts with logging, observe execution
4. **Native module testing**: Create minimal Node.js test scripts outside Electron

When making changes to workers or native modules, test with the actual Tibia client to verify correct behavior.

---

## Platform Support

**Current:** Linux only (X11-based screen capture and input control)  
**Future:** Windows support planned (requires replacing X11 native modules)

---

## Additional Resources

- `LUA_API_PRIORITY_FIX.md` - Critical bug fix documentation (October 2024)
- `LUA_UI_REDESIGN.md` - Lua scripting UI redesign notes
- `scripts/minimapDataInfo.md` - Minimap preprocessing documentation
- `electron/workers/bug.txt` - Historical bug tracking (legacy file)
