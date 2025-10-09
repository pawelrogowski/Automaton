# findSequences Native Module Optimization Plan
## Goal: Reduce GC-induced outliers from 14.89ms to <5ms

Generated: 2025-10-09

## Current Performance
- **Mean**: 0.88 ms
- **99th percentile**: 1.614 ms  
- **Max outlier**: 14.89 ms (18.6x median) - **GC PAUSE**
- **Outliers >3σ**: 284 (0.28%)

## Root Causes of GC Pressure

### 1. **std::string Allocations** (CRITICAL)
**Location**: Lines 26, 30-31, 315, 348, 374
**Issue**: Each `std::string` allocates on heap → frequent GC
**Impact**: ~160 strings allocated per call (160 sequences)

**Fix**: Use `string_view` or `const char*` for read-only strings
```cpp
// BEFORE
std::string name;
std::string direction = "horizontal";

// AFTER  
const char* name;      // or std::string_view name;
const char* direction;
```

### 2. **Unordered_map Rehashing** (HIGH)
**Location**: Lines 373-387 (RowBasedPixelChecks construction)
**Issue**: Maps grow dynamically → reallocations → GC pressure
**Impact**: Happens every frame during Execute()

**Fix**: Pre-allocate with `.reserve()` based on expected size
```cpp
// BEFORE
RowBasedPixelChecks rowBasedChecks;

// AFTER
RowBasedPixelChecks rowBasedChecks;
rowBasedChecks.reserve(bufferHeight / 10);  // Estimate
```

### 3. **Vector Growth** (MEDIUM)
**Location**: Lines 90, 341-342
**Issue**: Vectors resize → reallocation → GC pressure

**Fix**: Pre-allocate with `.reserve()` 
```cpp
// Line 341-342
std::vector<PixelCheck> checkList;
checkList.reserve(points.Length());  // ✓ Already done!
```

### 4. **Set Insertions** (MEDIUM)
**Location**: Lines 197-198, 431-432
**Issue**: `std::set` tree rebalancing → allocations

**Fix**: Use `std::vector` + sort once at end (if order doesn't matter during search)
```cpp
// BEFORE
std::set<FoundCoords> primaryCoords;

// AFTER (if "all" mode)
std::vector<FoundCoords> primaryCoords;
primaryCoords.reserve(estimated_size);
// ... collect results ...
std::sort(primaryCoords.begin(), primaryCoords.end());
primaryCoords.erase(std::unique(primaryCoords.begin(), primaryCoords.end()), primaryCoords.end());
```

### 5. **JavaScript Object Creation** (MEDIUM)
**Location**: Lines 470-493 (OnOK method)
**Issue**: Creating ~160 JS objects per call → V8 heap pressure

**Fix**: Batch object creation or use object pools
```cpp
// Use Napi::ObjectReference for object pooling (advanced)
// Or create objects in bulk using Buffer + typed arrays
```

### 6. **Thread-local Map Allocations** (LOW)
**Location**: Lines 393-402
**Issue**: Creating maps per thread each Execute() call

**Fix**: Make maps class members, reuse across calls
```cpp
// In SearchWorker class:
std::vector<FirstCandidateMap> threadFirstResults;  // Reusable
std::vector<AllCandidateMap> threadAllResults;

// In Execute():
for (auto& map : threadFirstResults) map.clear();  // Reuse
```

## Priority Implementation Order

### Phase 1: Quick Wins (30 min)
1. ✅ Add `.reserve()` to all vectors/maps with known sizes
2. ✅ Replace std::string with const char* for literals
3. ✅ Pre-allocate RowBasedPixelChecks map

**Expected improvement**: 14.89ms → ~8ms max outlier

### Phase 2: Medium Refactor (2 hours)
4. Replace std::set with std::vector for "all" mode
5. Make thread-local maps reusable class members
6. Use string_view for all read-only strings

**Expected improvement**: ~8ms → ~5ms max outlier

### Phase 3: Advanced (1 day)
7. Implement object pooling for JS object creation
8. Use Napi typed arrays instead of individual object properties
9. Memory pool allocator for frequently allocated structs

**Expected improvement**: ~5ms → ~2-3ms max outlier

## Measurement Strategy

After each phase, run:
```bash
node tools/benchmark_native_modules.cjs findSequences --iterations=100000
```

Track:
- Max outlier value
- 99.9th percentile  
- Outlier count (>3σ)

## Implementation Notes

- **Don't over-optimize**: Phase 1 + 2 should be sufficient
- **Test after each change**: Ensure correctness isn't broken
- **Profile with perf**: Use `perf record` to confirm GC is the issue
- **Consider trade-offs**: Some optimizations add complexity

## Expected Final Results

**Target after Phase 2**:
- Mean: 0.88 ms (unchanged)
- 99.9th percentile: <2ms  
- Max outlier: <5ms (3x improvement)
- Outliers >3σ: <50 (5x improvement)
