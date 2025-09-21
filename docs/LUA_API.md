# Automaton Lua API Documentation

This document outlines the functions, variables, and concepts available within the Automaton Lua scripting environment.

## Global State Variables

Numerous global variables are available to all scripts, providing direct, read-only access to the current state of the bot and the game. These variables are prefixed with a `$` sign.

**Example:**
```lua
if $hppc < 50 then
  print('Health is below 50%!')
end
```

### Player Vitals & Stats
- `$hppc`: (Number) Your character's current health percentage.
- `$mppc`: (Number) Your character's current mana percentage.
- `$cap`: (Number) Your character's current carrying capacity.
- `$stamina`: (Number) Your character's stamina in minutes.
- `$level`: (Number) Your character's level.
- `$exp`: (Number) Your character's experience points.
- `$soul`: (Number) Your character's soul points.
- `$speed`: (Number) Your character's speed.
- `$xpRate`: (Number) An estimate of your XP gain per hour.
- `$food`: (Number) Your remaining food/regeneration time in seconds.
- `$pos`: (Table) Your character's current position `{x, y, z}`.
- `$standTime`: (Number) Time in milliseconds since your character last moved.

### Game State
- `$characterName`: (String) The name of your character.
- `$isOnline`: (Boolean) `true` if you are currently online.
- `$isTyping`: (Boolean) `true` if the game client believes you are typing in the chat.
- `$isChatOff`: (Boolean) `true` if the chat is toggled off.
- `$monsterNum`: (Number) The number of creatures currently in your battle list.
- `$battleList`: (Table) A list of all entries currently in the battle list.
- `$partyNum`: (Number) The number of players in your party.
- `$players`: (Table) A list of other players visible on screen.
- `$pk`: (Boolean) `true` if you have a player-killing skull.
- `$activeTab`: (String) The name of the currently active chat tab.
- `$target`: (Table) Information about the currently targeted creature, or `nil` if no target.
  - `name`: (String) The name of the targeted creature.
  - `x`, `y`, `z`: (Numbers) The game world coordinates of the target.
  - `distance`: (Number) The distance (in tiles) from your character to the target.
  - `abs.x`, `abs.y`: (Numbers) The absolute screen coordinates of the target.

### Character Status
- A series of boolean flags for your character's status conditions are available (e.g., `$poisoned`, `$burning`, `$hasted`).

### Bot State
- `$cavebot`: (Boolean) `true` if the cavebot is enabled.
- `$healing`: (Boolean) `true` if the healing rules are enabled.
- `$targeting`: (Boolean) `true` if monster targeting is enabled.
- `$scripts`: (Boolean) `true` if the Lua script engine is enabled.
- `$lastLabel`: (String) The label of the last waypoint the cavebot passed.
- `$section`: (String) The name of the current waypoint section.
- `$wpt`: (Table) Information about the current waypoint: `{id, x, y, z, type, label, distance}`.

---

## Global Functions

These functions are available globally in your Lua scripts.

### General & Utility

`print(...messages)`
- **Description**: Prints one or more messages to the bot's log and the script's log view.
- **Parameters**: Any number of strings or values that can be converted to strings.

`log(level, ...messages)`
- **Description**: Logs a message with a specific level (e.g., 'info', 'warn', 'error').
- **Parameters**:
  - `level`: (String) The log level.
  - `...messages`: The messages to log.

`alert()`
- **Description**: Plays the system alert sound configured in the bot.

`wait(min_ms, max_ms)`
- **Description**: Pauses the script for a random duration between `min_ms` and `max_ms`.
- **Parameters**:
  - `min_ms`: (Number) The minimum time to wait in milliseconds.
  - `max_ms`: (Number, optional) The maximum time to wait. If omitted, waits for exactly `min_ms`.

`canUse(itemName)`
- **Description**: Checks if a specific action item is currently visible and available on your hotkey bar.
- **Parameters**:
  - `itemName`: (String) The name of the action item to check.
- **Returns**: (Boolean) `true` if the item is available, `false` otherwise.

`caround(distance)`
- **Description**: Returns the number of creatures detected by the creature monitor. When no distance is specified, returns all detected creatures. When distance is specified, returns only creatures within that distance.
- **Parameters**:
  - `distance`: (Number, optional) The maximum distance in tiles. If omitted, returns all detected creatures.
- **Returns**: (Number) The count of creatures within range (or all creatures if no distance specified), or 0 if none.

