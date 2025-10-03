# "Others" Wildcard Targeting

## Overview

The targeting system now supports a special wildcard entry called "Others" (case-insensitive) that acts as a catch-all fallback for creatures that don't have explicit targeting rules defined.

## Usage

Add a targeting rule with the name "Others" or "others" to your targeting list. This rule will match any creature that:
1. Appears in the game world
2. Does NOT have an explicit targeting rule defined
3. Meets the standard reachability and stance requirements

## Example Configuration

```javascript
targetingList: [
  {
    name: "Dragon",
    action: "Attack",
    priority: 10,
    stance: "Follow",
    distance: 1,
    onlyIfTrapped: false
  },
  {
    name: "Dragon Lord",
    action: "Attack", 
    priority: 9,
    stance: "Follow",
    distance: 1,
    onlyIfTrapped: false
  },
  {
    name: "Others",
    action: "Attack",
    priority: 1,  // Lower priority than specific creatures
    stance: "Follow",
    distance: 1,
    onlyIfTrapped: false
  }
]
```

## How It Works

In the example above:
- **Dragon** and **Dragon Lord** will be targeted with their specific priorities (10 and 9)
- Any **other creature** that appears (e.g., "Demon", "Hydra", "Rat") will be targeted using the "Others" rule with priority 1
- Creatures with explicit rules are ALWAYS preferred over "Others" matches

## Priority Behavior

The "Others" rule respects the standard priority system:
- Higher priority values = more important targets
- If you set "Others" to priority 10 and "Dragon" to priority 5, the system will prefer unknown creatures over Dragons
- Typically, you want "Others" at a LOW priority (1-3) as a fallback

## Use Cases

1. **General Hunting**: Target specific valuable creatures with high priority, everything else with low priority
2. **Safety**: Set "Others" to ensure you always fight back if attacked by an unexpected creature
3. **Exploration**: Attack anything you encounter while still prioritizing specific targets

## Technical Details

- The "Others" matching is case-insensitive ("Others", "others", "OTHERS" all work)
- The creature's actual name is used for battle list lookups and targeting
- All targeting settings (stance, distance, onlyIfTrapped) work normally with "Others"
- Game world click targeting and battle list clicking both work with "Others"

## Limitations

- "Others" only works for the "Attack" action
- If a creature name appears in the targeting list, it will NEVER match "Others", even if it has action="Ignore"
- Battle list truncation (e.g., "troll trained sala...") is handled automatically
