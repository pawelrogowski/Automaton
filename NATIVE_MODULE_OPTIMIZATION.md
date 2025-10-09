# Native Module Performance Optimization Guide

## Overview
This guide provides a systematic approach to optimizing native C++ modules using benchmarking, profiling, and iterative improvements.

---

## Quick Start

### 1. Run Baseline Benchmark
```bash
# Benchmark all modules
node tools/benchmark_native_modules.js all

# Benchmark specific module
node tools/benchmark_native_modules.js findSequences

# With more iterations for accuracy
node tools/benchmark_native_modules.js findHealthBars --iterations=1000

# Verbose output
node tools/benchmark_native_modules.js findHealthBars --verbose
```

### 2. Analyze Results
Look for:
- Modules with >10ms mean time (optimization candidates)
- High standard deviation (inconsistent performance)
- 95th/99th percentile spikes (outliers)

### 3. Profile Hot Spots
```bash
# Linux perf profiling
perf record -g node tools/benchmark_native_modules.js findSequences --iterations=1000
perf report

# Generate flamegraph
perf script | ./FlameGraph/stackcollapse-perf.pl | ./FlameGraph/flamegraph.pl > flamegraph.svg
```

### 4. Optimize & Verify
Make incremental changes, rebuild, re-benchmark.

---

## Optimization Workflow

### Phase 1: Establish Baseline

1. **Run comprehensive benchmark**
   ```bash
   node tools/benchmark_native_modules.js all > baseline.txt
   ```

2. **Capture frame dump** (if not exists)
   - Run application
   - Trigger frame dump on mismatch or manually
   - Use `/tmp/frame_${timestamp}.raw`

3. **Document current performance**
   ```markdown
   Baseline Performance (YYYY-MM-DD):
   - findSequences: 3.2ms mean, 4.1ms p95
   - findHealthBars: 1.8ms mean, 2.3ms p95
   - findTarget: 2.1ms mean, 2.8ms p95
   ```

### Phase 2: Profile & Identify Bottlenecks

1. **CPU Profiling with perf**
   ```bash
   # Record profile
   perf record -F 999 -g node tools/benchmark_native_modules.js findSequences --iterations=1000
   
   # View report
   perf report --stdio > profile.txt
   
   # Or interactive
   perf report
   ```

2. **Look for**:
   - Functions taking >10% of total time
   - Unexpected library calls (malloc, memcpy)
   - Cache misses (`perf stat -e cache-misses`)
   - Branch mispredictions (`perf stat -e branch-misses`)

3. **Common bottlenecks**:
   - Nested loops with high iteration counts
   - Non-SIMD pixel processing
   - Memory allocations in hot paths
   - Pointer chasing / cache misses
   - Unnecessary data copies
   - Thread synchronization overhead

### Phase 3: Optimize

#### A. Algorithm Optimization

1. **Reduce computational complexity**
   ```cpp
   // BEFORE: O(n²) nested loop
   for (int y = 0; y < height; y++) {
     for (int x = 0; x < width; x++) {
       // Check every pixel
     }
   }
   
   // AFTER: Early exit with SIMD
   for (int y = 0; y < height; y++) {
     if (quickReject(row)) continue; // Skip entire row
     // Only process promising rows
   }
   ```

2. **Use spatial data structures**
   ```cpp
   // For sparse detection, use grid/quadtree
   // Instead of scanning entire frame
   ```

3. **Reduce redundant work**
   ```cpp
   // Cache results that don't change
   // Reuse computations across frames
   ```

#### B. Memory Optimization

1. **Improve cache locality**
   ```cpp
   // BEFORE: Structure of Arrays (bad cache)
   std::vector<int> x_coords;
   std::vector<int> y_coords;
   std::vector<int> values;
   
   // AFTER: Array of Structures (good cache)
   struct Point { int x, y, value; };
   std::vector<Point> points;
   ```

