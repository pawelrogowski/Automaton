# Lua API Troubleshooting Guide

This guide helps resolve common issues with the new Lua API functions in Automaton.

## Common Issues and Solutions

### 1. Functions Return 0 or Unexpected Values

#### Problem: `caround()`, `maround()` always return 0

**Possible Causes:**
- Player is not online
- Game world is not visible
- No creatures/monsters are actually nearby or in battle list
- Region coordinates not properly detected
- Creature monitor not functioning

**Solutions:**
```lua
-- Check if player is online
if not $isOnline then
    print("Player is not online - functions may not work")
    return
end

-- Check if game world is visible
if not $pos or ($pos.x == 0 and $pos.y == 0) then
    print("Player position unknown - check game window")
    return
end

-- Verify basic counts first
print("Monster count from state:", $monsterNum)
print("Battle list entries:", #($battleList.entries or {}))
```

#### Problem: `paround()`, `npcaround()` always return 0

**Possible Causes:**
- No players/NPCs are actually visible on screen
- OCR or UI detection not working
- Player/NPC lists not being populated

**Solutions:**
```lua
-- Check basic visibility counts
print("Player count from state:", $playerNum)
print("NPC count from state:", $npcNum)
print("Players list:", #($players or {}))
print("NPCs list:", #($npcs or {}))
```

#### Problem: Distance-based functions return lower counts than expected

**Cause:** `caround(distance)` and `maround(distance)` only count entities with valid coordinate data and on the same Z-level when distance parameter is provided.

**Note:** 
- `caround()` without parameter = all detected creatures
- `caround(1)` with parameter = only creatures within 1 tile  
- `paround()` and `npcaround()` do NOT use distance - they return total visible counts

**Solution:**
```lua
-- Compare total vs distance-filtered counts
local allCreatures = caround()
local nearbyCreatures = caround(3)
print("Total creatures:", allCreatures, "Within 3 tiles:", nearbyCreatures)

-- Debug creature data for distance-based functions
if $battleList and $battleList.entries then
    for i, entry in ipairs($battleList.entries) do
        if i <= 3 then -- Show first 3 entries
            print("Battle entry:", entry.name, "at", entry.x or "nil", entry.y or "nil", entry.z or "nil")
        end
    end
end
```

### 2. Target Coordinate Issues

#### Problem: `$target.x`, `$target.y`, `$target.z` return nil

**Possible Causes:**
- No target selected
- Target data not properly synchronized
- Target coordinates not available in current context

**Solutions:**
```lua
-- Safe target access
if $target then
    print("Target name:", $target.name or "unknown")
    print("Target distance:", $target.distance or "unknown")
    
    -- Check coordinate availability
    if $target.x and $target.y and $target.z then
        print("Target coords:", $target.x, $target.y, $target.z)
    else
        print("Target coordinates not available")
        
        -- Check gameCoords if available
        if $target.gameCoords then
            print("Game coords:", $target.gameCoords.x, $target.gameCoords.y, $target.gameCoords.z)
        end
    end
else
    print("No target selected")
end
```

### 3. `wptDistance()` Returns 0 When Not on Waypoint

#### Problem: Function returns 0 even when far from waypoint

**Possible Causes:**
- No active waypoint
- Waypoint data not synchronized
- Player position not available
- Z-level mismatch between player and waypoint

**Solutions:**
```lua
-- Debug waypoint distance
local dist = wptDistance()
print("Waypoint distance:", dist)

-- Check waypoint data
if $wpt then
    print("Active waypoint:", $wpt.id, "at", $wpt.x, $wpt.y, $wpt.z)
    print("Player position:", $pos.x, $pos.y, $pos.z)
    
    -- Manual distance calculation for verification
    if $pos then
        local manualDist = math.max(
            math.abs($pos.x - $wpt.x),
            math.abs($pos.y - $wpt.y)
        )
        print("Manual calculation:", manualDist)
        
        if $pos.z ~= $wpt.z then
            print("WARNING: Player and waypoint on different floors!")
        end
    end
else
    print("No active waypoint")
end
```

### 4. `isTileReachable()` Always Returns False

#### Problem: Function always returns false even for nearby tiles

**Possible Causes:**
- Distance limit exceeded (50 tiles)
- Different Z-levels
- Invalid coordinates passed
- Pathfinder context not available

**Solutions:**
```lua
-- Debug reachability check
local x, y, z = 1000, 1000, 7  -- Example coordinates

-- Validate inputs
if not x or not y or not z then
    print("Invalid coordinates provided")
    return
end

-- Check distance
if $pos then
    local distance = math.max(math.abs($pos.x - x), math.abs($pos.y - y))
    print("Distance to target:", distance)
    
    if distance > 50 then
        print("Target too far (>50 tiles) - will return false")
    elseif $pos.z ~= z then
        print("Different Z-level - will return false")
    else
        local reachable = isTileReachable(x, y, z)
        print("Reachability result:", reachable)
    end
else
    print("Player position not available")
end

-- Test adjacent tiles (should usually be reachable)
if $pos then
    local north = isTileReachable($pos.x, $pos.y - 1, $pos.z)
    print("North tile reachable:", north)
end
```

## Performance Issues

### 1. Functions Are Too Slow

#### Problem: Scripts lag when calling functions frequently

