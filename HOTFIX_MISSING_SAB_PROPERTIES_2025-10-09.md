# Hotfix: Missing SAB Properties

**Date:** 2025-10-09  
**Issue:** Workers failing with "Unknown property" errors  
**Status:** ✅ FIXED

## Problem

After completing the legacy SAB removal, the application crashed with errors:
```
[ERROR] [Cavebot] Failed to read looting state: Unknown property: looting
[ERROR] [TargetingWorker] Failed to write targeting list: Unknown property: targetingList
[ERROR] [CreatureMonitor] Failed to read targeting list: Unknown property: targetingList
```

**Root Cause:** The unified SAB schema (`electron/workers/sabState/schema.js`) was missing the `looting` and `targetingList` property definitions that workers were trying to access.

## Solution

Added two missing properties to the unified SAB schema:

### 1. `looting` Property

```javascript
looting: {
  category: PROPERTY_CATEGORIES.REALTIME,
  type: 'struct',
  fields: {
    required: FIELD_TYPES.INT32,  // bool as int
    version: FIELD_TYPES.INT32,
  },
  size: 2,
  description: 'Looting state (written by creatureMonitor)',
}
```

**Usage:**
- **Write:** `sabInterface.set('looting', { required: 1 })`
- **Read:** `sabInterface.get('looting')` returns `{ data: { required: 0|1 } }`

### 2. `targetingList` Property

```javascript
targetingList: {
  category: PROPERTY_CATEGORIES.REALTIME,
  type: 'array',
  maxCount: 50,
  itemFields: {
    name: { type: FIELD_TYPES.STRING, maxLength: 32 },
    action: { type: FIELD_TYPES.STRING, maxLength: 4 },
    priority: FIELD_TYPES.INT32,
    stickiness: FIELD_TYPES.INT32,
    stance: FIELD_TYPES.INT32,  // 0=Follow, 1=Stand, 2=Reach
    distance: FIELD_TYPES.INT32,
    onlyIfTrapped: FIELD_TYPES.INT32,  // bool as int
  },
  itemSize: 41, // 32 + 4 + 5 ints = 41
  headerSize: 3, // count + version + update_counter
  size: 3 + (50 * 41),
  description: 'Targeting rules list (written by targetingWorker/creatureMonitor)',
}
```

**Usage:**
- **Write:** `sabInterface.set('targetingList', rulesArray)`
- **Read:** `sabInterface.get('targetingList')` returns `{ data: [array of rules] }`

## Files Modified

1. `electron/workers/sabState/schema.js` - Added 2 missing property definitions

## Testing

### Build Status
```bash
$ npm run build
> webpack 5.99.9 compiled successfully in 8441 ms
```
✅ **Build successful**

### Expected Runtime Behavior

After this fix, workers should:
- Successfully read/write looting state
- Successfully read/write targeting list
- No "Unknown property" errors in logs

## Why This Was Missed

During the initial unified SAB implementation, these properties were assumed to still use the legacy SAB buffers as a temporary measure. The comment in line 220 of the original schema mentioned:

```javascript
// Note: targetingList is complex (array of rules), kept in existing targetingListSAB
```

However, when we removed the legacy SAB system completely, we migrated workers to use unified SAB for these properties but forgot to add them to the schema.

## Prevention

To prevent this in the future:
1. Always check schema definitions before migrating workers to unified SAB
2. Add comprehensive schema validation tests
3. Document all SAB properties in schema before removing legacy system

## Related

- **Main Migration:** `LEGACY_SAB_REMOVAL_COMPLETE_2025-10-09.md`
- **Schema File:** `electron/workers/sabState/schema.js`
