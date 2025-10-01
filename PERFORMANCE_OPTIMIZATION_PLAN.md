# Performance Optimization Plan (Automaton)

Status: Draft
Last updated: 2025-10-01

This document consolidates concrete CPU usage hotspots and safe, high-ROI optimizations. It also proposes an iterative plan focusing first on one area to reduce unnecessary wakeups and IPC churn without sacrificing responsiveness.

Note: File references and line numbers reflect the current repository as scanned on 2025-10-01. They may shift with subsequent edits.

---

## Summary of hotspots and proposed fixes

1) Event-driven worker store update flushing (pilot area)
- Where
  - electron/workerManager.js: incomingActionQueue drained by a 5 ms setInterval (lines ~918–929). Workers push storeUpdate messages (lines ~382–393) into this queue.
- Problem
  - The 5 ms timer wakes 200 times/sec regardless of workload. This adds idle CPU load and competes with other work, especially when many workers are active.
- Proposed fix
  - Replace the periodic interval with an on-demand, one-shot flush scheduled using setImmediate when the first item arrives. If more updates arrive before the flush runs, they are coalesced into the same batch.
- Expected impact
  - Fewer wakeups under light/normal load. Lower CPU and smoother main-process scheduling. Maintains batching semantics already provided by electron/setGlobalState.js.

2) ScreenMonitor ROI gating and deduplicated updates
- Where
  - electron/workers/screenMonitor.js: main loop at 20 Hz (SCAN_INTERVAL_MS = 50). Always runs hotkey-bar item detection via findSequencesNativeBatch (lines ~249–253), and always posts a gameState update (lines ~260–274).
- Problem
  - Repeated expensive image searches and store updates even if the hotkey bar hasn’t changed. Causes CPU churn and downstream updates.
- Proposed fix
  - Gate hotkey bar detection on intersection with dirty rects for regions.hotkeyBar; skip if unchanged. Keep a last-payload hash (or field-by-field compare) and post only on change.
- Expected impact
  - Significant reduction in native searches and IPC when idle/stable UI.

3) OCR worker busy loop (5 ms)
- Where
  - electron/workers/ocr/config.js: MAIN_LOOP_INTERVAL = 5. electron/workers/ocr/core.js main loop delays by MAIN_LOOP_INTERVAL.
- Problem
  - 200 wakeups/sec even if no new frames or no relevant dirty regions. Idle CPU burn.
- Proposed fix
  - Switch to Atomics.wait on FRAME_COUNTER_INDEX (capture already Atomics.notify’s on commit). Wake only on new frames (or with a safety timeout).
- Expected impact
  - Dramatically lower idle CPU for the OCR worker.

4) Minimap ROI copies and per-frame allocations
- Where
  - electron/workers/minimap/helpers.js: extractBGRA allocates and copies each line; minimap/processing.js allocates floorIndicatorSearchBuffer per call.
- Problem
  - Per-frame Buffer.alloc and copies increase CPU and GC pressure.
- Proposed fix
  - Avoid copying the ROI: compute offsets on the shared screen buffer (stride addressing) or shift ROI extraction into native matcher. Reuse floorIndicator buffers.
- Expected impact
  - Lower memory bandwidth and GC churn per frame.

5) WindowTitleMonitor polling rate
- Where
  - electron/workers/windowTitleMonitor.js: POLLING_INTERVAL = 100 ms.
- Problem
  - Title changes are rare; 10 Hz is excessive CPU network and native calls.
- Proposed fix
  - Increase to 250–500 ms and/or suspend when not in control of the game window.

6) RegionMonitor timing math
- Where
  - electron/workers/regionMonitor.js: delay computation uses a timestamp incorrectly (always yields close to FULL_SCAN_INTERVAL_MS).
- Problem
  - Minor; doesn’t increase CPU, but fix for clarity/intent.
- Proposed fix
  - Use a real start/end measurement to compute the remaining delay.

7) Logging in hot paths
- Observation
  - Most workers use createLogger with info/debug disabled in production. A few console.log calls remain (e.g., in capture/ocr startup). Keep them behind flags or strip in production builds.

8) WorkerManager state diffs hashing
- Observation
  - Diff hashing (quickHash) to suppress duplicate sends is good. If diffs grow, consider per-slice version counters instead of hashing large objects. Not urgent.

---

## Selected focus area for iteration: Event-driven worker store update flushing

Goal: Remove the 5 ms periodic loop for draining worker store updates and replace it with an on-demand, batched flush via setImmediate.

Current behavior
- Workers post { storeUpdate: true, type, payload } to the main process.
- WorkerManager enqueues into incomingActionQueue and a 5 ms setInterval drains the queue and calls setGlobalState for each item.

Design
- On receiving a storeUpdate message, push into incomingActionQueue.
- If no flush is scheduled, schedule a one-shot flush with setImmediate. When the flush runs, drain the entire queue and call setGlobalState for each action.
- Rely on electron/setGlobalState.js (already batches renderer notifications via setImmediate) to coalesce frequent bursts to the UI.

