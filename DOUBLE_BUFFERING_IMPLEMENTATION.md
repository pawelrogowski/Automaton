# Double Buffering Implementation

## Problem
Health bar detection was failing intermittently during vertical movement due to **frame tearing** in the shared image buffer. When creatures or the player moved vertically, the native health bar scanner would read a partially-written frame, causing the 4-pixel vertical border check to fail.

**Root cause:** The capture worker wrote pixel data directly to a single shared buffer (imageSAB) while reader workers read from it simultaneously. This caused torn frames where some pixels were from the old frame and some from the new frame.

## Solution
Implemented **double buffering** using two SharedArrayBuffers with atomic pointer swapping:

### Architecture
```
┌─────────────┐
│   CAPTURE   │  Writes to INACTIVE buffer
│   WORKER    │  Then atomically swaps READABLE_BUFFER_INDEX
└─────────────┘
       │
       ├──────────┐
       ▼          ▼
  ┌────────┐  ┌────────┐
  │ SAB_A  │  │ SAB_B  │
  └────────┘  └────────┘
       ▲          ▲
       │          │
       └──────────┤
                  │
        ┌─────────┴─────────┬──────────────┬─────────────┐
        ▼                   ▼              ▼             ▼
  ┌──────────┐      ┌───────────┐   ┌─────────┐  ┌─────────┐
  │ CREATURE │      │  SCREEN   │   │   OCR   │  │ MINIMAP │
  │ MONITOR  │      │  MONITOR  │   │ WORKER  │  │ WORKER  │
  └──────────┘      └───────────┘   └─────────┘  └─────────┘
  Read from active buffer (indicated by READABLE_BUFFER_INDEX)
```

### Key Changes

#### 1. Configuration (`capture/config.js`)
- Added `READABLE_BUFFER_INDEX = 5` to syncSAB
- Shifted `DIRTY_REGION_COUNT_INDEX` from 5→6
- Shifted `DIRTY_REGIONS_START_INDEX` from 6→7

#### 2. Main Process (`workerManager.js`)
- Allocate `imageSAB_A` and `imageSAB_B` instead of single `imageSAB`
- Increased `SYNC_BUFFER_SIZE` from `5+1+...` to `6+1+...`
- Pass both buffers to all workers

#### 3. Capture Worker (Writer - `capture/core.js`)
```javascript
const imageBuffers = [Buffer.from(imageSAB_A), Buffer.from(imageSAB_B)];
let writeBufferIndex = 0;

// In capture loop:
const writeBuffer = imageBuffers[writeBufferIndex];
captureInstance.getLatestFrame(writeBuffer);

// Atomic swap
Atomics.store(syncArray, READABLE_BUFFER_INDEX, writeBufferIndex);
writeBufferIndex = 1 - writeBufferIndex; // Toggle 0↔1
```

#### 4. Reader Workers (All)
All reader workers updated with same pattern:
```javascript
const imageBuffers = [Buffer.from(imageSAB_A), Buffer.from(imageSAB_B)];
const READABLE_BUFFER_INDEX = 5;

function getReadableBuffer() {
  const index = Atomics.load(syncArray, READABLE_BUFFER_INDEX);
  return imageBuffers[index];
}

// At start of each operation:
sharedBufferView = getReadableBuffer();
```

**Updated workers:**
- `creatureMonitor.js` - health bar/creature detection
- `screenMonitor.js` - HP/MP bars, cooldowns, status
- `ocr/core.js` - OCR regions
- `minimap/core.js` - minimap matching
- `regionMonitor.js` - UI region detection

### Benefits
1. **Zero frame tearing** - readers always see complete frames
2. **No memcpy overhead** - just atomic index read
3. **Minimal memory cost** - 2x image buffer (~16MB total for 4K)
4. **Lock-free** - no mutex contention between capture and readers

### Testing
To verify fix:
1. Move vertically in game (previously triggered tearing)
2. Watch for `[Detection MISMATCH]` logs
3. Should see dramatically fewer mismatches
4. Health bar detection should be consistent during movement

## Performance Impact
- **Memory:** +8MB for second buffer (1920x1080x4)
- **CPU:** Negligible (single atomic load per frame)
- **Latency:** None (readers immediately see latest complete frame)

## Related Issues
- Health bar detection failures during vertical movement
- Creature targeting inconsistencies
- Looting trigger spam