**Solutions:**
```lua
-- Cache results instead of calling repeatedly
local creatures = caround(3)
local players = paround(5)

-- Use cached values
if creatures > 0 then
    -- Multiple uses of 'creatures' variable
end

-- Don't call in tight loops
for i = 1, 100 do
    local c = caround(1)  -- BAD: Called 100 times
end

-- Better approach
local creatures = caround(1)
for i = 1, 100 do
    if creatures > 0 then
        -- Use cached value
    end
end
```

### 2. Memory Issues with Large Scripts

#### Problem: Script uses too much memory

**Solutions:**
```lua
-- Clear variables when done
local creatures = caround(5)
-- ... use creatures ...
creatures = nil  -- Free memory

-- Avoid creating unnecessary tables
-- BAD:
local results = {}
for i = 1, 10 do
    results[i] = caround(i)
end

-- GOOD:
for i = 1, 10 do
    local count = caround(i)
    if count > 0 then
        -- Process immediately
    end
end
```

## State Synchronization Issues

### 1. Functions Return Stale Data

#### Problem: Function results don't reflect current game state

**Causes:**
- State not synchronized between workers
- Rapid game state changes
- Worker communication delays

**Solutions:**
```lua
-- Force state refresh before critical checks
wait(50)  -- Small delay to ensure state sync

-- Verify state freshness with timestamps
if $lastSeenPlayerMs then
    local timeSinceLastSeen = os.time() * 1000 - $lastSeenPlayerMs
    if timeSinceLastSeen > 5000 then
        print("Player data may be stale (", timeSinceLastSeen, "ms old)")
    end
end
```

## Script Worker vs Cavebot Context Issues

### 1. Functions Behave Differently in Different Contexts

#### Problem: Same function returns different results in script vs cavebot

**Cause:** Different state synchronization timing between workers

**Solutions:**
```lua
-- Add context identification
if type(skipWaypoint) == "function" then
    print("Running in cavebot context")
else
    print("Running in script worker context")
end

-- Ensure consistent state access
local function waitForValidState()
    local attempts = 0
    while not $pos and attempts < 10 do
        wait(100)
        attempts = attempts + 1
    end
    return $pos ~= nil
end

if waitForValidState() then
    -- Proceed with functions
else
    print("Could not get valid state")
end
```

## Debugging Tools

### 1. Comprehensive State Dump

```lua
function debugState()
    print("=== STATE DEBUG ===")
    print("Online:", $isOnline)
    print("Position:", $pos and ($pos.x..","..$.pos.y..","..$.pos.z) or "nil")
    print("HP/MP:", $hppc or "nil", $mppc or "nil")
    print("Monster count:", $monsterNum or "nil")
    print("Player count:", $playerNum or "nil")
    print("Battle list size:", #($battleList.entries or {}))
    print("Has target:", $target and "yes" or "no")
    print("Has waypoint:", $wpt and "yes" or "no")
    
    -- Test all around functions
    print("caround(1):", caround(1))
    print("paround(1):", paround(1))
    print("maround(1):", maround(1))
    print("wptDistance():", wptDistance())
end

debugState()
```

### 2. Function Test Suite

```lua
function testAllFunctions()
    print("=== FUNCTION TEST ===")
    
    local tests = {
        {name = "caround()", func = function() return caround() end},
        {name = "caround(1)", func = function() return caround(1) end},
        {name = "paround()", func = function() return paround() end},
        {name = "npcaround()", func = function() return npcaround() end},
        {name = "maround()", func = function() return maround() end},
        {name = "maround(1)", func = function() return maround(1) end},
        {name = "wptDistance()", func = function() return wptDistance() end},
    }
    
    for _, test in ipairs(tests) do
        local success, result = pcall(test.func)
        if success then
            print(test.name .. ":", result)
        else
            print(test.name .. ": ERROR -", result)
        end
    end
    
    -- Test isTileReachable with safe coordinates
    if $pos then
        local success, result = pcall(isTileReachable, $pos.x + 1, $pos.y, $pos.z)
        if success then
            print("isTileReachable(+1,0,0):", result)
        else
            print("isTileReachable: ERROR -", result)
        end
    end
end

testAllFunctions()
```

## Common Error Messages

### "attempt to index a nil value"
- **Cause:** Trying to access properties of nil objects
- **Solution:** Add nil checks before accessing properties

```lua
-- BAD
local x = $target.x

-- GOOD
local x = $target and $target.x or nil
```

### "attempt to call a nil value"
- **Cause:** Function not available in current context
- **Solution:** Check function availability

```lua
if type(caround) == "function" then
    local count = caround(1)
else
    print("caround function not available")
end

if type(paround) == "function" then
    local count = paround()
else
    print("paround function not available")
end
```

## Getting Help

If issues persist:

1. **Check Logs:** Look in the bot's log files for error messages
2. **Test in Isolation:** Run individual functions in simple scripts
3. **Verify Game State:** Ensure the bot is properly detecting the game
4. **Update Workers:** Restart the bot to refresh worker connections
5. **Report Bugs:** Include the debug output from the test functions above

## Best Practices for Reliable Scripts

1. **Always validate state before using functions**
2. **Use appropriate error handling**
3. **Cache function results when possible**
4. **Add debug output for troubleshooting**
5. **Test functions individually before combining**
6. **Consider timing and state synchronization**
7. **Understand default vs distance behavior:**
   - `caround()` = all creatures, `caround(1)` = creatures within 1 tile
   - `maround()` = all monsters, `maround(1)` = monsters within 1 tile
   - `paround()` and `npcaround()` always return totals (no distance filtering)

Remember: These functions depend on the bot's ability to detect and track game elements. If the underlying detection isn't working, the functions won't return accurate results.