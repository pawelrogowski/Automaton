# Targeting List Configuration Guide

## Overview

The targeting system uses a priority-based approach to select which creatures to attack. This guide explains how to configure your targeting list for different hunting scenarios.

---

## Understanding Priority & Scoring

### How Targeting Selection Works

The system calculates a **score** for each creature using this formula:

```javascript
score = -priority × 1000 + distance + adjacencyBonus
```

- **Lower score = better target**
- **Priority**: Your configured value (higher priority = much lower score)
- **Distance**: Tiles away from player (0-15 typical range)
- **Adjacency bonus**: -500 if creature is adjacent (next to player)

### Example Score Calculation

```
Dragon:     priority=10, distance=5.2, adjacent=no  → score = -10000 + 5.2 = -9994.8
Rat:        priority=1,  distance=2.1, adjacent=yes → score = -1000 + 2.1 - 500 = -1497.9
Cave Rat:   priority=1,  distance=1.5, adjacent=no  → score = -1000 + 1.5 = -998.5

Selection order: Dragon (-9994.8) → Rat (-1497.9) → Cave Rat (-998.5)
```

**The Dragon wins** despite being farther away because priority difference (10 vs 1) = 9000 points!

---

## Target Switching Rules

### When Does the Bot Switch Targets?

**During SELECTING state (no current target):**
- Selects the creature with the **lowest score** (best overall)

**During ENGAGING state (already fighting):**
- **Hysteresis**: Only switches if new target is **10+ points better**
- **Priority threshold**: Only preempts if new priority is **2+ levels higher**

### What This Means

```
Current target: Rat (priority 5, score -4995)
New creature appears: Another Rat (priority 5, score -4997)
→ Score difference = 2 points (< 10) → KEEP current target ✅

New creature appears: Dragon (priority 10, score -9995)
→ Priority difference = 5 (≥ 2) → SWITCH to Dragon ✅
```

---

## Configuration Properties

### Rule Structure

```javascript
{
  name: "Creature Name",    // Exact creature name (or "Others" for wildcard)
  action: "Attack",          // Always "Attack" for targeting
  priority: 10,              // 1-100, higher = more important
  stance: "Follow",          // "Follow", "Stand", or "Chase"
  onlyIfTrapped: false,      // true = only target if blocking your path
  danger: 1                  // Cosmetic, not used in logic
}
```

### Property Details

**name:**
- Must match creature name exactly (case-sensitive)
- Special value: `"Others"` = wildcard for any creature not explicitly listed
- Examples: `"Troll"`, `"Cave Rat"`, `"Ancient Scarab"`

**priority:**
- Range: 1-100 (typically use 1-20 for clarity)
- Higher = more important
- **Difference matters:** Gap of 2+ needed to preempt current target
- **Recommendation:** Use gaps of 3-5 between different threat levels

**stance:**
- `"Follow"`: Move towards creature and attack
- `"Stand"`: Attack only if adjacent, don't move
- `"Chase"`: Move towards creature aggressively (same as Follow currently)

**onlyIfTrapped:**
- `true`: Only attack if creature is blocking your path
- `false`: Attack normally based on priority
- **Use case:** Low priority creatures you only kill if they're in the way

---

## Example Configurations

### Example 1: Always Target Specific Monster First

**Scenario:** You're hunting Dragons, but want to kill any Rats on the way.

```javascript
[
  {
    name: "Dragon",
    action: "Attack",
    priority: 10,      // Much higher priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Rat",
    action: "Attack",
    priority: 3,       // Lower priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  }
]
```

**Behavior:**
- ✅ Bot prioritizes Dragons over Rats (priority 10 vs 3 = 7 point difference)
- ✅ If fighting a Rat and Dragon appears → switches to Dragon (7 ≥ 2 threshold)
- ✅ If no Dragons nearby → kills Rats
- ✅ Dragons are attacked even from 10+ tiles away

---

### Example 2: Finish Adjacent Monsters First

**Scenario:** Dragons are priority, but if a Rat is adjacent, finish it first (avoid damage).

```javascript
[
  {
    name: "Dragon",
    action: "Attack",
    priority: 10,
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Rat",
    action: "Attack",
    priority: 9,       // Only 1 less than Dragon!
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  }
]
```

**Why this works:**

```
Scenario A: Dragon at 5 tiles, Rat at 2 tiles (not adjacent)
Dragon score: -10000 + 5 = -9995
Rat score:    -9000 + 2 = -8998
→ Dragon wins (-9995 < -8998) ✅

Scenario B: Dragon at 5 tiles, Rat at 1 tile (adjacent)
Dragon score: -10000 + 5 = -9995
Rat score:    -9000 + 1 - 500 = -9499 (adjacency bonus!)
→ Rat wins (-9499 < -9995) ✅
```

**Behavior:**
- ✅ Adjacent Rats get -500 bonus, making them better than distant Dragons
- ✅ Non-adjacent Rats are ignored if Dragons are around
- ✅ Once Rat is killed, switches to Dragon
- ⚠️ **Won't preempt** if already fighting Dragon (priority difference = 1 < 2 threshold)

