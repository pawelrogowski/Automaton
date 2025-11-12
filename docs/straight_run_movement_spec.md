# Straight-Line Key-Hold Walking Specification

## 2) Goals and Constraints

- Existing movement remains the default and authoritative behavior.
- Straight-run is an optional optimization used only for stable straight segments (length ≥ 3 tiles).
- All failure modes unconditionally revert to the existing single-step movement behavior.
- Centralized ownership of movement key holds lives exclusively inside the movement state machine in [electron/workers/inputOrchestrator.js](electron/workers/inputOrchestrator.js:1).
- Workers (Cavebot, Targeting, others) express movement intents via IPC to the movement orchestrator; they never perform raw movement keyDown/keyUp directly for straight-runs.
- Design is deterministic, bounded, and safe:
  - No stuck movement keys.
  - Clear precedence rules between workers.
  - F1–F12 usage is fully compatible and never breaks straight-run.

## 3) Affected Components

- [electron/workers/inputOrchestrator.js](electron/workers/inputOrchestrator.js:1)
  - Hosts the central movement-key state machine.
  - Owns all keyDown/keyUp for movement keys when a straight-run is active.
  - Exposes IPC methods for movement intents (startStraightRun, stopStraightRun, singleStep).
- [electron/workers/cavebot/actionHandlers.js](electron/workers/cavebot/actionHandlers.js:50)
  - Detects straight-run opportunities along cavebot paths.
  - Issues movementOrchestrator intents instead of direct per-tile movement when appropriate.
- [electron/workers/cavebot/fsm.js](electron/workers/cavebot/fsm.js:211)
  - Integrates straight-run logic into the WALKING / movement-related states.
  - Maintains cavebot-level straightRun tracking and termination conditions.
- [electron/workers/cavebot/index.js](electron/workers/cavebot/index.js:29)
  - Wires IPC between Cavebot worker and movementOrchestrator.
  - Ensures controlState-based ownership rules and clean handover.
- [electron/workers/targetingWorker.js](electron/workers/targetingWorker.js:1)
  - Coordinates Targeting controlState and routing of movement intents.
  - Ensures targeting moves use movementOrchestrator (step-wise and straight-run).
- [electron/workers/targeting/targetingLogic.js](electron/workers/targeting/targetingLogic.js:365)
  - Detects straight segments toward current target.
  - Manages Targeting-specific straightRun lifecycle and cancels aggressively when conditions change.

## 4) Central Movement-Key State Machine (inputOrchestrator)

### Key Sets

- movementKeys:
  - { q, w, e, a, s, d, z, x, c }
  - Includes straight and diagonal movement directions.
- functionKeys:
  - { F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12 }

### activeMovement Structure

A single authoritative structure maintained inside [electron/workers/inputOrchestrator.js](electron/workers/inputOrchestrator.js:1):

- activeMovement:
  - key: movement key currently held for straight-run (one of movementKeys).
  - source: textual identifier of the owner (e.g. 'CAVEBOT', 'TARGETING').
  - mode: 'straightRun' (reserved for future movement modes if needed).
  - segmentId: unique identifier for the logical straight segment (string/number).
  - maxTiles: maximum tiles intended to be traversed while holding the key.
  - targetEnd: tile coordinate of the intended final tile of the segment.
  - penultimate: tile coordinate of the second-to-last tile (for early stop / validation).
  - startedAt: timestamp when keyDown was issued.
  - lastProgressAt: timestamp of last confirmed movement progress.
  - timeoutMs: configured max duration with no progress before forced cancel.
  - deadlineAt: absolute timestamp when the run must be forcefully terminated.

### Invariants

- heldKeys for movement:
  - At most one movement key from movementKeys is ever held down at a time.
  - Only the movement state machine in this orchestrator issues keyDown/keyUp for movement keys during a straightRun.
  - When no activeMovement is set, there must be no movementKeys left held down by the orchestrator.

### Behaviors

#### startStraightRun

- IPC method: startStraightRun(dirKey, segmentId, maxTiles, timeoutMs, source).
- Preconditions:
  - dirKey ∈ movementKeys.
  - segmentId is unique per segment from the caller perspective.
  - maxTiles ≥ 3.
  - timeoutMs > 0 (bounded).