`paround()`
- **Description**: Returns the total number of players currently visible on screen.
- **Returns**: (Number) The count of visible players, or 0 if none.

`npcaround()`
- **Description**: Returns the total number of NPCs currently visible on screen.
- **Returns**: (Number) The count of visible NPCs, or 0 if none.

`maround()`
- **Description**: Returns the total number of battle list entries (monsters). Battle list entries don't have coordinate data, so no distance filtering is possible.
- **Returns**: (Number) The count of all battle list entries, or 0 if none.

`wptDistance()`
- **Description**: Returns the chebyshev distance to the current waypoint. Returns 0 if standing on the exact tile, 1 if standing next to it.
- **Returns**: (Number) The distance to the current waypoint in tiles, or 0 if no waypoint or same position.

`isTileReachable(x, y, z)`
- **Description**: Uses the actual pathfinder engine to check if the target coordinates can be reached. Returns false if the distance is greater than 50 tiles or if no valid path exists.
- **Parameters**:
  - `x`: (Number) The target X coordinate.
  - `y`: (Number) The target Y coordinate.
  - `z`: (Number) The target Z coordinate (floor level).
- **Returns**: (Boolean) `true` if the tile is reachable via pathfinding, `false` otherwise.

### Movement & Position

`getDistanceTo(x, y, z)`
- **Description**: Calculates the distance (in tiles) from your character to a target coordinate.
- **Parameters**:
  - `x`, `y`, `z`: (Numbers) The target coordinates.
- **Returns**: (Number) The distance.

`isLocation(range = 0)`
- **Description**: Checks if your character is at the current cavebot waypoint, within an optional range.
- **Parameters**:
  - `range`: (Number, optional) The allowed distance from the waypoint.
- **Returns**: (Boolean) `true` if you are at the location.

`wptDistance()`
- **Description**: Returns the chebyshev distance to the current waypoint. Returns 0 if standing on the exact tile, 1 if standing next to it.
- **Returns**: (Number) The distance to the current waypoint in tiles, or 0 if no waypoint or same position.

### Input & Control

`keyPress(key, modifier = nil)`
- **Description**: Simulates a single key press.
- **Parameters**:
  - `key`: (String) The key to press (e.g., 'f1', 'a', 'enter').
  - `modifier`: (String, optional) A modifier key ('ctrl', 'shift', 'alt').

`keyPressMultiple(key, count, modifier, delayMs)`
- **Description**: Presses a key multiple times.

`typeText(...texts, startAndEndWithEnter = true)`
- **Description**: Types text into the active chat.

`typeSequence(texts, delayBetween = 100)`
- **Description**: Types a sequence of texts, pressing Enter after each one.

`rotate(direction)`
- **Description**: Rotates your character.
- **Parameters**: `direction`: (String) 'up', 'down', 'left', or 'right'.

`isTyping()`
- **Description**: Checks if the game client thinks the user is currently typing.
- **Returns**: (Boolean)

### Mouse Clicks

`clickTile(button, x, y, position = 'center')`
- **Description**: Clicks on a specific in-game tile coordinate.
- **Parameters**:
  - `button`: (String) 'left' or 'right'.
  - `x`, `y`: (Numbers) The target in-game coordinates.
  - `position`: (String, optional) Where within the tile to click. Can be `'center'`, `'topLeft'`, `'topRight'`, `'bottomLeft'`, `'bottomRight'`. Defaults to `'center'`.

`clickAbsolute(button, x, y)`
- **Description**: Clicks at absolute screen coordinates relative to the game window.
- **Parameters**:
  - `button`: (String) 'left' or 'right'.
  - `x`, `y`: (Numbers) The absolute screen coordinates.

`mapClick(x, y, position = 'center')`
- **Description**: Clicks on the minimap at a specific in-game coordinate.

### Mouse Drags

`drag(startX, startY, endX, endY, button = 'left')`
- **Description**: Drags an item from one game tile to another.

`dragAbsolute(startX, startY, endX, endY, button = 'left')`
- **Description**: Drags the mouse between two absolute screen coordinates.

### Coordinate Translation

`tileToCoordinate(tileX, tileY, position = 'bottomRight')`
- **Description**: Converts an in-game tile coordinate to an absolute screen coordinate.
- **Returns**: (Table) A table `{x, y}` with the screen coordinates, or `nil`.