Why setImmediate
- setImmediate batches microtasks without introducing long delays or EventLoop starvation; it is also already used in the renderer batching code.

Expected wins
- Idle CPU usage in the main process drops (no unconditional wakeups).
- Fewer scheduling collisions with other periodic work.

Edge cases and considerations
- Ordering: The queue is FIFO; setImmediate maintains ordering within the same tick relative to other tasks.
- Bursts: Multiple storeUpdate messages arriving before the flush fires will be coalesced into one batch.
- Backpressure: setGlobalState already batches UI notifications; main-process store.dispatch remains immediate for correctness.
- Safety: If a pathological flood occurs, the behavior is identical to today’s per-item processing, just without the 5 ms loop.

Implementation plan (Increment 1)
1) Remove/disable the 5 ms setInterval created in WorkerManager.initialize (electron/workerManager.js ~918–929).
2) In handleWorkerMessage, when message.storeUpdate is true, enqueue and schedule a flush if not yet scheduled.
3) Implement flush with setImmediate: drain queue and call setGlobalState for each action.
4) Keep existing batch semantics in electron/setGlobalState.js (it already uses setImmediate to batch renderer messages).

Pseudocode (for review)
- In workerManager.js, inside handleWorkerMessage:

  - If (message.storeUpdate) {
    - incomingActionQueue.push({ type, payload });
    - if (!flushScheduled) {
      - flushScheduled = true;
      - setImmediate(() => {
        - flushScheduled = false;
        - const batch = incomingActionQueue.splice(0);
        - for (const action of batch) setGlobalState(action.type, action.payload);
      - });
    - }
    - return;
  }

Validation plan
- Metrics to capture during dev:
  - Count of flushes per second, and average batch size per flush (log at debug level for a short window).
  - CPU usage (main process) before/after while idling for 60 seconds.
  - End-to-end latency: time from worker postMessage to renderer receive (sample a few cases with timestamps).
- Test scenarios:
  - Idle with no workers producing updates (should see 0 flushes, near-zero CPU wakeups for this path).
  - Moderate activity (ScreenMonitor posting changes; ensure batches form and UI updates remain responsive).
  - Stress (CreatureMonitor/Targeting rapid updates) to ensure ordering and throughput are maintained.

Rollback plan
- Keep a feature flag or quick branch diff to re-enable the old interval-driven drain if any regressions are detected.

---

## Next candidates for iteration (after Increment 1)

A) ScreenMonitor ROI gating + update dedupe
- Implement dirty-rect intersection for regions.hotkeyBar before running findSequencesNativeBatch.
- Add a last-sent payload cache to only post gameState.update when values change.
- Metrics: number of hotkeyBar scans/sec, average store updates/sec, CPU.

B) OCR worker Atomics.wait-based loop
- Replace 5 ms loop with Atomics.wait on FRAME_COUNTER_INDEX, waking on new frames.
- Add a 1s timeout to guard against lost notifications.
- Metrics: OCR worker CPU while idle, OCR latency on new frames.

C) Minimap ROI copies removal
- Replace extractBGRA with stride-based reads into preallocated workspace or pass ROI/stride to native code.
- Reuse floorIndicator buffers; avoid Buffer.alloc per frame.
- Metrics: minimapMonitor CPU during movement, number/size of allocations.

---

## References (files and anchors)
- electron/workerManager.js
  - handleWorkerMessage routing and incomingActionQueue: ~382–393, ~336–535
  - setInterval drain loop: ~918–929
- electron/setGlobalState.js batching: ~35–39
- electron/workers/screenMonitor.js
  - Active item detection and update posting: ~249–274
- electron/workers/ocr/core.js, electron/workers/ocr/config.js
  - MAIN_LOOP_INTERVAL = 5; busy loop
- electron/workers/minimap/helpers.js, electron/workers/minimap/processing.js
  - extractBGRA allocations and per-frame temp buffers
- electron/workers/windowTitleMonitor.js
  - POLLING_INTERVAL = 100 ms
- electron/workers/regionMonitor.js
  - Delay math near end of main loop

---

## Appendix: Risks and mitigations
- Event-driven flush
  - Risk: Very large burst could delay flush slightly relative to the 5 ms tick; Mitigation: setImmediate is run next turn; profiles typically show reduced overhead and similar latency.
- ROI gating mistakes
  - Risk: Missing updates if dirty-rect logic is wrong; Mitigation: initial shadow-mode logging where we count how many times we would have processed but skip work.
- Atomics.wait usage
  - Risk: Missed notifications; Mitigation: add timeout to wait and re-check counters; sanity checks.
- Buffer reuse
  - Risk: Shared buffers used after size changes; Mitigation: recalc/realloc on size change only, with guards.

---

## Decision log
- Pilot area chosen: Event-driven worker store update flushing in workerManager.js.
- Rationale: Minimal code surface, low risk, immediate and measurable CPU benefit.
- Next steps: Implement Increment 1 behind a small flag, measure, and proceed to ScreenMonitor gating.
