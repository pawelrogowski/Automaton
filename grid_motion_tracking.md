
# Grid-Based Scroll and Creature Movement Tracking in 2D Tile-Based Games

This document describes an efficient algorithm for tracking scrolling (viewport movement) and tile-based creature movement in 2D games such as Tibia. The method is designed for **minimal CPU usage**, robustness in the presence of **animated effects and temporary occlusions**, and does **not rely on static background landmarks**.

---

## Problem Overview

In the game world:

- The viewport shows a **fixed tile grid** (e.g., 15×12 visible tiles).
- The **player stays centered** while the world scrolls during movement.
- Creatures move **tile-by-tile**, but their animation occurs smoothly between tile centers.
- Any tile may be temporarily obscured by particle effects (explosions, spells, etc.).

We need to detect:

1. **When the player moves one tile** (scroll displacement detection).
2. **How far each creature has progressed between tiles** (animation progress).

The key problem is determining **continuous scroll offset** of the viewport **without relying on static visual landmarks**.

---

## Key Insight

All motion of the game world during player movement is **global**. If we compute the **global motion vector** (how the entire frame shifted), we can determine tile movement events exactly.

We maintain two continuous offsets:

```
TILE_OFFSET_X
TILE_OFFSET_Y
```

These represent how far the scroll has progressed within a tile size.

Once the offset passes ±(TILE_SIZE / 2), a **tile step** occurred.

---

## Algorithm Summary

### 1. Preprocessing

- Convert the raw BGRA frame to **one-channel grayscale** using a cheap operation (e.g., use the green channel).
- **Downsample** the frame (e.g., by a factor of 8) to greatly reduce computation.

Example resolution change:

```
1920×1200 → 240×150
```

### 2. Divide Into Blocks

Split the downsampled frame into a grid of blocks, e.g.:

```
BLOCKS_X = 12
BLOCKS_Y = 8
```

Each block may be ~20×20 pixels.

### 3. Block Matching for Motion Detection

For each block, find the best `(dx, dy)` shift that minimizes the **Sum of Absolute Differences (SAD)** against the previous frame's corresponding block.

To keep the algorithm lightweight, search only a small region:

```
dx, dy ∈ [-SEARCH_RANGE .. +SEARCH_RANGE]
SEARCH_RANGE = 3   # typically enough for smooth scrolling animation
```

This yields **many displacement candidates**, one per block:

```
(dx₁, dy₁), (dx₂, dy₂), ..., (dxₙ, dyₙ)
```

### 4. Robust Motion Estimation

Some blocks may be occluded by explosions, spells, etc. Those blocks will produce incorrect displacement vectors.

To handle this, compute:

```
global_dx = median(all dxᵢ)
global_dy = median(all dyᵢ)
```

Median is resistant to outliers → no need for static map tiles.

### 5. Accumulate Scroll Offset

```
TILE_OFFSET_X += global_dx
TILE_OFFSET_Y += global_dy
```

### 6. Detect Tile Steps

If offsets exceed half a tile size:

```
if TILE_OFFSET_X > TILE_SIZE / 2:
    player moved east
    TILE_OFFSET_X -= TILE_SIZE

if TILE_OFFSET_X < -TILE_SIZE / 2:
    player moved west
    TILE_OFFSET_X += TILE_SIZE

(similar for Y movement)
```

### 7. Detect Creature Movement Progress

For a creature located at map coordinate `(gx, gy)` relative to the viewport center:

```
expected_center_x = VIEWPORT_CENTER_X + (gx * TILE_SIZE) + TILE_OFFSET_X
expected_center_y = VIEWPORT_CENTER_Y + (gy * TILE_SIZE) + TILE_OFFSET_Y
```

If the sprite is observed at `(px, py)`:

```
move_progress_x = (px - expected_center_x) / TILE_SIZE
move_progress_y = (py - expected_center_y) / TILE_SIZE
```

These values range approximately within `[-1.0 .. +1.0]` and indicate **smooth movement progress between tiles**.

---

## Performance Characteristics

| Operation | Cost |
|---------|------|
| Grayscale extraction | Very low |
| Downsampling | Very low |
| Block matching on ~96 blocks with radius=3 | ~0.5–2% CPU |
| Median filtering | Negligible |
| No GPU required | ✅ |
| Works with occlusions (explosions/spells) | ✅ |

This approach is **orders of magnitude lighter** than optical flow or feature tracking.

---

## Advantages

- **No static landmarks required**
- **Robust to large animated effects**
- **Does not break in crowded battles**
- **CPU-efficient and scalable**
- Works with **raw BGRA frame capture**

---

## Summary

This method provides a stable and low-cost way to extract both:

1. **Player tile-based movement events**
2. **Creature animation progress between tiles**

It is specifically suited to tile-based 2D games where global scrolling and local sprite movement must be separated.

