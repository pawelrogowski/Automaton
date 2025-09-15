-- Automaton Lua API Test Script
-- This script tests all the new and fixed Lua API functions
-- Run this script to verify that your Lua API implementation is working correctly

print("=== Automaton Lua API Test Suite ===")
print("Testing all new and fixed functions...")

-- Test 1: Basic state access
print("\n1. Testing basic state access:")
print("Current HP%:", $hppc or "nil")
print("Current MP%:", $mppc or "nil")
print("Player position:", $pos and ($pos.x .. "," .. $pos.y .. "," .. $pos.z) or "nil")
print("Character name:", $characterName or "nil")
print("Is online:", $isOnline and "true" or "false")

-- Test 2: Target information
print("\n2. Testing target information:")
if $target then
    print("Target name:", $target.name)
    print("Target coordinates:", $target.x .. "," .. $target.y .. "," .. $target.z)
    print("Target distance:", $target.distance)
    print("Target abs coords:", $target.abs.x .. "," .. $target.abs.y)
else
    print("No target selected")
end

-- Test 3: Waypoint distance
print("\n3. Testing wptDistance():")
local wptDist = wptDistance()
print("Distance to current waypoint:", wptDist, "tiles")

if $wpt then
    print("Current waypoint:", $wpt.id, "at", $wpt.x .. "," .. $wpt.y .. "," .. $wpt.z)
    print("Waypoint label:", $wpt.label or "none")
    print("Waypoint type:", $wpt.type or "unknown")
else
    print("No active waypoint")
end

-- Test 4: Creature counting functions
print("\n4. Testing creature counting functions:")

-- Test functions without distance parameters (should return all/total)
print("Total counts (no distance specified):")
print("  All creatures (caround):", caround())
print("  All monsters (maround):", maround())
print("  Players on screen (paround):", paround())
print("  NPCs on screen (npcaround):", npcaround())

-- Test distance-based counts for caround only (maround doesn't support distance)
print("\nDistance-based counts (caround only):")
for dist = 1, 3 do
    print("Distance " .. dist .. ":")
    print("  Creatures around (caround):", caround(dist))
end

-- Show that maround doesn't change with distance attempts
print("\nNote: maround() always returns total battle list count:")
print("  maround():", maround())
-- Test 5: Battle list and player information
print("\n5. Testing battle list and player information:")
print("Monster count ($monsterNum):", $monsterNum)
print("Player count ($playerNum):", $playerNum)
print("NPC count ($npcNum):", $npcNum)
print("Battle list entries:", #($battleList.entries or {}))

if $players and #$players > 0 then
    print("Visible players:")
    for i, player in ipairs($players) do
        if i <= 3 then -- Show max 3 players
            print("  " .. i .. ". " .. player)
        end
    end
    if #$players > 3 then
        print("  ... and " .. (#$players - 3) .. " more")
    end
else
    print("No players visible")
end

-- Test 6: Tile reachability (async function)
print("\n6. Testing isTileReachable() function:")
if $pos then
    local playerX, playerY, playerZ = $pos.x, $pos.y, $pos.z

    -- Test adjacent tiles
    print("Testing reachability of adjacent tiles:")

    -- Test tile to the north
    local northReachable = isTileReachable(playerX, playerY - 1, playerZ)
    print("  North tile:", northReachable and "reachable" or "not reachable")

    -- Test tile to the east
    local eastReachable = isTileReachable(playerX + 1, playerY, playerZ)
    print("  East tile:", eastReachable and "reachable" or "not reachable")

    -- Test a distant tile (should test pathfinding)
    local distantReachable = isTileReachable(playerX + 10, playerY + 10, playerZ)
    print("  Distant tile (+10,+10):", distantReachable and "reachable" or "not reachable")

    -- Test a very distant tile (should return false due to 50-tile limit)
    local veryDistantReachable = isTileReachable(playerX + 60, playerY + 60, playerZ)
    print("  Very distant tile (+60,+60):", veryDistantReachable and "reachable" or "not reachable")

    -- Test different floor
    local differentFloorReachable = isTileReachable(playerX, playerY, playerZ + 1)
    print("  Different floor:", differentFloorReachable and "reachable" or "not reachable")
else
    print("Cannot test reachability - player position unknown")
end

-- Test 7: Distance calculation function
print("\n7. Testing getDistanceTo() function:")
if $pos then
    local playerX, playerY, playerZ = $pos.x, $pos.y, $pos.z

    -- Test distance to adjacent tiles
    print("Distance to north tile:", getDistanceTo(playerX, playerY - 1, playerZ))
    print("Distance to northeast tile:", getDistanceTo(playerX + 1, playerY - 1, playerZ))
    print("Distance to distant tile:", getDistanceTo(playerX + 5, playerY + 5, playerZ))
    print("Distance to different floor:", getDistanceTo(playerX, playerY, playerZ + 1))
end

-- Test 8: Location testing
print("\n8. Testing isLocation() function:")
print("At current waypoint (range 0):", isLocation(0) and "true" or "false")
print("At current waypoint (range 1):", isLocation(1) and "true" or "false")
print("At current waypoint (range 2):", isLocation(2) and "true" or "false")

-- Test 9: Bot state information
print("\n9. Testing bot state:")
print("Cavebot enabled:", $cavebot and "true" or "false")
print("Targeting enabled:", $targeting and "true" or "false")
print("Healing enabled:", $healing and "true" or "false")
print("Scripts enabled:", $scripts and "true" or "false")
print("Current section:", $section or "none")
print("Last label:", $lastLabel or "none")

-- Test 10: Character status
print("\n10. Testing character status:")
print("Poisoned:", $poisoned and "true" or "false")
print("Hasted:", $hasted and "true" or "false")
print("Magic shield:", $magicShield and "true" or "false")
print("In PZ:", $inProtectedZone and "true" or "false")

-- Test 11: Stand time
print("\n11. Testing stand time:")
print("Stand time:", $standTime, "ms")

-- Test 12: Error handling
print("\n12. Testing error handling:")
print("Testing invalid parameters:")
print("  caround(-1):", caround(-1))  -- Should return 0
print("  caround('invalid'):", caround('invalid'))  -- Should return 0
print("  isTileReachable(nil, nil, nil):", isTileReachable(nil, nil, nil))  -- Should return false

-- Test 13: Performance test
print("\n13. Performance test:")
local startTime = os.clock()
for i = 1, 100 do
    local _ = caround()    -- Test default behavior
    local _ = caround(1)   -- Test distance behavior
    local _ = paround()
    local _ = wptDistance()
end
local endTime = os.clock()
print("100 function calls took:", (endTime - startTime) * 1000, "ms")

print("\n=== Test Suite Complete ===")
print("If you see this message, all basic function calls completed without errors.")
print("Check the output above to verify the functions return expected values.")
print("Note: Some functions may return 0 or default values if:")
print("- No creatures detected (caround)")
print("- No monsters in battle list (maround)")
print("- No players/NPCs visible on screen (paround/npcaround)")
print("- No waypoint is active (wptDistance)")
print("- Player is not online")
print("- Required game state is not available")
print("\nFunction behavior:")
print("- caround() = all detected creatures")
print("- caround(1) = creatures within 1 tile")
print("- maround() = all battle list entries")
print("- maround(1) = battle list entries within 1 tile")