2. **Pre-allocate memory**
   ```cpp
   // BEFORE: Dynamic allocation in loop
   for (...) {
     std::vector<Result> results; // Allocates every iteration!
   }
   
   // AFTER: Reuse buffer
   static thread_local std::vector<Result> results;
   results.clear();
   for (...) {
     results.push_back(...);
   }
   ```

3. **Align data for SIMD**
   ```cpp
   alignas(32) uint8_t buffer[width * 4]; // AVX2 alignment
   ```

#### C. SIMD Optimization

1. **Vectorize hot loops**
   ```cpp
   // BEFORE: Scalar loop
   for (int i = 0; i < width; i++) {
     if (pixels[i] == target) count++;
   }
   
   // AFTER: SIMD (AVX2 processes 8 pixels at once)
   __m256i target_vec = _mm256_set1_epi32(target);
   for (int i = 0; i < width; i += 8) {
     __m256i pixels_vec = _mm256_loadu_si256((__m256i*)(pixels + i));
     __m256i cmp = _mm256_cmpeq_epi32(pixels_vec, target_vec);
     int mask = _mm256_movemask_ps(_mm256_castsi256_ps(cmp));
     count += __builtin_popcount(mask);
   }
   ```

2. **Use appropriate intrinsics**
   ```cpp
   // AVX2 (256-bit, 8x int32 or 32x uint8)
   __m256i, _mm256_*
   
   // SSE4.2 (128-bit, 4x int32 or 16x uint8)
   __m128i, _mm_*
   ```

3. **Handle remainder**
   ```cpp
   int simd_end = (width / 8) * 8;
   // SIMD loop up to simd_end
   // Scalar loop for remainder
   for (int i = simd_end; i < width; i++) { ... }
   ```

#### D. Threading Optimization

1. **Minimize synchronization**
   ```cpp
   // BEFORE: Lock for every result
   for (...) {
     std::lock_guard lock(mutex);
     results.push_back(item);
   }
   
   // AFTER: Thread-local accumulation
   thread_local std::vector<Result> local_results;
   for (...) {
     local_results.push_back(item);
   }
   std::lock_guard lock(mutex);
   results.insert(results.end(), local_results.begin(), local_results.end());
   ```

2. **Balance work distribution**
   ```cpp
   // Avoid fixed-size chunks if work varies
   // Use dynamic scheduling or steal work from idle threads
   ```

3. **Avoid false sharing**
   ```cpp
   // BEFORE: Adjacent data modified by different threads
   int counters[8]; // Cache line contention!
   
   // AFTER: Pad to cache line size
   alignas(64) int counters[8]; // Each in separate cache line
   ```

### Phase 4: Verify Improvement

1. **Rebuild module**
   ```bash
   cd nativeModules/findSequences
   node-gyp rebuild
   ```

2. **Run benchmark again**
   ```bash
   node tools/benchmark_native_modules.js findSequences --iterations=1000 > optimized.txt
   ```

3. **Compare results**
   ```bash
   diff -u baseline.txt optimized.txt
   ```

4. **Verify correctness**
   ```bash
   # Run against test cases
   node tools/test_native_module.js findSequences
   ```

5. **Test in real application**
   ```bash
   npm run dev
   # Observe logs for performance metrics
   ```

### Phase 5: Document & Iterate

1. **Record improvement**
   ```markdown
   Optimization: Vectorized pixel comparison loop
   Before: 3.2ms mean
   After:  1.4ms mean
   Speedup: 2.3x
   ```

2. **If not satisfied, repeat**
   - Profile again to find next bottleneck
   - Apply next optimization
   - Verify improvement

---

## Common Optimization Patterns

### Pattern 1: SIMD Pixel Scanning

**Problem**: Scanning pixels one-by-one is slow.

**Solution**: Process 8 pixels at once with AVX2.