---

### Example 3: Finish Adjacent, But Preempt for High Priority

**Scenario:** Kill adjacent weak monsters, but always switch to Dragons.

```javascript
[
  {
    name: "Dragon",
    action: "Attack",
    priority: 15,      // Very high priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Demon",
    action: "Attack",
    priority: 12,      // High priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Troll",
    action: "Attack",
    priority: 8,       // Medium priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Rat",
    action: "Attack",
    priority: 5,       // Low priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  }
]
```

**Behavior:**
```
Fighting Rat (adjacent, priority 5)
Troll appears (not adjacent, priority 8)
→ Priority difference = 3 (≥ 2) → Switches to Troll ✅

Fighting Troll (priority 8)
Dragon appears (priority 15)
→ Priority difference = 7 (≥ 2) → Switches to Dragon ✅

Fighting Dragon (priority 15)
Demon appears (priority 12)
→ Priority difference = -3 (< 2) → Keeps Dragon ✅
```

---

### Example 4: Only Kill If Blocking Path

**Scenario:** Ignore Rats unless they're blocking your cavebot route.

```javascript
[
  {
    name: "Dragon",
    action: "Attack",
    priority: 10,
    stance: "Follow",
    onlyIfTrapped: false,    // Always kill Dragons
    danger: 1
  },
  {
    name: "Rat",
    action: "Attack",
    priority: 3,
    stance: "Follow",
    onlyIfTrapped: true,     // Only kill if blocking
    danger: 1
  }
]
```

**Behavior:**
- ✅ Rats are ignored unless they're on your path (detected by pathfinder)
- ✅ If Rat blocks path → gets `isBlockingPath` flag → becomes targetable
- ✅ Dragons are always attacked regardless of position

---

### Example 5: Stand and Fight (Don't Chase)

**Scenario:** Attack Dragons only if they come close, don't walk towards them.

```javascript
[
  {
    name: "Dragon",
    action: "Attack",
    priority: 10,
    stance: "Stand",         // Don't move towards them
    onlyIfTrapped: false,
    danger: 1
  }
]
```

**Behavior:**
- ✅ Dragons are selected as targets
- ✅ Bot acquires them (clicks on them)
- ✅ Bot does NOT move towards them
- ✅ If Dragon walks into melee range → bot attacks
- ⚠️ This is rarely useful (bot just stands still)

---

### Example 6: Wildcard "Others" Rule

**Scenario:** Kill specific creatures with priority, but also kill anything else at low priority.

```javascript
[
  {
    name: "Dragon",
    action: "Attack",
    priority: 10,
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Demon",
    action: "Attack",
    priority: 8,
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Others",          // Wildcard for everything else
    action: "Attack",
    priority: 3,             // Low priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  }
]
```

**Behavior:**
- ✅ Dragons and Demons get their specific priorities (10 and 8)
- ✅ Any other creature (Rats, Trolls, etc.) uses "Others" rule (priority 3)
- ✅ Specific rules override "Others" wildcard
- ✅ Unknown creatures are still attacked (at low priority)

---

### Example 7: Balanced Multi-Creature Hunting

**Scenario:** Hunting area with multiple creature types, prioritize dangerous ones but don't ignore others.

```javascript
[
  {
    name: "Dragon Lord",
    action: "Attack",
    priority: 15,            // Highest - extremely dangerous
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Dragon",
    action: "Attack",
    priority: 12,            // High priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Demon",
    action: "Attack",
    priority: 10,            // High priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Giant Spider",
    action: "Attack",
    priority: 7,             // Medium priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Dwarf Guard",
    action: "Attack",
    priority: 5,             // Lower priority
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  {
    name: "Rat",
    action: "Attack",
    priority: 2,             // Very low priority
    stance: "Follow",
    onlyIfTrapped: true,     // Only if blocking
    danger: 1
  }
]
```

**Behavior:**
- ✅ Dragon Lords always take precedence (priority 15)
- ✅ Dragons and Demons are next (priority 12, 10)
- ✅ Giant Spiders and Dwarf Guards are killed if no high-priority targets
- ✅ Rats only killed if blocking path
- ✅ Adjacent creatures get preference due to -500 bonus
- ✅ Priority gaps of 2-3 allow for smooth transitions

---

## Priority Recommendations

### Priority Tiers (Suggested Values)

```
Critical/Boss monsters:  15-20
Very dangerous:          12-14
Dangerous:               9-11
Medium threat:           6-8
Low threat:              3-5
Trash/blocked only:      1-2
```

### Priority Gap Guidelines

**Gap of 1:**
- Adjacent creature can override distant target
- Won't preempt if already engaged
- **Use for:** Similar threat levels

**Gap of 2:**
- Minimum for preemption during combat
- **Use for:** Slightly different threat levels

**Gap of 3-5:**
- Clear priority difference
- **Use for:** Different threat categories