- Semantics:
  - If no activeMovement:
    - Set activeMovement with provided parameters.
    - Issue keyDown(dirKey) if not already held.
  - If activeMovement exists with the same segmentId and same dirKey:
    - Treat as a refresh:
      - Update maxTiles, timeoutMs, deadlineAt, targetEnd/penultimate if provided.
      - Do not issue duplicate keyDown.
  - If activeMovement exists with different segmentId or different dirKey:
    - The new request overrides the existing run:
      - Issue keyUp for current activeMovement.key (if held).
      - Replace activeMovement with new values.
      - Issue keyDown(dirKey).
- Authority:
  - The orchestrator is the single owner of the movement key during straight-run.
  - Workers do not issue raw movement keyDown/keyUp once they use straight-run.

#### stopStraightRun

- IPC method: stopStraightRun(segmentId, reason).
- Semantics:
  - If activeMovement is null:
    - No-op (idempotent).
  - If activeMovement.segmentId === segmentId:
    - Issue keyUp(activeMovement.key) if held.
    - Clear activeMovement.
  - If activeMovement.segmentId !== segmentId:
    - Ignore request (protection against stale cancellations from previous segments).
- Idempotency:
  - Multiple calls with same segmentId are safe.
  - Ensures no unintended cancellation of a newer, different run.

#### singleStep

- IPC method: singleStep(dirKey, source).
- Semantics:
  - If there is no activeMovement:
    - Forward as a normal, existing single-step behavior:
      - Issue discrete keyDown/KeyUp or existing queued action as currently implemented.
  - If activeMovement exists:
    - If dirKey === activeMovement.key:
      - Treat as compatible: may be ignored or mapped to a no-op, since key is already held.
      - Does not cancel the current straight-run.
    - If dirKey ∈ movementKeys and dirKey !== activeMovement.key:
      - Direction change:
        - clearActiveMovement('direction_change'):
          - Issue keyUp(activeMovement.key).
          - Clear activeMovement.
        - Execute the incoming single-step as normal.
    - If dirKey is not in movementKeys:
      - Handled by safety rules (see section 8) before execution.

#### Timeout Watchdog

- Orchestrator-level watchdog periodically checks activeMovement:
  - If activeMovement is set and currentTime ≥ activeMovement.deadlineAt:
    - Force:
      - keyUp(activeMovement.key) if held.
      - Clear activeMovement.
  - Watchdog is the last line of defense; workers are expected to stopStraightRun on anomalies, but watchdog guarantees bounded holds regardless of worker correctness.

## 5) IPC Contract for Movement Intents

All movement intents go through the movement orchestrator via an inputAction-like IPC:

- module: 'movementOrchestrator'
- Methods:
  - startStraightRun(dirKey, segmentId, maxTiles, timeoutMs, source)
  - stopStraightRun(segmentId, reason)
  - singleStep(dirKey, source)

### Semantics

- startStraightRun:
  - Requests ownership of a continuous key-hold movement along dirKey for a specific logical path segment.
  - Must include:
    - dirKey: movement key.
    - segmentId: unique per caller for that segment.
    - maxTiles: upper bound on straight-run length (≥ 3).
    - timeoutMs: upper bound on run duration.
    - source: caller identity ('CAVEBOT', 'TARGETING', or similar).
  - Compatible with existing queue: orchestrator enqueues or executes as per current inputAction design without breaking non-movement actions.

- stopStraightRun:
  - Signals that the caller considers the referenced segment finished or aborted.
  - Only cancels if the current activeMovement.segmentId matches.
  - Includes reason (string) for logging/diagnostics (e.g. 'completed', 'timeout', 'path_change', 'control_lost').

- singleStep:
  - Represents a request for a single-tile movement in dirKey.
  - When no straight-run is active:
    - Behaves identically to existing single-step movement, respecting current action queue semantics.
  - When straight-run is active:
    - May be absorbed, or may cancel the active run if conflicting (see section 4 and 8).
  - Non-movement actions (spells, UI, etc.) remain fully compatible:
    - They continue using the existing IPC and queues.
    - The orchestrator’s safety rules ensure they do not leave stuck keys.

## 6) Cavebot Straight-Run Integration

### State

Cavebot worker maintains:

- workerState.straightRun:
  - segmentId
  - dirKey
  - startIndex / endIndex (indices in current path)
  - targetEnd / penultimate
  - maxTiles
  - startedAt
  - lastProgressAt
  - timeoutMs
  - active: boolean

This is strictly Cavebot-local tracking of its currently requested straight-run; the authority over actual key holds is in [electron/workers/inputOrchestrator.js](electron/workers/inputOrchestrator.js:1).

### Detection (WALKING)