```cpp
// Original: ~10ms for 1920x1080 frame
for (int y = 0; y < height; y++) {
  for (int x = 0; x < width; x++) {
    uint32_t pixel = ((uint32_t*)row)[x];
    if (pixel == target) { /* found */ }
  }
}

// Optimized: ~2ms for same frame
__m256i target_vec = _mm256_set1_epi32(target);
for (int y = 0; y < height; y++) {
  const uint8_t* row = data + y * stride;
  for (int x = 0; x < width; x += 8) {
    __m256i pixels = _mm256_loadu_si256((__m256i*)(row + x * 4));
    __m256i cmp = _mm256_cmpeq_epi32(pixels, target_vec);
    int mask = _mm256_movemask_ps(_mm256_castsi256_ps(cmp));
    if (mask != 0) {
      // Found match, handle individual pixels
      for (int i = 0; i < 8; i++) {
        if (mask & (1 << i)) { /* process x + i */ }
      }
    }
  }
}
```

### Pattern 2: Early Rejection

**Problem**: Processing every row even when no matches possible.

**Solution**: Quick check before detailed processing.

```cpp
// Add fast rejection test
bool quickReject(const uint8_t* row, int width) {
  // Check if row contains any target colors using SIMD
  // Return true to skip expensive detailed check
  return !containsTargetColor(row, width);
}

for (int y = 0; y < height; y++) {
  if (quickReject(row, width)) continue;
  // Detailed processing only for promising rows
}
```

### Pattern 3: Thread-Local Buffers

**Problem**: Memory allocation overhead in hot paths.

**Solution**: Reuse thread-local buffers.

```cpp
// BEFORE: Allocates/deallocates every call
std::vector<Result> findPatterns() {
  std::vector<Result> results;
  // ... scan and populate results
  return results;
}

// AFTER: Reuses buffer
thread_local std::vector<Result> tls_results;
std::vector<Result> findPatterns() {
  tls_results.clear(); // Doesn't free memory
  // ... scan and populate tls_results
  return tls_results; // Move, no copy
}
```

### Pattern 4: Reduce Branching

**Problem**: Branch mispredictions slow down pipeline.

**Solution**: Use branchless techniques.

```cpp
// BEFORE: Branchy
if (a > b) {
  result = a;
} else {
  result = b;
}

// AFTER: Branchless
result = a + ((b - a) & ((b - a) >> 31)); // max(a, b) without branch

// Or with SIMD
result = _mm256_max_epi32(a_vec, b_vec); // Hardware max
```

### Pattern 5: Prefetching

**Problem**: Cache misses stall pipeline.

**Solution**: Prefetch data before needed.

```cpp
for (int y = 0; y < height; y++) {
  // Prefetch row 8 ahead
  if (y + 8 < height) {
    _mm_prefetch((char*)(data + (y + 8) * stride), _MM_HINT_T0);
  }
  
  // Process current row
  processRow(data + y * stride);
}
```

---

## Performance Targets

### By Module Type

| Module Type | Target (mean) | Target (p95) | Notes |
|-------------|---------------|--------------|-------|
| Pixel matching (findSequences) | < 2ms | < 3ms | Small region scans |
| Feature detection (findHealthBars) | < 3ms | < 5ms | Full game world scan |
| OCR (fontOcr) | < 5ms | < 8ms | Per region |
| Pattern matching (minimapMatcher) | < 10ms | < 15ms | Complex matching |

### Frame Budget (60 FPS)
- Total budget: 16.67ms per frame
- Reserve for JavaScript: ~5ms
- Available for native: ~11ms
- Individual module: < 3ms ideal

---

## Profiling Tools

### Linux

1. **perf** (CPU profiling)
   ```bash
   # Record
   perf record -g node tools/benchmark_native_modules.js <module>
   
   # Report
   perf report
   
   # Stats
   perf stat -e cache-misses,branch-misses node tools/benchmark_native_modules.js <module>
   ```

2. **valgrind** (Memory profiling)
   ```bash
   valgrind --tool=cachegrind node tools/benchmark_native_modules.js <module> --iterations=10
   cg_annotate cachegrind.out.<pid>
   ```

3. **Intel VTune** (Advanced profiling)
   - CPU microarchitecture analysis
   - Cache hit/miss rates
   - Branch prediction analysis

### Compiler Optimization Flags