**Gap of 6+:**
- Dominant priority, almost always switches
- **Use for:** Boss vs normal monsters

---

## Common Patterns

### Pattern 1: "Safe Hunting"
Kill everything, prioritize dangerous ones:
```javascript
priority: Dangerous=10, Medium=7, Weak=4, Trash=1 (onlyIfTrapped)
```

### Pattern 2: "Speed Hunting"
Only kill valuable creatures:
```javascript
priority: Target=10, Others=1 (onlyIfTrapped=true)
```

### Pattern 3: "Boss Focus"
Always prioritize boss, but clean up adds:
```javascript
priority: Boss=20, Adds=8, Trash=3
```

### Pattern 4: "Adjacent First"
Clean up close threats before distant ones:
```javascript
priority: All creatures within 1-2 of each other
// Adjacency bonus (-500) determines actual target
```

---

## Testing Your Configuration

### Check Your Setup

1. **Priority gaps:** Ensure 2+ gap between different threat levels
2. **Wildcard coverage:** Add "Others" rule if you want to attack unknown creatures
3. **Adjacency consideration:** Use similar priorities (gap of 1) if you want adjacent preference
4. **Blocking logic:** Use `onlyIfTrapped: true` for low-priority trash

### Watch for These Issues

❌ **Random switching:** Priority gaps too small (< 2)
❌ **Ignoring creatures:** Missing "Others" rule and creature not in list
❌ **Not switching to important targets:** Priority gap too small
❌ **Chasing low priority monsters:** Their priority too high or missing `onlyIfTrapped`

---

## Advanced: Score Calculation Examples

### Scenario: Three Creatures Available

```javascript
Configuration:
- Dragon:  priority=10
- Demon:   priority=8  
- Rat:     priority=5

Positions:
- Dragon:  8 tiles away, not adjacent
- Demon:   3 tiles away, not adjacent
- Rat:     1 tile away, adjacent

Scores:
Dragon: -10×1000 + 8 + 0     = -9992
Demon:  -8×1000 + 3 + 0      = -7997
Rat:    -5×1000 + 1 - 500    = -5499

Selection: Dragon (-9992) ✅
```

**The Dragon wins** despite being farthest because priority dominates the score.

### Scenario: Adjacent vs Distance

```javascript
Configuration:
- Troll A: priority=5
- Troll B: priority=5

Positions:
- Troll A: 2 tiles away, adjacent
- Troll B: 1.5 tiles away, not adjacent

Scores:
Troll A: -5×1000 + 2 - 500   = -5498
Troll B: -5×1000 + 1.5 + 0   = -4998.5

Selection: Troll A (-5498) ✅
```

**Troll A wins** because adjacency bonus (-500) is huge compared to 0.5 tile difference.

---

## Troubleshooting

### "Bot keeps switching between same priority creatures"
**Solution:** This should be fixed by the hysteresis system. Score difference must be 10+ points.

### "Bot ignores high priority creature"
**Check:** 
1. Is priority difference ≥ 2? (needed to preempt)
2. Is creature in targeting list?
3. Is creature marked as reachable?

### "Bot kills everything instead of just target"
**Solution:** 
- Remove "Others" wildcard rule
- Set low-priority creatures to `onlyIfTrapped: true`
- Lower their priority to 1-2

### "Bot doesn't attack adjacent weak monsters"
**Solution:**
- Use priority gap of 1 between target and weak monsters
- Adjacency bonus (-500) will make adjacent ones win

---

## Template: Copy & Customize

```javascript
[
  // High priority boss/rare
  {
    name: "Boss Name",
    action: "Attack",
    priority: 15,
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  
  // Main hunting target
  {
    name: "Target Creature",
    action: "Attack",
    priority: 10,
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  
  // Secondary creatures
  {
    name: "Secondary Creature",
    action: "Attack",
    priority: 7,
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  },
  
  // Trash mobs (only if blocking)
  {
    name: "Trash Mob",
    action: "Attack",
    priority: 2,
    stance: "Follow",
    onlyIfTrapped: true,
    danger: 1
  },
  
  // Wildcard for anything else
  {
    name: "Others",
    action: "Attack",
    priority: 3,
    stance: "Follow",
    onlyIfTrapped: false,
    danger: 1
  }
]
```

---

## Summary

### Key Takeaways

1. **Priority is king:** Difference of 1000 points per priority level
2. **Adjacency matters:** -500 point bonus for adjacent creatures
3. **Hysteresis prevents switching:** Need 10+ point improvement to switch
4. **Preemption threshold:** Need 2+ priority levels to interrupt combat
5. **Distance is minor:** 0-15 points, only matters for equal priority

### Best Practices

✅ Use priority gaps of 3-5 between threat categories
✅ Use priority gap of 1 if you want adjacency to decide
✅ Use `onlyIfTrapped: true` for trash mobs
✅ Include "Others" wildcard for unknown creatures
✅ Test your configuration in safe areas first

---

**Happy hunting!** 🎯
