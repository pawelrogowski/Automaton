# Systematic Debugging Methodology for Intermittent Bugs

## Overview
This document outlines a proven approach for debugging intermittent, hard-to-reproduce bugs in complex systems. Based on successfully resolving a threading boundary bug in native health bar detection.

---

## Phase 1: Characterization

### Goal
Understand the symptoms and pattern of failures.

### Actions
1. **Document Observable Symptoms**
   - What fails? (e.g., "health bars not detected")
   - How often? (e.g., "30-50% of the time")
   - When? (e.g., "during vertical movement")
   - Where? (e.g., "in native scanner, not OCR")

2. **Identify Patterns**
   - Does it happen with specific inputs?
   - Does it correlate with system state (movement, position, timing)?
   - Is it truly random or does it have a pattern?

3. **Add Diagnostic Logging**
   ```javascript
   // Example: Log both expected and actual state
   if (healthBarCount !== battleListCount) {
     logger('info', `MISMATCH: ${healthBarCount} HB / ${battleListCount} BL`);
   }
   ```

4. **Collect Metrics**
   - Success rate
   - Failure rate
   - Conditions when failures occur

### Deliverable
A clear description: "Health bars are missed 30-50% of the time during vertical movement when scan area starts at Y coordinates 18-20."

---

## Phase 2: Hypothesis Generation

### Goal
List all possible causes, even unlikely ones.

### Actions
1. **Brainstorm Without Filtering**
   - Buffer/memory corruption
   - Race conditions
   - Threading issues
   - Pointer arithmetic errors
   - Boundary conditions
   - Integer overflow
   - Game state timing
   - Cache coherency

2. **Categorize by Layer**
   - **Data layer**: Is the data correct?
   - **Processing layer**: Is the algorithm correct?
   - **System layer**: Are resources/timing correct?

3. **Prioritize by Likelihood**
   - Recent changes
   - Known problem areas
   - Complexity hotspots

### Deliverable
Ordered list of hypotheses to test.

---

## Phase 3: Static Reproduction

### Goal
Capture a failing case in a reproducible, static format.

### Actions
1. **Add Data Capture on Failure**
   ```javascript
   if (detectionFailed) {
     fs.writeFileSync(`/tmp/failure_${timestamp}.raw`, rawFrameData);
     logger('info', `Captured failing frame: ${scanArea}, expected: ${expected}`);
   }
   ```

2. **Capture Complete Context**
   - Raw input data (frame buffer)
   - Input parameters (scan area, settings)
   - Expected output
   - Actual output
   - Relevant state (player position, etc.)

3. **Create Minimal Reproduction**
   ```javascript
   // Load captured data
   const data = fs.readFileSync('/tmp/failure_1234.raw');
   
   // Run problematic code with same parameters
   const result = nativeScanner.scan(data, scanArea);
   
   // Verify failure reproduces
   assert(result.length === 0); // Should fail consistently
   ```

4. **Verify Consistency**
   - Run multiple times
   - Confirm same input → same output
   - If inconsistent, capture more context

### Deliverable
A self-contained test that reproduces the failure deterministically.

---

## Phase 4: Hypothesis Elimination

### Goal
Systematically rule out false leads.

### Actions
1. **Test Each Hypothesis**
   
   **Example: Buffer Tearing**
   ```javascript
   // Check pixel data integrity
   const pixels = analyzePixelData(frameData, healthBarPosition);
   console.log('Borders:', pixels.borders); // All black?
   console.log('Interior:', pixels.color);  // Valid health color?
   // Result: ✓ Data is valid → Buffer tearing ruled out
   ```

2. **Create Reference Implementation**
   ```javascript
   // JavaScript version of native scanner
   function jsScanner(data, scanArea) {
     // Same algorithm, simpler implementation
   }
   
   const jsResult = jsScanner(capturedData, scanArea);
   const nativeResult = nativeScanner(capturedData, scanArea);
   
   if (jsResult.found && !nativeResult.found) {
     // Bug is in native implementation, not algorithm
   }
   ```

3. **Document Each Elimination**
   ```markdown
   ### Hypothesis: Buffer tearing
   - **Test**: Analyzed pixel data in failed frame
   - **Result**: All pixels valid, borders intact
   - **Conclusion**: ✗ Ruled out
   ```

### Deliverable
List of eliminated hypotheses with evidence.

---

## Phase 5: Incremental Isolation

### Goal
Narrow down the problem space through systematic variation.

### Actions
1. **Vary One Parameter at a Time**
   ```javascript
   // Test different scan area sizes
   for (const size of [50, 100, 200, 400, 800, 1200]) {
     const result = scan(data, {x: 100, y: 100, width: size, height: 100});
     console.log(`Size ${size}: ${result.found ? '✓' : '✗'}`);
   }
   ```

