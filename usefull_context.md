# Useful Game Mechanics Context for Automation

This document outlines key game mechanics and automation challenges that are critical for understanding how the `creatureMonitor` and `targetingWorker` operate.

## 1. Core Components

*   **`creatureMonitor.js` (The "Eyes"):** This worker is responsible for perception. It constantly scans the screen to read information. Its primary jobs are to detect creature health bars in the main game view and to read the list of creature names from the Battle List widget using Optical Character Recognition (OCR).
*   **`targetingWorker.js` (The "Brain"):** This worker implements the core decision-making logic (the FSM). It takes the lists of creatures and their statuses from the `creatureMonitor` and uses a set of user-defined rules (priorities, stances, etc.) to decide which creature to attack and how to engage it.
*   **Pathfinder Module (The "Legs"):** A native module used by the workers to calculate paths within the game world and determine if a specific tile or creature is reachable from the player's current position.

## 2. Key Concepts & Challenges

### The Battle List

*   **UI Widget:** The Battle List is a distinct UI element, separate from the main game world view where the character and creatures are rendered.
*   **Provides Names:** It displays the names of all creatures currently visible to the player.
*   **Click-to-Target:** Its entries are clickable, and clicking an entry will target the corresponding creature in the game.
*   **No Coordinates:** The crucial limitation is that the Battle List **does not provide game world coordinates.** There is no direct data link between an entry in the list (e.g., the third "Wasp" from the top) and the specific creature sprite on the screen.

### The "Many Creatures, One Name" Problem

*   **Ambiguity:** The game allows multiple creatures with the exact same name (e.g., three "Wasp" creatures) to exist simultaneously.
*   **Targeting Challenge:** This creates ambiguity. Because the Battle List provides no coordinate data, clicking on a "Wasp" entry gives no guarantee as to *which* of the visible Wasps will be targeted.
*   **Solution - "Click and Verify":** The only reliable way to handle this is to perform a loop:
    1.  **Click** a battle list entry with the desired name.
    2.  **Wait** for the game to update and show a red target box on a creature.
    3.  **Verify** by having the `creatureMonitor` identify the newly targeted creature and check its unique `instanceId`.
    4.  If it's the wrong instance, **repeat** the process by clicking the next entry with the same name.

### Reachability

*   Creatures can often be visible on screen but logically unreachable (e.g., behind a wall, across a chasm, on a different floor).
*   The Pathfinder module is the source of truth for this. Before any engagement, the bot must query the pathfinder to ensure a valid path to the target exists.
*   The automation logic must react instantly if a target moves from a reachable to an unreachable location.

### Movement & Confirmation Delay

*   **Asynchronous Action:** Sending a movement command (e.g., an `ArrowUp` keypress) to the game client is not a guarantee of movement. The game might ignore the input if the character is blocked, paralyzed, or for other reasons.
*   **Necessary Wait:** To function reliably, the bot cannot assume a step was successful. After every single movement command, it must enter a brief waiting period where it polls the character's coordinates.
*   **Timeout:** If the coordinates do not change after a set timeout (e.g., 400ms), the step is considered to have failed. This delay is an unavoidable part of ensuring robust movement.
