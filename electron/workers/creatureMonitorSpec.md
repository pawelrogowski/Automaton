# creatureMonitor Spec

This document defines the authoritative specification for the `creatureMonitor` worker at:

- ["creatureMonitor.js"](electron/workers/creatureMonitor.js)

It must be kept in lockstep with the implementation. Any behavioral change in `creatureMonitor.js` MUST be reflected here in the same commit.

This spec has two layers:

- CURRENT: Behavior implemented right now (Phase 3.1).
- TARGET STATE MODEL: The full set of state (inputs, internal state, outputs) the redesigned creatureMonitor will own. Implementation will grow toward this model incrementally.

---

## 1. Current Behavior (Phase 3.1: Dirty-Rect Gated Lists + Health Bars + Helpers)

At this phase:

- creatureMonitor:
  - Tracks:
    - Battle list entries (names + positions).
    - Player list names.
    - NPC list names.
    - Health bar tile positions for relevant entities.
  - Uses:
    - Dirty rects to gate when OCR/detection runs.
    - Helper utilities extracted into:
      - ["creatureMonitorUtils/helpers.js"](electron/workers/creatureMonitorUtils/helpers.js)
  - Ensures:
    - Outputs are deduplicated (no redundant Redux/SAB updates).
    - State is cleaned up correctly when things disappear.

### 1.1 Inputs

Unchanged from previous phases, with emphasis on dirty-rect usage:

- workerData:
  - `sharedData.imageSAB` (required)
  - `unifiedSAB` (required)
- Messages:
  - Untyped initial state → init + optional regionCoordinates.
  - `state_full_sync` / `state_diff` / `regions_snapshot` → maintain `regionCoordinates`.
  - `frame-update`:
    - Provides `dirtyRects` used for gating all OCR/detection.
  - `shutdown`:
    - Marks worker as shutting down.
- SAB:
  - `playerPos`:
    - Used to exclude player tile from healthBars.

### 1.2 Internal State (Phase 3.1)

- Lifecycle:
  - `isInitialized`, `isShuttingDown`
- Frame:
  - `frameCounter`
  - `frameUpdateManager` (accumulates dirtyRects; per-frame we use the passed rects)
- Regions:
  - `regionCoordinates` (authoritative snapshot)
- Player:
  - `lastPlayerPos`
- Lists:
  - `lastBattleListEntries`
  - `lastPlayerNames`
  - `lastNpcNames`
- Health bars:
  - `lastHealthBarTiles`
- Dedup cache:
  - `lastPosted`:
    - `battleListEntries`
    - `playerNames`
    - `npcNames`
    - `healthBars`

Implementation detail:

- Orchestration functions in creatureMonitor.js are thin and use helpers:
  - Initialization, region updates, SAB reads, per-frame coordination.
- Shared mechanics are delegated to helpers in helpers.js.

### 1.3 Helper Utilities (Current Usage)

Defined in:

- ["creatureMonitorUtils/helpers.js"](electron/workers/creatureMonitorUtils/helpers.js)

Used by creatureMonitor.js as follows:

- `jsonEqualsAndCache(cache, key, value)`:
  - Purpose:
    - Deduplicate outbound updates.
  - Usage:
    - Before emitting:
      - `battleList/setBattleListEntries`
      - `uiValues/setPlayers`
      - `uiValues/setNpcs`
      - `targeting/setHealthBars`
    - If unchanged:
      - No emit → no reducer version bump.

- `rectsIntersect(a, b)`:
  - Purpose:
    - Primitive for region/dirtyRect intersection.
  - Usage:
    - Internally in helpers; available if needed at orchestration level.

- `shouldRefreshRegionForDirtyRects(region, dirtyRects)`:
  - Purpose:
    - Decide if a given region needs reprocessing this frame.
  - Usage:
    - Battle list OCR:
      - Only if `battleList.entries` intersects dirtyRects.
    - Player list OCR:
      - Only if `playerList` intersects dirtyRects.
    - NPC list OCR:
      - Only if `npcList` intersects dirtyRects.
    - Health bars:
      - Only if `gameWorld` intersects dirtyRects (and gating allows).

- `projectHealthBarToTileCoords(hb, gameWorld, tileSize, playerPos, getGameCoordinatesFromScreenFn)`:
  - Purpose:
    - Convert a raw health bar detection to tile coordinates.
  - Usage:
    - For each `hb` from `findHealthBars`:
      - Compute sample y = `hb.y + 14 + tileSize.height / 2`.
      - Call helper with `getGameCoordinatesFromScreen`.
      - Exclude tiles matching `playerPos`.
      - Build `healthBarTiles` array.

