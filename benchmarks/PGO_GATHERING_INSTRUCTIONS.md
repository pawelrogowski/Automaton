# PGO Data Gathering Instructions

## Current Status
✅ **Phase 1 Complete** - Module built with instrumentation
📊 **Ready for data gathering**

## What to Do Now

### 1. Start the Application
The application is ready to start. Run:
```bash
cd /home/feiron/Dokumenty/Automaton
npm run start
```

### 2. Use the Application (5-10 minutes recommended)

**Important**: Try to exercise all common scenarios:

#### Essential Scenarios (Required):
- ✅ Login to the game
- ✅ Navigate around different areas
- ✅ Engage in combat (multiple fights)
- ✅ Use different UI elements
- ✅ Switch between different screens/views

#### Optional (for better optimization):
- Health/mana bar detection in various lighting
- Different enemy types
- Various UI states (inventory, skills, etc.)
- Fast movements and rapid screen changes
- High-activity scenarios (lots of enemies)

### 3. How Long Should I Gather Data?

**Minimum**: 5 minutes of active gameplay
**Recommended**: 10-15 minutes
**Maximum**: No limit, but diminishing returns after 20 minutes

**Quality > Quantity**: 
- 5 minutes of diverse scenarios beats 30 minutes of repetitive actions
- Try to hit all major code paths

### 4. After Gathering Data

Close the application normally, then run:
```bash
cd /home/feiron/Dokumenty/Automaton/nativeModules/findSequences
./pgo-workflow.sh phase2
```

This will:
- Verify profile data was collected
- Rebuild the module with optimizations
- Ready for benchmarking

### 5. Verify Results

After Phase 2 completes, benchmark:
```bash
cd /home/feiron/Dokumenty/Automaton
node tools/benchmark_native_modules.cjs findSequences --iterations=100000
```

**Expected improvements from PGO**:
- Better branch prediction
- Optimized hot paths
- Reduced cache misses
- 5-15% performance gain typical
- Further reduction in outliers

## Technical Details

**What's being collected**:
- Which code paths are executed most frequently
- Branch prediction patterns
- Function call frequencies
- Cache access patterns

**Where data is stored**:
- `nativeModules/findSequences/pgo-data/*.gcda`

**Profile data size**: Typically 100-500 KB

## Troubleshooting

### No profile data generated
- Make sure the application actually ran
- Check that instrumented module was loaded
- Verify pgo-data directory exists

### Application crashes
- Instrumentation adds ~5-10% overhead (normal)
- If crashes persist, rebuild without instrumentation

### Can I gather more data later?
- Yes! Just re-run phase1, gather more data, then phase2
- Data accumulates across runs
