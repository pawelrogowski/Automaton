# Lua API Usage Guide - New Functions

This guide provides practical examples and usage patterns for the newly implemented Lua API functions in Automaton.

## Quick Reference

| Function | Purpose | Returns |
|----------|---------|---------|
| `caround(distance)` | Count creatures (all if no distance, within distance if specified) | Number |
| `paround()` | Count total visible players | Number |
| `npcaround()` | Count total visible NPCs | Number |
| `maround()` | Count total battle list monsters | Number |
| `wptDistance()` | Distance to current waypoint | Number |
| `isTileReachable(x,y,z)` | Check if tile is pathfindable | Boolean |
| `$target.x/y/z` | Current target coordinates | Number |

## Creature Detection Functions

### `caround(distance)` - Creature Count
Counts creatures detected by the creature monitor. Without distance parameter, returns all detected creatures. With distance parameter, returns only creatures within that distance.

**Basic Usage:**
```lua
-- Check total detected creatures
if caround() > 0 then
    print("Creatures detected!")
end

-- Check for any creatures adjacent to player (distance 1)
if caround(1) > 0 then
    print("Creatures nearby!")
end

-- Check within 3 tiles
local nearbyCreatures = caround(3)
if nearbyCreatures >= 2 then
    print("Multiple creatures detected within 3 tiles:", nearbyCreatures)
end
```

**Practical Examples:**
```lua
-- Check if any creatures are detected at all
local totalCreatures = caround()
if totalCreatures > 0 then
    print("Total creatures detected:", totalCreatures)
end

-- Safety check before using AOE spells (close creatures)
if caround(2) >= 3 then
    keyPress('F5')  -- Cast AOE spell
    wait(2000)
end

-- Alert when surrounded (adjacent tiles only)
if caround(1) >= 4 then
    print("WARNING: Surrounded by creatures!")
    alert()
end

-- Different strategies based on creature distribution
local allCreatures = caround()
local nearbyCreatures = caround(2)
if allCreatures > 5 and nearbyCreatures < 2 then
    print("Many creatures detected but not close - safe to move")
end
```

### `paround()` - Player Count
Returns the total number of players currently visible on screen.

**Basic Usage:**
```lua
-- Check if other players are visible
if paround() > 0 then
    print("Players detected on screen")
    pauseTargeting(5000)  -- Pause targeting for 5 seconds
end
```

**Practical Examples:**
```lua
-- PKers protection
if paround() > 0 and not $inProtectedZone then
    print("Players detected - moving to safe zone")
    goToSection("SafeZone")
end

-- Party coordination
local visiblePlayers = paround()
if visiblePlayers > 1 then -- More than just yourself
    print("Other players visible - being cautious")
    pauseActions(true)
end
```

### `npcaround()` - NPC Count
Returns the total number of NPCs currently visible on screen.

**Basic Usage:**
```lua
-- Check if NPCs are visible
if npcaround() > 0 then
    print("NPCs detected on screen")
end
```

**Practical Examples:**
```lua
-- Wait for NPC to appear
local attempts = 0
while npcaround() == 0 and attempts < 10 do
    print("Waiting for NPC...")
    wait(1000)
    attempts = attempts + 1
end

-- Trading logic
if npcaround() > 0 then
    print("NPCs available for trading")
    -- Perform trading actions
end
```

### `maround()` - Monster Count
Returns the total number of monsters currently in the battle list. Battle list entries don't have coordinate data, so no distance filtering is possible.

**Basic Usage:**
```lua
-- Check battle list monsters
local monsters = maround()
if monsters > 0 then
    print("Total monsters in battle list:", monsters)
end
```

**Practical Examples:**
```lua
-- Adjust strategy based on battle list size
local monsters = maround()
if monsters >= 5 then
    print("High monster count - using defensive strategy")
    keyPress('F8')  -- Use AOE or defensive spell
elseif monsters >= 1 then
    print("Monsters present - engaging")
    keyPress('F3')  -- Use attack
end

-- Safety check
if monsters > 15 then
    print("Too many monsters in battle list - retreating")
    keyPress('F12')  -- Emergency escape
end
```

## Distance and Pathfinding Functions

### `wptDistance()` - Waypoint Distance
Returns Chebyshev distance to current waypoint.