All these helpers are arrow functions and side-effect free.

### 1.4 Dirty-Rect Gated List Behavior

Per frame (`frame-update`):

1. Battle list:
   - If `regions.battleList.children.entries` intersects dirtyRects:
     - Re-OCR using font-ocr.
     - Normalize names.
     - Emit `battleList/setBattleListEntries` only if changed.
     - Emit `battleList/updateLastSeenMs` if non-empty.
   - Else:
     - Keep lastBattleListEntries.

2. Player list:
   - If `regions.playerList` intersects dirtyRects:
     - Re-run `processPlayerList`.
   - Else:
     - Keep lastPlayerNames.

3. NPC list:
   - If `regions.npcList` intersects dirtyRects:
     - Re-run `processNpcList`.
   - Else:
     - Keep lastNpcNames.

4. Emission:
   - `uiValues/setPlayers` and `uiValues/setNpcs` only on change.
   - `updateLastSeen*Ms` only when corresponding list non-empty and changed.

Because dirty rects are reliable and catch all visual changes:

- OCR re-runs exactly when needed.
- Lists are cleared correctly when UI regions are cleared.

### 1.5 Dirty-Rect Gated HealthBar Behavior

Gating conditions:

- `shouldScanHealthBars`:
  - True if:
    - `battleListEntries.length > 0`
    - OR `playerNames.length > 0`
- `shouldRefreshHealthBars`:
  - True if:
    - `shouldScanHealthBars` is true
    - AND `gameWorld` intersects dirtyRects.

Behavior:

- If `!shouldScanHealthBars`:
  - If `lastHealthBarTiles` non-empty:
    - Emit `healthBars = []` once (SAB + Redux).
  - Else:
    - No-op.

- If `shouldScanHealthBars` but `!shouldRefreshHealthBars`:
  - No rescan; retain previous healthBars (dedup ensures no noise).

- If both true:
  - Call `findHealthBars.findHealthBars(sharedBufferView, gameWorld)`.
  - For each hb:
    - Use `projectHealthBarToTileCoords(...)`.
    - Exclude player tile.
  - Emit via `emitHealthBars` (SAB + `targeting/setHealthBars`) only if changed.

This ensures:

- We “track all health bars” when BL or players indicate they can exist.
- We scan only when actual screen content changed in gameWorld (dirtyRects-driven).
- We clear healthBars reliably when lists empty out or bars disappear.

### 1.6 Logging and Errors

Per frame:

- Logs:
  - `[CreatureMonitor] frame=<frameCounter> dirtyRectsInMsg=<count>`

On initialization:

- Logs initialization phase label.

On shutdown:

- Logs shutdown notice.

On errors:

- Clear prefixed logs:
  - `[CreatureMonitor] Player list OCR error: ...`
  - `[CreatureMonitor] NPC list OCR error: ...`
  - `[CreatureMonitor] Battle list OCR error: ...`
  - `[CreatureMonitor] findHealthBars error: ...`
  - `[CreatureMonitor] Failed to write healthBars to SAB: ...`
  - `[CreatureMonitor] Error in phase 3.1 message handler: ...`

---

## 2. Target State Model (Future Phases)

Unchanged at high level:

- Describes the eventual architecture with:
  - Stable creature identities.
  - Nameplate ↔ BL ↔ targeting integration.
  - Reachability and adjacency.
  - Unified target logic.
  - More advanced caching and correctness guarantees.

As we implement these, we will:

- Move details from this Target section into Current Behavior.
- Keep:
  - ["creatureMonitor.js"](electron/workers/creatureMonitor.js)
  - ["creatureMonitorUtils/helpers.js"](electron/workers/creatureMonitorUtils/helpers.js)
  - ["creatureMonitorImplementationRules.md"](electron/workers/creatureMonitorImplementationRules.md)
  - This spec
- In strict lockstep.

At this moment:

- Section 1 accurately reflects Phase 3.1:
  - Dirty-rect gated BL/Player/NPC OCR.
  - Dirty-rect + list gated healthBars scanning and clearing.
  - Helper-based implementation with descriptive arrow functions.
- Section 2 remains the roadmap for the complete creatureMonitor.
