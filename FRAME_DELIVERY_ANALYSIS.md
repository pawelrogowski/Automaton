# Frame & Dirty Rect Delivery Performance Analysis

## Current Flow

1. **Capture Worker** (`capture/core.js`):
   - Captures frame with `getLatestFrame(imageBuffer)` 
   - Writes dirty rects to SharedArrayBuffer (syncSAB)
   - Increments frame counter atomically
   - Sends `frame-update` message via `parentPort.postMessage()` ✅

2. **Worker Manager** (`workerManager.js`):
   - Receives `frame-update` message in `handleWorkerMessage()`
   - **FILTERING LOGIC** (lines 628-664):
     - Gets `allRegions` from Redux store
     - Iterates through ALL workers
     - For each worker, checks region dependencies
     - For each dependency, checks intersection with dirty rects
     - Only forwards message if there's an intersection
   - Forwards filtered messages to relevant workers

3. **Minimap Worker** (`minimap/core.js`):
   - Receives `frame-update` in `handleMessage()`
   - Pushes dirty rects to queue
   - Calls `processFrames()` which processes asynchronously

---

## ⚠️ IDENTIFIED BOTTLENECKS

### 1. **WorkerManager Filtering Loop - O(W × D × R)**
**Location**: `workerManager.js:628-664`

**Problem**: 
For EVERY frame update, the manager iterates through:
- W = All workers (~8-10 workers)
- D = Worker dependencies (~2-5 regions per worker)
- R = Dirty rects (can be 30-40 per frame)

This creates **nested loops** that run on the **main thread** for every single frame.

**Worst case**: With 8 workers, 5 dependencies each, and 40 dirty rects:
- 8 × 5 × 40 = **1,600 intersection checks per frame**
- At 60 FPS, this is **96,000 checks per second**

**Impact**: 
- Blocks the main thread (where Worker Manager runs)
- Delays message forwarding to workers
- Creates artificial latency between capture and processing

**Evidence**:
```javascript
for (const [name, workerEntry] of this.workers.entries()) {  // W workers
  if (dependencies) {
    for (const regionKey of dependencies) {                    // D dependencies
      for (const dirtyRect of dirtyRects) {                    // R dirty rects
        if (rectsIntersect(region, dirtyRect)) {
          // Break logic here
        }
      }
    }
  }
}
```

### 2. **Store.getState() Call on Every Frame**
**Location**: `workerManager.js:632`

```javascript
const allRegions = store.getState().regionCoordinates.regions;
```

**Problem**:
- Redux `getState()` called 60 times per second
- Returns entire state object (not memoized)
- Potential serialization overhead

**Impact**: Minor but unnecessary overhead

### 3. **Synchronous Message Forwarding**
**Location**: `workerManager.js:642, 653`

```javascript
workerEntry.worker.postMessage(message);
```

**Problem**:
- Multiple synchronous `postMessage()` calls in a loop
- Each `postMessage` has serialization overhead
- No batching or optimization

**Impact**: Cumulative delay when forwarding to multiple workers

### 4. **Queue Processing in Minimap Worker**
**Location**: `minimap/core.js:107-111`

```javascript
while (dirtyRectsQueue.length > 0) {
  const currentDirtyRects = dirtyRectsQueue.shift();
  await performOperation(currentDirtyRects);
}
```

**Problem**:
- Processes queue items **sequentially** with `await`
- If multiple updates arrive while processing, they queue up
- Each `performOperation` is async and takes ~1ms

**Impact**: 
- Introduces processing lag if frames arrive faster than processing
- Not a critical issue but compounds other delays

### 5. **Unnecessary Console Logging**
**Location**: Multiple places

```javascript
console.log(`[MinimapCore] Received new frame with ${...}`);  // Line 133
console.log(`[MinimapCore] Frame processed in ${...}ms`);     // Line 117
```

**Problem**:
- Console.log is **synchronous** and **slow**
- Blocks event loop
- Can take 0.1-1ms per call

**Impact**: At 60 FPS, this adds 6-60ms/second of wasted time

---

## 🚀 RECOMMENDED OPTIMIZATIONS

### Priority 1: Remove/Simplify WorkerManager Filtering

**Option A: Broadcast to All (Simplest)**
Remove filtering entirely and broadcast all frame updates to all workers. Let workers filter internally.

**Option B: Pre-computed Region Maps**
Cache a map of `dirtyRect → affectedWorkers` and update only when regions change.

**Option C: Spatial Partitioning**
Use a quadtree or grid to quickly find which regions are affected by dirty rects.

### Priority 2: Cache Redux Regions
Store `regionCoordinates.regions` in a local variable and only update when version changes.

### Priority 3: Remove Console Logs
Comment out or guard all frame-related console logs behind a debug flag.

### Priority 4: Optimize Message Forwarding
Batch messages or use a more efficient forwarding mechanism.

### Priority 5: Parallel Processing in Minimap
Don't await each operation - process in parallel if safe.

---

## 📊 ESTIMATED IMPACT

| Optimization | Time Saved per Frame | Latency Reduction |
|--------------|---------------------|-------------------|
| Remove filtering | 0.5-2ms | **HIGH** |
| Cache regions | 0.05-0.1ms | LOW |
| Remove console logs | 0.1-1ms | **MEDIUM** |
| Batch forwarding | 0.1-0.5ms | MEDIUM |
| Parallel processing | 0.5-1ms | MEDIUM |

**Total potential improvement**: **1.25-4.6ms per frame** = **75-276ms saved per second at 60 FPS**

---

## 🎯 IMMEDIATE ACTION ITEMS

1. ✅ **Remove all console.log statements** from frame processing paths
2. ⚠️ **Simplify or remove WorkerManager filtering logic**
3. 🔧 **Cache region data** instead of calling store.getState() every frame
4. 🔧 **Consider broadcasting frame-update** to all workers (let them filter)
5. 📝 **Profile actual timings** to validate these hypotheses