2. **Look for Thresholds**
   ```
   Size 100:  ✓ FOUND
   Size 200:  ✓ FOUND
   Size 1000: ✓ FOUND
   Size 1200: ✗ NOT FOUND  ← Threshold found!
   ```

3. **Test Boundary Cases**
   ```javascript
   // If size-dependent, test positions
   for (const startY of [16, 17, 18, 19, 20, 21]) {
     const result = scan(data, {x: 100, y: startY, width: 1200, height: 800});
     console.log(`Y=${startY}: ${result.found ? '✓' : '✗'}`);
   }
   ```

4. **Identify the Pattern**
   ```
   Y=16,17:    ✓ FOUND
   Y=18,19,20: ✗ NOT FOUND  ← Pattern!
   Y=21+:      ✓ FOUND
   ```

### Deliverable
Specific conditions that trigger the bug: "Fails when scan starts at Y=18-20 with large height."

---

## Phase 6: Root Cause Analysis

### Goal
Understand WHY the pattern exists.

### Actions
1. **Analyze the Pattern**
   ```
   Pattern: Specific Y coordinates fail
   Question: What's special about Y=18-20?
   ```

2. **Map to Implementation**
   ```cpp
   // Thread work splitting
   threadEndRow = startY + (threadId + 1) * height / numThreads;
   
   // With startY=19, height=834, 8 threads:
   // Thread 4: rows 436-540
   ```

3. **Simulate the Logic**
   ```javascript
   // Recreate threading logic
   function simulateThreading(startY, height, numThreads) {
     for (let i = 0; i < numThreads; i++) {
       const startRow = startY + Math.floor(i * height / numThreads);
       const endRow = startY + Math.floor((i+1) * height / numThreads);
       // Check which thread handles our health bar
       if (healthBarY >= startRow && healthBarY < endRow) {
         // Simulate loop condition
         if (healthBarY + 3 >= endRow) {
           return 'BUG: Would break before checking!';
         }
       }
     }
   }
   ```

4. **Trace Through Failure**
   ```
   Health bar at Y=538
   Thread 4 handles 436-540
   Health bar needs rows 538,539,540,541
   Thread endRow = 540
   Loop check: 538 + 3 = 541 >= 540 → BREAK
   → Health bar missed!
   ```

### Deliverable
Exact code location and logic that causes the failure.

---

## Phase 7: Fix Implementation

### Goal
Fix the bug with minimal risk.

### Actions
1. **Design the Fix**
   ```cpp
   // WRONG: Break at thread boundary
   if (y + 3 >= endY) break;
   
   // RIGHT: Break at actual image boundary
   if (y + 3 >= data.height) break;
   ```

2. **Consider Side Effects**
   - Will threads overlap? (Yes, by 3 rows)
   - Will this cause duplicates? (Yes, but clustering handles it)
   - Performance impact? (Minimal: 3 rows per boundary)

3. **Implement with Documentation**
   ```cpp
   // Check if we have enough rows remaining for a 4-pixel-tall health bar
   // Need y, y+1, y+2, y+3 all to be valid
   // NOTE: Threads may overlap by up to 3 rows, clustering deduplicates
   if (y + 3 >= data.height) break;
   ```

### Deliverable
Implemented fix with clear comments explaining the reasoning.

---

## Phase 8: Verification

### Goal
Prove the fix works in all cases.

### Actions
1. **Test Against Static Reproduction**
   ```javascript
   const result = scan(capturedFailureData, failingScanArea);
   assert(result.found === true); // ✓ Now finds it
   ```

2. **Test All Known Failing Cases**
   ```javascript
   for (const testCase of knownFailures) {
     const result = scan(testCase.data, testCase.scanArea);
     assert(result.found === testCase.expected);
   }
   ```

3. **Test Boundary Cases**
   ```javascript
   // All Y positions should now work
   for (const y of [16,17,18,19,20,21,22,23,24]) {
     const result = scan(data, {x: 284, y, width: 1177, height: 834});
     assert(result.found === true);
   }
   ```

4. **Verify in Real Environment**
   ```
   Run application → Observe logs → Confirm no mismatches
   ```

5. **Performance Testing**
   ```javascript
   const before = performance.now();
   scan(largeData, fullArea);
   const duration = performance.now() - before;
   assert(duration < maxAcceptable);
   ```

### Deliverable
Proof that bug is fixed without introducing regressions.

---

## Phase 9: Documentation

### Goal
Preserve knowledge for future reference.

### Actions
1. **Document the Bug**
   - What was the symptom?
   - What was the root cause?
   - Why was it hard to find?

2. **Document the Fix**
   - What changed?
   - Why this approach?
   - What are the trade-offs?

3. **Document the Process**
   - What worked in debugging?
   - What didn't work?
   - What would you do differently?