```gyp
# In binding.gyp
'cflags': [
  '-O3',              # Maximum optimization
  '-march=native',    # Use all CPU features
  '-mtune=native',    # Tune for current CPU
  '-ffast-math',      # Aggressive math optimizations
  '-funroll-loops',   # Loop unrolling
  '-flto',            # Link-time optimization
]
```

⚠️ **Warning**: `-ffast-math` can change floating-point behavior. Test thoroughly!

---

## Example: Optimizing findSequences

### Step 1: Baseline
```bash
$ node tools/benchmark_native_modules.js findSequences
Performance Statistics:
  Mean:    5.234 ms ± 0.421 ms
  95th %:  6.123 ms
```

### Step 2: Profile
```bash
$ perf record -g node tools/benchmark_native_modules.js findSequences --iterations=1000
$ perf report --stdio | head -20

# Shows:
- 45% time in findSequencesInner()
- 30% in pixel comparison loop
- 15% in result vector resize
```

### Step 3: Optimize Pixel Loop
```cpp
// Before: Scalar comparison
for (int i = 0; i < length; i++) {
  if (pixels[i] == target[i]) matches++;
}

// After: SIMD comparison
__m256i target_vec = _mm256_loadu_si256((__m256i*)target);
for (int i = 0; i < length; i += 8) {
  __m256i pixel_vec = _mm256_loadu_si256((__m256i*)(pixels + i));
  __m256i cmp = _mm256_cmpeq_epi32(pixel_vec, target_vec);
  int mask = _mm256_movemask_ps(_mm256_castsi256_ps(cmp));
  matches += __builtin_popcount(mask);
}
```

### Step 4: Pre-allocate Results
```cpp
// Before
std::vector<Result> results;

// After
results.reserve(estimated_max_results); // Avoid reallocs
```

### Step 5: Verify
```bash
$ node tools/benchmark_native_modules.js findSequences
Performance Statistics:
  Mean:    2.103 ms ± 0.234 ms  (2.5x faster!)
  95th %:  2.456 ms

# Verify correctness
$ node tools/test_native_module.js findSequences
✓ All tests passed
```

---

## Checklist

### Before Optimizing
- [ ] Establish baseline benchmark
- [ ] Profile to identify bottlenecks
- [ ] Verify correctness tests exist
- [ ] Document current performance

### During Optimization
- [ ] Make one change at a time
- [ ] Rebuild and test after each change
- [ ] Measure improvement
- [ ] Ensure correctness maintained

### After Optimization
- [ ] Document what was changed and why
- [ ] Update comments in code
- [ ] Run full test suite
- [ ] Verify in real application
- [ ] Commit with benchmark results in commit message

---

## Best Practices

1. **Measure, don't guess** - Always profile before optimizing
2. **Optimize hot paths first** - 80/20 rule applies
3. **Maintain correctness** - Fast but wrong is useless
4. **Document optimizations** - Future you will thank present you
5. **Test on real data** - Synthetic benchmarks can mislead
6. **Consider readability** - Don't sacrifice maintainability for 1% gain
7. **Use compiler optimizations** - Let the compiler help
8. **Profile on target hardware** - Performance varies by CPU

---

## Resources

### SIMD References
- [Intel Intrinsics Guide](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/)
- [ARM Neon Intrinsics](https://developer.arm.com/architectures/instruction-sets/simd-isas/neon/intrinsics)

### Profiling Guides
- [Linux perf Tutorial](https://perf.wiki.kernel.org/index.php/Tutorial)
- [Brendan Gregg's Performance Site](https://www.brendangregg.com/perf.html)

### Optimization Guides
- [Agner Fog's Optimization Manuals](https://www.agner.org/optimize/)
- [Intel Optimization Manual](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)

---

## Conclusion

Performance optimization is an iterative process:
1. **Measure** to find bottlenecks
2. **Optimize** the hot paths
3. **Verify** correctness and improvement
4. **Repeat** until performance target met

With systematic benchmarking and profiling, you can make data-driven optimization decisions and significantly improve native module performance.

**Remember**: Premature optimization is the root of all evil. Optimize where it matters, when it matters.