`coordinateToTile(screenX, screenY)`
- **Description**: Converts an absolute screen coordinate to an in-game tile coordinate.
- **Returns**: (Table) A table `{x, y}` with the tile coordinates, or `nil`.

### Bot Control

`setTargeting(enabled)`
- **Description**: Enables or disables the targeting module.

`setHealing(enabled)`
- **Description**: Enables or disables the healing module.

`setCavebot(enabled)`
- **Description**: Enables or disables the cavebot module.

`setScripts(enabled)`
- **Description**: Enables or disables the Lua script module.

`pauseWalking(ms)`
- **Description**: Temporarily pauses the cavebot's walking logic.

`pauseTargeting(ms)`
- **Description**: Temporarily pauses the targeting logic.

### Game World & Creatures

`isCreatureOnTile(x, y, z)`
- **Description**: Checks if a creature is on a specific tile.
- **Returns**: (Boolean)

`caround(distance)`
- **Description**: Returns the number of creatures detected by the creature monitor. When no distance is specified, returns all detected creatures. When distance is specified, returns only creatures within that distance.
- **Parameters**:
  - `distance`: (Number, optional) The maximum distance in tiles. If omitted, returns all detected creatures.
- **Returns**: (Number) The count of creatures within range (or all creatures if no distance specified), or 0 if none.

`paround()`
- **Description**: Returns the total number of players currently visible on screen.
- **Returns**: (Number) The count of visible players, or 0 if none.

`npcaround()`
- **Description**: Returns the total number of NPCs currently visible on screen.
- **Returns**: (Number) The count of visible NPCs, or 0 if none.

`maround()`
- **Description**: Returns the total number of battle list entries (monsters). Battle list entries don't have coordinate data, so no distance filtering is possible.
- **Returns**: (Number) The count of all battle list entries, or 0 if none.

`isTileReachable(x, y, z)`
- **Description**: Uses the actual pathfinder engine to check if the target coordinates can be reached. Returns false if the distance is greater than 50 tiles or if no valid path exists.
- **Parameters**:
  - `x`: (Number) The target X coordinate.
  - `y`: (Number) The target Y coordinate.
  - `z`: (Number) The target Z coordinate (floor level).
- **Returns**: (Boolean) `true` if the tile is reachable via pathfinding, `false` otherwise.

### UI & Login

`focusTab(tabName)`
- **Description**: Clicks on a specific chat tab to bring it into focus.

`login(email, password, character)`
- **Description**: Executes the login sequence.

---

## Cavebot-Only Functions

These functions are only available in scripts running from a 'Script' waypoint in the cavebot.

`skipWaypoint()`
- **Description**: Immediately advances the cavebot to the next waypoint in the list.

`goToLabel(label)`
- **Description**: Finds the next waypoint with the given label in the current section and sets it as the target.

`goToSection(sectionName, label)`
- **Description**: Finds a waypoint section by name and sets the first waypoint of that section as the target. If a `label` is provided, it will go to the waypoint with that specific label within the target section.
- **Parameters**:
  - `sectionName`: (String) The name of the section to go to.
  - `label`: (String, optional) The label of the specific waypoint to go to within the section.

`goToWpt(index)`
- **Description**: Goes to a waypoint by its numerical index (starting from 1) in the current section.

`back(waypoints)`
- **Description**: Goes back a specified number of waypoints in the current section.
- **Parameters**:
  - `waypoints`: (Number) The number of waypoints to go back.

`backLoc(range, waypoints)`
- **Description**: If the character is not at the current waypoint (within the specified `range`), it goes back a number of `waypoints`.
- **Parameters**:
  - `range`: (Number) The allowed distance from the waypoint.
  - `waypoints`: (Number) The number of waypoints to go back.

`backz(waypoints)`
- **Description**: If the character's Z position (floor) does not match the current waypoint's Z position, it goes back a number of `waypoints`.
- **Parameters**:
  - `waypoints`: (Number) The number of waypoints to go back.

`pauseActions(paused)`
- **Description**: Pauses or resumes the execution of actions (e.g., 'use', 'say') at cavebot waypoints.

---

## Shared Globals

You can share data between different Lua scripts using the `SharedGlobals` table.

**Example:**

**Script 1:**
```lua
SharedGlobals.myValue = 123
```

**Script 2:**
```lua
if SharedGlobals.myValue == 123 then
  print('Value was set by another script!')
end
```
