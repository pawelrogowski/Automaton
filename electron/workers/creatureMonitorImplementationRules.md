# creatureMonitor Implementation Rules

This document defines the implementation rules, constraints, and tactics for:

- ["creatureMonitor.js"](electron/workers/creatureMonitor.js)
- ["creatureMonitorSpec.md"](electron/workers/creatureMonitorSpec.md)
- ["creatureMonitorUtils/\*"](electron/workers/creatureMonitorUtils/helpers.js)

It is the authoritative guide for how the creatureMonitor code MUST be structured and evolved. Any non-trivial change to creatureMonitor.js or helpers MUST be reflected in:

- creatureMonitorSpec.md (behavioral contract)
- This file (rules, style, performance, and architecture constraints)

Both documents must be kept in lockstep with the implementation.

---

## 1. Scope and Philosophy

1. The creatureMonitor worker is a critical hot-path component:
   - Runs frequently.
   - Interacts with native modules and SAB.
   - Drives targeting, cavebot, and UI behavior.
2. Design goals:
   - Deterministic, debuggable, and performant.
   - No “mystery heuristics” without documented rationale.
3. This file encodes:
   - Code structure rules.
   - Style constraints specific to this worker.
   - Performance and safety tactics.
   - Testing/observability expectations.

---

## 2. Structural Rules

2.1 File layout

- Orchestration:
  - Core logic lives in:
    - ["creatureMonitor.js"](electron/workers/creatureMonitor.js)
  - This file:
    - Wires workerData/SAB.
    - Handles messages.
    - Coordinates OCR/detection, gating, and emissions.
- Helpers:
  - Shared, stateless utilities live in:
    - ["creatureMonitorUtils/helpers.js"](electron/workers/creatureMonitorUtils/helpers.js)
  - Any new reusable helper for creatureMonitor MUST:
    - Be placed under `creatureMonitorUtils/`.
    - Have a descriptive, domain-meaningful name.
    - Be imported explicitly in creatureMonitor.js.
  - Do NOT define ad-hoc anonymous helpers deep inside business logic when they can be reused.

    2.2 No abstraction hell

- Helpers MUST:
  - Be small and concrete.
  - Do one clear thing (e.g., “shouldRefreshRegionForDirtyRects”, “projectHealthBarToTileCoords”).
- Avoid:
  - Nested generic utility layers that obscure behavior.
- Location rules:
  - Cross-cutting helpers: `creatureMonitorUtils/helpers.js`.
  - Complex or domain-specific groups (future): dedicated files under `creatureMonitorUtils/` with clear names.

    2.3 Message handling

- Message handler in creatureMonitor.js MUST:
  - Be a clear top-level dispatcher (switch or equivalent).
  - For each `message.type`, define:
    - Expected payload shape.
    - Exact side effects.
- Unknown message types:
  - MUST be ignored safely (no throws).

---

## 3. Code Style Rules (Specific to creatureMonitor)

3.1 Arrow functions

- All helper functions (including those in `creatureMonitorUtils`) MUST be arrow functions.
- In creatureMonitor.js:
  - Prefer arrow functions for internal utilities and callbacks.
  - Top-level orchestration functions may also be arrow functions; consistency is preferred.

    3.2 Imports & modules

- Use ES modules (`import`/`export`).
- For CommonJS dependencies (e.g., font-ocr):
  - Use default import and destructuring:
    - `import fontOcrPkg from 'font-ocr';`
    - `const { recognizeText } = fontOcrPkg;`

    3.3 Naming

- `camelCase` for variables and functions.
- `PascalCase` only for classes (not expected here).
- Names must reflect behavior:
  - Good:
    - `shouldRefreshRegionForDirtyRects`
    - `projectHealthBarToTileCoords`
    - `jsonEqualsAndCache`
  - Bad:
    - `util1`, `helperFn`, `doStuff`.

    3.4 No magic numbers

- Any thresholds (pixels, ms, etc.) must:
  - Be declared as constants near top of file.
  - Documented in creatureMonitorSpec.md when part of observable behavior.

---

## 4. Performance and Concurrency Tactics

4.1 Dirty-rect gating (current behavior)

- All OCR/detection MUST be triggered only when necessary:
  - Battle list OCR:
    - Only when battleList entries region intersects dirty rects.
  - Player/NPC list OCR:
    - Only when their respective regions intersect dirty rects.
  - Health bars:
    - Only when:
      - `battleList` OR `playerList` indicates potential entities, AND
      - gameWorld region intersects dirty rects.
- Implementation MUST use:
  - `shouldRefreshRegionForDirtyRects(region, dirtyRects)` from helpers.

    4.2 Deduplication

- Outbound SAB/Redux updates MUST be deduplicated to prevent noisy version bumps:
  - Use:
    - `jsonEqualsAndCache(lastPosted, key, value)` from helpers.
  - Only send:
    - `battleList/setBattleListEntries`
    - `uiValues/setPlayers`
    - `uiValues/setNpcs`
    - `targeting/setHealthBars`
  - when the payload has actually changed.

    4.3 SAB interaction

- Reads:
  - Must be defensive; assume concurrent writers.
- Writes:
  - Use minimal, consistent writes.
  - For now: direct `sabInterface.set` is allowed for `healthBars`.
  - Future phases should use `setMany` for related fields.

    4.4 Native calls

- Must be:
  - Gated by dirty rects and logical conditions.
  - Never called redundantly for unchanged regions.

---

## 5. Correctness and Determinism Rules

5.1 Alignment with Spec

- creatureMonitor.js and helpers MUST match:
  - ["creatureMonitorSpec.md"](electron/workers/creatureMonitorSpec.md)
- Any change to:
  - Dirty-rect gating behavior
  - Gating conditions for health bars
  - Emitted actions and shapes
  - Helper semantics
- MUST be:
  - Reflected in the spec concurrently.

    5.2 State clearing

- When OCR returns empty due to visual disappearance:
  - The corresponding Redux/SAB state MUST be cleared (subject to dedup).
- When health bar gating condition turns false:
  - Previously reported bars MUST be cleared once.

---

## 6. Testing and Observability Rules

6.1 Logging

- Hot-path logging:
  - May log frame number + dirty rect count for debugging.
  - Must remain lightweight.
- Errors:
  - MUST be logged with clear prefixes:
    - `[CreatureMonitor] ...`

    6.2 Consistency checks

- When adding new helpers:
  - Ensure they are:
    - Pure.
    - Tested via usage in creatureMonitor.js.
  - Ensure no duplicate logic exists in both helpers and creatureMonitor.js.

---

## 7. Process: How to Change creatureMonitor

When modifying creatureMonitor or its helpers:

1. Update:
   - ["creatureMonitor.js"](electron/workers/creatureMonitor.js)
   - ["creatureMonitorUtils/helpers.js"](electron/workers/creatureMonitorUtils/helpers.js) or related utils
2. Update:
   - ["creatureMonitorSpec.md"](electron/workers/creatureMonitorSpec.md) to reflect current behavior.
   - This file to reflect any new rules, invariants, helper locations, or naming conventions.
3. Keep changes in a single coherent step/commit so implementation, spec, and rules never drift.

This process requirement is part of the implementation contract.
