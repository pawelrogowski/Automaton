# Targeting Worker Refactor Summary

## 1. Overview

The core of the refactor was to replace the old, monolithic Finite State Machine (FSM) in `targetingWorker.js` with a new, granular, and more responsive architecture. The previous FSM used broad states (`SELECTING`, `ACQUIRING`, `ENGAGING`) that handled too many responsibilities, leading to slow, timeout-based decision-making and making the system difficult to debug and extend.

The new architecture breaks the process into seven distinct states, each with a single, clear responsibility. This makes the bot's decision-making process faster, more explicit, and more resilient.

## 2. Problems Addressed

This refactor was designed to solve several critical issues:

*   **Slow Reaction Time:** The bot was slow to react when a target became unreachable or when a higher-priority target appeared.
*   **Inefficient Target Cycling:** The process for targeting the correct creature instance when multiple creatures had the same name (the "many wasps" problem) was slow and unreliable.
*   **Pathing/Targeting Mismatch:** Race conditions could cause the bot to move towards one creature while attempting to target another.
*   **Stuck Scenarios:** The bot could get stuck trying to reach an unreachable target or attempting the same failed movement step repeatedly.

## 3. The New FSM Architecture

The new FSM is composed of the following states:

1.  **`IDLE`**: **Do Nothing.** The default state when targeting is disabled or paused. It ensures no actions are taken.
2.  **`EVALUATING`**: **Decide** what to attack. This state's only job is to run `selectBestTarget` to find the highest-value creature based on the configured rules.
3.  **`PATHING`**: **Plan** the approach. It requests a path to the selected target and checks for reachability. If a target is unreachable, it immediately transitions back to `EVALUATING`.
4.  **`APPROACHING`**: **Move** towards the target. It follows the generated path one step at a time, running a full evaluation before every single step to ensure it can react instantly to changes.
5.  **`ACQUIRING`**: **Act** to target the creature. It sends a single, non-blocking command (a mouse click or keypress) to the game to acquire the target lock.
6.  **`VERIFYING_TARGET`**: **Confirm** the action. This state polls the game to confirm that the correct creature instance is targeted. It handles success, failure (wrong target), and timeouts.
7.  **`ENGAGING`**: **Fight** the confirmed target. This state manages the active combat encounter, constantly checking that the target is still valid, in range, and the highest priority. It does not handle movement.

## 4. How the New Architecture Solves Key Problems

*   **Instantaneous Reactions:** By breaking responsibilities into smaller states, the FSM can react to events instantly. If a target becomes unreachable in the `PATHING` or `APPROACHING` state, the FSM immediately transitions back to `EVALUATING` to find a new target. The old 400ms delay is gone.
*   **Reliable Target Cycling:** The `ACQUIRING` -> `VERIFYING_TARGET` loop is fast and explicit. It clicks, checks the result, and if it's wrong, it immediately loops back to click the next entry. This makes finding the correct instance among same-named creatures much faster and more reliable.
*   **Responsive Preemption:** The `APPROACHING` and `ENGAGING` states constantly check for higher-priority targets on every cycle. If one appears, they immediately transition to `EVALUATING`, ensuring the bot always focuses on the most important threat.
*   **Non-Blocking Movement:** The `APPROACHING` state follows the "Evaluate, then Act" pattern. It runs a full suite of checks *before* committing to each single step. This ensures that while the bot is waiting for a step to complete, it has already verified that the step is still the correct action to take. This prevents the bot from getting stuck and allows it to change its mind mid-path.

## 5. Affected Files

*   `/electron/workers/targetingWorker.js`: Completely overhauled to implement the new FSM architecture.
*   `/electron/workers/targeting/targetingLogic.js`: Reviewed and confirmed to be compatible with the new architecture. No changes were needed as its helper functions were already well-decoupled.