**Basic Usage:**
```lua
local dist = wptDistance()
if dist == 0 then
    print("Standing on waypoint")
elseif dist == 1 then
    print("Next to waypoint")
else
    print("Distance to waypoint:", dist, "tiles")
end
```

**Practical Examples:**
```lua
-- Wait until close to waypoint before action
if wptDistance() <= 2 then
    -- Perform waypoint-specific action
    keyPress('F6')  -- Use potion
    wait(1000)
end

-- Skip waypoint if too far (pathfinding issues)
if wptDistance() > 20 then
    print("Waypoint too far - skipping")
    skipWaypoint()
end
```

### `isTileReachable(x, y, z)` - Pathfinding Check
Checks if a tile can be reached by pathfinding.

-- Check adjacent tiles (very fast check)
if isTileReachable($pos.x + 1, $pos.y, $pos.z) then
    print("Can move east")
end
```

**Practical Examples:**
```lua
-- Advanced pathfinding validation before attacking
if $target then
    local canReach = isTileReachable($target.x, $target.y, $target.z)
    if canReach then
        print("Target is reachable via pathfinding")
        -- Proceed with attack
    else
        print("Target blocked by walls/obstacles - retargeting")
        setTargeting(false)
        wait(500)
        setTargeting(true)
    end
end

-- Smart waypoint validation using actual map data
if $wpt then
    if not isTileReachable($wpt.x, $wpt.y, $wpt.z) then
        print("Pathfinder confirms waypoint unreachable - skipping")
        skipWaypoint()
    end
end

-- Escape route validation with real pathfinding
local safeSpots = {
    {x = $pos.x - 10, y = $pos.y, z = $pos.z},
    {x = $pos.x + 10, y = $pos.y, z = $pos.z},
    {x = $pos.x, y = $pos.y - 10, z = $pos.z},
    {x = $pos.x, y = $pos.y + 10, z = $pos.z}
}

if $hppc < 30 then
    local foundEscape = false
    for _, spot in ipairs(safeSpots) do
        if isTileReachable(spot.x, spot.y, spot.z) then
            print("Escape route found - moving to safety")
            mapClick(spot.x, spot.y)
            foundEscape = true
            break
        end
    end
    
    if not foundEscape then
        print("All escape routes blocked!")
        keyPress('F12')  -- Emergency teleport
    end
end
```

## Target Information

### Fixed `$target.x/y/z` Properties
Target coordinates now work correctly.

**Basic Usage:**
```lua
if $target then
    print("Target:", $target.name)
    print("Position:", $target.x, $target.y, $target.z)
    print("Distance:", $target.distance)
    
    -- Use absolute coordinates for clicking
    clickAbsolute('left', $target.abs.x, $target.abs.y)
end
```

**Practical Examples:**
```lua
-- Attack target if close enough
if $target and $target.distance <= 5 then
    if isTileReachable($target.x, $target.y, $target.z) then
        clickTile('left', $target.x, $target.y)
    end
end

-- Track target movement
local lastTargetPos = nil
if $target then
    local currentPos = {x = $target.x, y = $target.y, z = $target.z}
    if lastTargetPos and 
       (lastTargetPos.x ~= currentPos.x or 
        lastTargetPos.y ~= currentPos.y) then
        print("Target moved!")
    end
    lastTargetPos = currentPos
end
```

## Complete Example Scripts

### 1. Smart AOE Attack Script
```lua
-- Use AOE spells when multiple creatures are close
local creatures = caround(2)
local players = paround()

-- Only use AOE if safe from players
if creatures >= 3 and players == 0 and $mppc > 50 then
    keyPress('F9')  -- AOE spell
    wait(2000)
    print("AOE cast on", creatures, "creatures")
end
```

### 2. Safety Monitoring Script
```lua
-- Monitor surroundings for safety
local monsters = maround()
local nearbyCreatures = caround(3)
local adjacentCreatures = caround(1)
local players = paround()
local distToWpt = wptDistance()

if adjacentCreatures > 8 then
    print("DANGER: Too many adjacent creatures!")
    keyPress('F12')  -- Emergency escape
elseif monsters > 15 then
    print("High monster count in battle list - being careful")
elseif players > 0 and not $inProtectedZone then
    print("Players detected - being cautious")
    pauseTargeting(10000)
elseif distToWpt > 25 then
    print("Too far from waypoint - may be stuck")
    skipWaypoint()
