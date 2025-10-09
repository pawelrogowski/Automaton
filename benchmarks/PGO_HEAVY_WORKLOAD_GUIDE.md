# PGO Heavy Workload Scenarios Guide

## ✅ Ready for Round 2 Data Gathering!

Module rebuilt with fresh instrumentation. This time focus on **heavy workload scenarios** where findSequences does the most work.

## 🎯 Critical Heavy-Load Scenarios

### 1. Combat with Many Enemies (CRITICAL)
**Why**: Maximum sequence matching workload
- Fight in areas with 5+ enemies visible
- Target switching between multiple enemies
- Rapid health bar detection as enemies take damage
- Duration: 3-5 minutes

### 2. Crowded Areas / Busy Screens (CRITICAL)  
**Why**: Tests all 160 sequences simultaneously
- Walk through populated towns/cities
- Areas with many NPCs and players visible
- Market areas, depot zones
- Duration: 2-3 minutes

### 3. Fast Movement/Scrolling (HIGH)
**Why**: Frequent re-detection of UI elements
- Rapid screen scrolling (use mouse wheel on game view)
- Quick direction changes while running
- Teleporting between areas
- Duration: 2 minutes

### 4. UI State Changes (MEDIUM)
**Why**: Tests different detection modes
- Open/close inventory multiple times
- Toggle different UI panels
- Switch between tabs
- Duration: 2 minutes

### 5. Various Lighting/Graphics (MEDIUM)
**Why**: Tests edge cases in color matching
- Different terrain types (snow, desert, jungle)
- Day/night cycles if available
- Indoor vs outdoor areas
- Duration: 1-2 minutes

## ⏱️ Recommended Timeline (12-15 minutes total)

**Phase 1: Warm-up** (2 min)
- Login, basic navigation
- Gets basic code paths covered

**Phase 2: Heavy Combat** (5 min) ⚠️ MOST IMPORTANT
- Multiple fights with many enemies
- The more chaos, the better!
- This is where findSequences works hardest

**Phase 3: Crowded Areas** (3 min)
- Walk through busy zones
- Lots of on-screen entities

**Phase 4: Rapid Actions** (2 min)
- Fast movements
- Quick UI interactions

**Phase 5: Edge Cases** (2 min)
- Different terrains
- Various UI states

## 💡 Pro Tips

### DO:
- ✅ Maximize on-screen complexity
- ✅ Fight multiple enemies at once
- ✅ Stay in high-activity areas
- ✅ Rapid, varied actions
- ✅ Let the bot run detection continuously

### DON'T:
- ❌ Idle in menus
- ❌ Stay in empty areas
- ❌ Repetitive single actions
- ❌ Minimize/background the app

## 🔬 What Makes Good Profile Data?

**Good**: Combat with 8 enemies → 1000s of sequence checks/second
**Bad**: Standing in empty field → 10 sequence checks/second

The compiler will optimize the hot paths that run most frequently, so make those paths representative of real heavy usage!

## 📊 After Gathering

When done, you should see:
- `pgo-data/*.gcda` file size: **>100 KB** (ideally 200-500 KB)
- More data = better optimizations

Then run:
```bash
cd /home/feiron/Dokumenty/Automaton/nativeModules/findSequences
./pgo-workflow.sh phase2
```

## 🎯 Expected Improvement

With heavy workload profiling:
- Better branch prediction for combat scenarios
- Optimized hot loops for multi-enemy detection  
- Cache-friendly memory access patterns
- Potential additional 3-8% performance gain
- Even fewer outliers in high-load situations