Within WALKING state in [electron/workers/cavebot/fsm.js](electron/workers/cavebot/fsm.js:211) and associated handlers in [electron/workers/cavebot/actionHandlers.js](electron/workers/cavebot/actionHandlers.js:50):

- From the current position and current path:
  - Compute the longest aligned straight segment in a single direction (including diagonals).
  - Requirements:
    - Length ≥ 3 tiles (including current tile-to-target).
    - No special tiles in the segment:
      - No Stand/Ladder/Rope/Shovel/Machete/Door or equivalent interaction tiles.
    - Segment remains within the currently valid path and consistent with target waypoint.
- If no qualifying segment:
  - Use existing per-tile handleWalkAction logic.

### Behavior

- On qualifying segment:
  - Build/refresh workerState.straightRun for that segment.
  - If there is no active straightRun or the parameters changed (dirKey, segmentId, targetEnd, etc.):
    - If a previous straightRun exists:
      - Send stopStraightRun(previous.segmentId, 'new_segment').
    - Compose new segmentId (unique in Cavebot namespace).
    - Send startStraightRun(dirKey, segmentId, maxTiles, timeoutMs, 'CAVEBOT').
- While straightRun is active and valid:
  - Skip per-tile handleWalkAction for tiles inside the segment.
  - Do not emit duplicate singleStep commands for those tiles.
  - Continuously monitor:
    - Player position.
    - Current path and recomputation results.
    - Target waypoint consistency.

### Termination

Cavebot sends stopStraightRun when any of the following occurs:

- Final tile of the segment is reached (or passed as confirmed by position):
  - stopStraightRun(segmentId, 'completed').
- Path changes such that:
  - Direction changes, or
  - Segment is no longer aligned/valid, or
  - New path requires interaction/special tile inside the previously defined run.
  - stopStraightRun(segmentId, 'path_change').
- Timeout / no progress:
  - If no movement confirmation within expected timeframe:
    - stopStraightRun(segmentId, 'timeout').
- ControlState != 'CAVEBOT':
  - On losing control (e.g. Targeting or manual override becomes active):
    - stopStraightRun(segmentId, 'control_lost').

Whenever no valid straight-run is active or after any termination:

- Cavebot falls back immediately to existing per-step + awaitWalkConfirmation logic.
- This fallback is the authoritative default; straight-run is only a temporary optimization layer.

## 7) Targeting Straight-Run Integration

### State

Targeting logic in [electron/workers/targeting/targetingLogic.js](electron/workers/targeting/targetingLogic.js:365) maintains:

- targetingState.straightRun:
  - segmentId
  - dirKey
  - targetId / instanceId binding
  - startIndex / endIndex within the path to the target
  - targetEnd / penultimate
  - maxTiles
  - startedAt
  - lastProgressAt
  - timeoutMs
  - active: boolean

This tracks Targeting’s requested straight-run; the orchestrator owns actual key holds.

### Preconditions

Straight-run is only considered in Targeting when:

- controlState === 'TARGETING'.
- Targeting is enabled and in active combat-movement mode.
- No looting lock or conflicting behavior (e.g. looting.required) is active.
- There is a valid currentTarget with:
  - Resolved instanceId.
  - An up-to-date path bound to that instanceId.

### Behavior in manageMovement

Within manageMovement in [electron/workers/targeting/targetingLogic.js](electron/workers/targeting/targetingLogic.js:365):

- Compute a path from player to the current target consistent with current stance and distance rules.
- Detect the longest straight segment (≥ 3 tiles) toward the target consistent with:
  - Desired combat distance or chase behavior.
  - Avoiding special tiles / interactions (as per Cavebot rules).
- When a qualifying segment exists and is safe:
  - If there is no active targeting straight-run or parameters changed:
    - stopStraightRun(previous.segmentId, 'new_segment') if present.
    - startStraightRun(dirKey, segmentId, maxTiles, timeoutMs, 'TARGETING').
- Otherwise:
  - Use singleStep via movementOrchestrator for normal step-wise orbit/chase behavior.

### Aggressive Cancellation

Targeting cancels straight-run more aggressively than Cavebot. It issues stopStraightRun when:

- Target changes or currentTarget instanceId/path is invalidated.
- Stance/distance conditions become satisfied (no need to keep running).
- A better target is selected or priority changes.
- Target is unreachable, triggers anti-stuck, or path is recomputed incompatibly.
- Looting becomes required or a looting lock is activated.
- controlState is lost or transferred (manual, Cavebot, or other module).
- Any combat condition requires immediate directional adjustment.

Upon cancellation:

- Targeting reverts to existing step-wise movement logic using singleStep through movementOrchestrator.
- No behavioral regression when straight-run is disabled or constantly cancelled.

## 8) Safety Rules for Non-F-Key / Conflicting Input

Implemented centrally in [electron/workers/inputOrchestrator.js](electron/workers/inputOrchestrator.js:1).

Before executing any keyboard action routed through the orchestrator:

- If activeMovement exists or any movement key is currently held by the orchestrator:
  - Inspect the incoming key:
    - If key ∈ functionKeys:
      - Execute normally.
      - Do not cancel straight-run.
    - Else if activeMovement is set and key === activeMovement.key:
      - Compatible input; execute or no-op as appropriate.
    - Else if key ∈ movementKeys and key !== activeMovement.key:
      - Direction change:
        - clearActiveMovement('direction_change'):
          - keyUp(activeMovement.key).
          - Clear activeMovement.
        - Execute the new movement key action (single-step or new run).
    - Else (key not in functionKeys and not equal to activeMovement.key):
      - Conflicting non-movement input:
        - clearActiveMovement('conflicting_input'):
          - keyUp(activeMovement.key) if held.
          - Clear activeMovement.
        - Execute the incoming action normally.

Guarantees:

- No stuck movement keys when spells, commands, or other keys are used.
- F1–F12 never cancel or corrupt straight-run.
- Direction changes always go through clean key-up/key-down transitions.

## 9) Edge Cases and Guarantees

- Diagonals:
  - Straight-run fully supports diagonal movement keys (q, e, z, c).
  - Timeout and progress checks use diagonal move confirmations consistent with existing logic.
- Path recomputation:
  - If a path is recomputed:
    - Keep current straight-run only if:
      - The new path’s immediate steps remain consistent with current dirKey and segment.
      - The targetEnd/penultimate remain valid for the segment.
    - Otherwise:
      - Worker issues stopStraightRun(segmentId, 'path_change').
      - Fallback to step-wise behavior.
- Special tiles:
  - Straight-run segments never include:
    - Stand, Ladder, Rope, Shovel, Machete, Door, or any tile requiring interaction or special handling.
  - If such tiles appear ahead:
    - Worker does not start straight-run across them.
    - If they arise due to recomputation:
      - Worker cancels and reverts to single-step.
- Control handover:
  - When a worker loses controlState (e.g. Cavebot → Targeting or vice versa, or manual override):
    - Losing worker issues stopStraightRun(current.segmentId, 'control_lost').
    - MovementOrchestrator watchdog ensures any leftover run is cleared by deadline.
    - New owner may start its own straight-run with its own segmentId.
- Looting:
  - No straight-run is initiated while looting.required (or equivalent looting lock) is set.
  - If looting.required becomes set during a run:
    - Responsible worker issues stopStraightRun(segmentId, 'looting').
- Watchdogs:
  - Worker-level:
    - Each worker tracks lastProgressAt vs. expected travel time and cancels on anomalies.
  - Orchestrator-level:
    - Enforces timeoutMs/deadlineAt for activeMovement.
  - Combined:
    - Guarantee bounded duration of any held movement key even under desynchronization or partial failures.

## 10) Implementation Notes

- Incremental rollout:
  - Step 1: Implement the movementOrchestrator state machine and IPC methods in [electron/workers/inputOrchestrator.js](electron/workers/inputOrchestrator.js:1) without enabling straight-run callers.
  - Step 2: Update Cavebot and Targeting to send movementOrchestrator intents (singleStep) while preserving current behavior.
  - Step 3: Add straight-run detection and usage in Cavebot:
    - startStraightRun / stopStraightRun wired to WALKING state.
  - Step 4: Add straight-run detection and usage in Targeting:
    - startStraightRun / stopStraightRun integrated into manageMovement.
- Behavioral preservation:
  - When no startStraightRun is issued:
    - Behavior is identical to the existing implementation.
  - When startStraightRun is issued but any anomaly occurs:
    - Any timeout, conflict, path change, or control change results in:
      - stopStraightRun or orchestrator watchdog clearing activeMovement.
      - Immediate fallback to existing single-step logic.
- Summary:
  - Straight-run is a controlled optimization for stable straight segments (≥ 3 tiles).
  - Orchestrator exclusively owns key-hold behavior with a clear, bounded state machine.
  - Cavebot and Targeting opportunistically opt in via well-defined IPC intents.
  - All failure modes and edge cases resolve safely into the existing, proven movement pipeline.