end
```

### 3. Target Validation Script
```lua
-- Validate target before attacking
if $target then
    local canReach = isTileReachable($target.x, $target.y, $target.z)
    local distance = $target.distance
    
    if not canReach then
        print("Target not reachable - switching")
        -- Force retarget
        setTargeting(false)
        wait(500)
        setTargeting(true)
    elseif distance <= 1 then
        print("Target adjacent - using melee")
        keyPress('Space')  -- Attack
    elseif distance <= 5 then
        print("Target in range - using ranged")
        keyPress('F3')  -- Ranged attack
    else
        print("Target too far:", distance)
    end
end
```

### 4. Party Coordination Script
```lua
-- Wait for party members and coordinate actions
local visiblePlayers = paround()
local expectedParty = $partyNum

if expectedParty > 1 then
    if visiblePlayers < expectedParty then
        print("Waiting for party members...")
        pauseActions(true)
        wait(2000)
    else
        print("Party members visible - resuming")
        pauseActions(false)
        
        -- Leader uses AOE if monsters present
        if $characterName == "LeaderName" and maround() >= 2 then
            keyPress('F8')  -- AOE spell
        end
    end
end
```

## Performance Tips

1. **Cache Results**: Don't call functions repeatedly in tight loops
```lua
-- Good
local creatures = caround(3)  -- Creatures within 3 tiles
local allCreatures = caround()  -- All detected creatures
local players = paround()
if creatures > 0 then
    -- use variables multiple times
end

-- Bad
if caround(3) > 0 and caround(3) < 5 then  -- Called twice
```

2. **Use Appropriate Distances**: Check total first, then narrow down for efficiency
```lua
-- Check total creatures first, then narrow down
local totalCreatures = caround()
if totalCreatures > 0 then
    local adjacentCreatures = caround(1)
    if adjacentCreatures > 0 then
        -- Handle immediate threats
    elseif caround(3) > 0 then
        -- Handle nearby threats
    end
end
```

3. **Combine Checks**: Use logical operators efficiently
```lua
-- Efficient combined check
if caround(2) > 0 and $mppc > 30 and paround() == 0 then
    keyPress('F5')  -- Safe to use spell
end

-- Check totals vs specific distances efficiently
local totalCreatures = caround()
if totalCreatures > 0 and totalCreatures < 10 then
    local nearbyCreatures = caround(2)
    -- Only check distance if reasonable total count
end
```

## Error Handling

Always handle cases where functions might return unexpected values:

```lua
-- Safe distance checking
local allCreatures = caround()
local nearbyCreatures = caround(3)
if allCreatures and allCreatures > 0 then
    print("Found", allCreatures, "total creatures,", nearbyCreatures, "within 3 tiles")
else
    print("No creatures or error detecting")
end

-- Safe reachability checking
local pos = $pos
if pos then
    local reachable = isTileReachable(pos.x + 1, pos.y, pos.z)
    if reachable then
        print("Can move east")
    else
        print("Cannot move east")
    end
else
    print("Player position unknown")
end
```

## Integration with Existing Bot Features

### With Cavebot
```lua
-- Use in waypoint scripts
if wptDistance() <= 1 then
    local nearbyCreatures = caround(3)
    if nearbyCreatures == 0 then
        -- Safe to perform waypoint action
        keyPress('F6')
        skipWaypoint()
    else
        print("Waiting for", nearbyCreatures, "creatures to clear")
    end
end
```

### With Targeting
```lua
-- Enhance targeting decisions
if $target and not isTileReachable($target.x, $target.y, $target.z) then
    -- Force retarget if current target unreachable
    setTargeting(false)
    wait(100)
    setTargeting(true)
end
```

### With Healing Rules
```lua
-- Dynamic healing based on surroundings
local immediateThreats = caround(1) + maround(1)
local nearbyThreats = caround(3) + maround(3)

if $hppc < 80 and immediateThreats > 3 then
    keyPress('F1')  -- Emergency heal - immediate danger
elseif $hppc < 60 and nearbyThreats > 5 then
    keyPress('F2')  -- Preventive heal - many threats nearby
elseif $hppc < 40 then
    keyPress('F1')  -- Standard emergency heal
end
```

This guide covers the most common usage patterns. Experiment with different combinations to create powerful automation scripts tailored to your specific needs.