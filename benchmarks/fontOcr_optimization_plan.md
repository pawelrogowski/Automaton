# fontOcr Native Module Optimization Plan

## Baseline Performance (100K iterations)
- **Mean**: 0.109 ms
- **Median**: 0.088 ms  
- **99.9th percentile**: 0.594 ms
- **Max outlier**: 2.642 ms (30.2x median)
- **Outliers >3σ**: 1,480 (1.48%)
- **Throughput**: 9,175 ops/sec

## Current Status
✅ Already very fast (0.11ms mean)
⚠️ Some GC pressure from outliers (1.48%)
✅ Well under frame budget

## Usage Pattern (from ocrWorker.js)
- **skillsWidget**: Alphanumeric + ' .:,' chars
- **chatBoxTabRow**: Alpha + ' ' chars
- **selectCharacterModal**: Alpha + ' ' chars  
- **vipWidget**: Alpha + ' ' chars
- Uses `recognizeText(buffer, region, colors, allowedChars)`

## Optimization Strategy (Same as findSequences)

### Phase 1: Memory Optimizations (~30 min)
1. Add `.reserve()` to all vectors/maps
2. Replace std::string with const char* for literals
3. Pre-allocate ColorSet structures
4. Pre-allocate candidate vectors

**Expected**: 5-10% improvement, reduce outliers

### Phase 2: Reduce Allocations (~2 hours)
1. Replace std::set with std::vector where appropriate
2. Reuse thread-local data structures
3. Optimize std::unordered_set operations
4. Cache frequently used calculations

**Expected**: Additional 3-5% improvement

### Phase 3: Profile-Guided Optimization (PGO)
1. Gather profile data with real OCR workloads
2. Focus on text-heavy scenarios (chat, skills widget)
3. Recompile with PGO

**Expected**: 5-10% improvement, better branch prediction

## Total Expected Improvement
- Mean: 0.109ms → ~0.095ms (13% faster)
- Max outlier: 2.642ms → ~1.5ms (43% better)
- Outlier rate: 1.48% → ~0.5% (3x reduction)

## Implementation Priority
Given that fontOcr is already VERY fast (0.11ms), the main benefit will be:
1. **Reduced outliers** (most important)
2. **Lower GC pressure**
3. **Marginal mean improvement**

## Decision Point
**Should we optimize fontOcr?**

**Pros**:
- Same techniques that worked for findSequences
- Reduce GC pressure
- Make it even more stable

**Cons**:
- Already very fast (0.11ms)
- Low ROI compared to findSequences
- Takes time to implement + test

**Recommendation**: 
- Apply **Phase 1 only** (quick wins, 30 min)
- Skip Phase 2/3 unless we see issues in production
- Focus on other slower modules if they exist