4. **Create Regression Tests**
   ```javascript
   // tests/health-bar-threading.test.js
   describe('Health bar threading boundary bug', () => {
     it('should detect health bars at thread boundaries', () => {
       // Test case from actual bug
       const data = loadFrameDump('boundary-case.raw');
       const result = scanner.scan(data, {x:284, y:19, w:1177, h:834});
       expect(result.length).toBe(1);
     });
   });
   ```

### Deliverable
Complete documentation and regression tests.

---

## Quick Reference Checklist

When debugging an intermittent bug:

### ✅ Phase 1: Characterization
- [ ] Document symptoms precisely
- [ ] Identify failure patterns
- [ ] Add diagnostic logging
- [ ] Measure success/failure rates

### ✅ Phase 2: Hypotheses
- [ ] List all possible causes
- [ ] Categorize by system layer
- [ ] Prioritize by likelihood

### ✅ Phase 3: Static Reproduction
- [ ] Capture failing data
- [ ] Create minimal reproduction
- [ ] Verify consistency

### ✅ Phase 4: Elimination
- [ ] Test each hypothesis systematically
- [ ] Create reference implementations
- [ ] Document eliminations with evidence

### ✅ Phase 5: Isolation
- [ ] Vary parameters one at a time
- [ ] Find thresholds and boundaries
- [ ] Identify specific trigger pattern

### ✅ Phase 6: Root Cause
- [ ] Map pattern to implementation
- [ ] Simulate complex logic
- [ ] Trace through exact failure path

### ✅ Phase 7: Fix
- [ ] Design minimal fix
- [ ] Consider side effects
- [ ] Document reasoning

### ✅ Phase 8: Verification
- [ ] Test static reproduction
- [ ] Test all known failures
- [ ] Test boundary cases
- [ ] Verify in real environment
- [ ] Check performance

### ✅ Phase 9: Documentation
- [ ] Document bug and fix
- [ ] Create regression tests
- [ ] Update troubleshooting guides

---

## Key Principles

### 1. **Reproduce First, Debug Second**
Don't try to fix what you can't reliably reproduce.

### 2. **One Variable at a Time**
Change only one thing between tests to isolate the cause.

### 3. **Trust Data Over Intuition**
If evidence contradicts your theory, the theory is wrong.

### 4. **Eliminate, Don't Assume**
Prove hypotheses false rather than assuming they're true.

### 5. **Simplify to Understand**
Create reference implementations and simulations to understand complex logic.

### 6. **Document as You Go**
Future you will thank present you for detailed notes.

### 7. **Test the Fix Thoroughly**
Bugs often have multiple triggering conditions.

---

## Common Pitfalls to Avoid

### ❌ Assuming Game/External State Issues
Just because it's intermittent doesn't mean it's external. Check your own code first.

### ❌ Fixing Without Understanding
A "fix" that you don't understand is likely to break something else.

### ❌ Testing Only Happy Path
Test boundary conditions, error cases, and edge cases.

### ❌ Not Verifying in Real Environment
Static tests pass ≠ bug is fixed. Always verify in production-like environment.

### ❌ Skipping Documentation
Six months from now, you won't remember why you made that change.

---

## Tools and Techniques

### Data Capture
```javascript
// Automatic capture on Nth failure
if (++failureCount === 5) {
  fs.writeFileSync(`/tmp/failure_${Date.now()}.raw`, buffer);
  logger('info', 'Captured frame for analysis');
}
```

### Reference Implementation
```javascript
// Simple, obviously correct version
function referenceImplementation(data, area) {
  // Straightforward nested loops, no optimizations
  // Use to verify native implementation
}
```

### Parameter Variation
```javascript
// Automated testing across parameter space
for (const [param, values] of Object.entries(parameterRanges)) {
  for (const value of values) {
    testWithParameter(param, value);
  }
}
```

### Simulation
```javascript
// Simulate complex logic (threading, state machines)
function simulateThreadBoundaries(config) {
  // Pure JavaScript implementation
  // Easier to understand and debug
}
```

### Comparison Testing
```javascript
// Run multiple implementations and compare
const jsResult = jsImplementation(input);
const nativeResult = nativeImplementation(input);
if (!deepEqual(jsResult, nativeResult)) {
  console.log('MISMATCH:', {jsResult, nativeResult});
}
```

---

## Success Metrics

You know you're done when:
- ✅ Bug reproduces consistently in test environment
- ✅ Root cause is understood and documented
- ✅ Fix is minimal and targeted
- ✅ All test cases pass (including edge cases)
- ✅ Real environment shows no failures
- ✅ Performance is acceptable
- ✅ Code is documented and commented
- ✅ Regression tests are in place

---

## Conclusion

Intermittent bugs are challenging but solvable with a systematic approach. The key is patience, thoroughness, and trusting the data over intuition. Follow this methodology and you'll find even the most elusive bugs.

**Remember**: Every bug is an opportunity to improve your debugging skills and make your system more robust.
