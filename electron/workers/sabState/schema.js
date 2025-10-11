// electron/workers/sabState/schema.js
// Schema definitions for unified SharedArrayBuffer state management

// Field type definitions
export const FIELD_TYPES = {
  INT32: 'int32',
  FLOAT64: 'float64',
  UINT8: 'uint8',
  STRING: 'string',
};

// Calculate size in Int32Array units (4 bytes each)
const sizeInInt32 = (bytes) => Math.ceil(bytes / 4);

// Property categories
export const PROPERTY_CATEGORIES = {
  CONFIG: 'config', // Written by workerManager from Redux, read by workers
  REALTIME: 'realtime', // Written by workers, synced to Redux
  CONTROL: 'control', // Worker-to-worker messaging
};

// Schema definition for all SAB properties
export const SCHEMA = {
  // ==================== REAL-TIME DATA ====================
  // Written by workers, read by workers + synced to Redux

  playerPos: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'struct',
    fields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
      version: FIELD_TYPES.INT32,
    },
    size: 4, // 4 Int32 fields
    description: 'Player minimap position (written by minimapMonitor)',
  },

  creatures: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'array',
    maxCount: 100,
    itemFields: {
      instanceId: FIELD_TYPES.INT32,
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
      absoluteX: FIELD_TYPES.INT32,
      absoluteY: FIELD_TYPES.INT32,
      isReachable: FIELD_TYPES.INT32, // bool as int
      isAdjacent: FIELD_TYPES.INT32, // bool as int
      isBlockingPath: FIELD_TYPES.INT32, // bool as int
      distance: FIELD_TYPES.INT32, // multiplied by 100
      hp: FIELD_TYPES.INT32, // encoded enum
      name: { type: FIELD_TYPES.STRING, maxLength: 32 }, // 32 chars
    },
    itemSize: 43, // 11 ints + 32 chars = 43
    headerSize: 3, // count + version + update_counter
    size: 3 + 100 * 43, // header + (maxCount * itemSize)
    description: 'Detected creatures (written by creatureMonitor)',
  },

  battleList: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'array',
    maxCount: 50,
    itemFields: {
      name: { type: FIELD_TYPES.STRING, maxLength: 32 },
      x: FIELD_TYPES.INT32, // screen coordinate
      y: FIELD_TYPES.INT32, // screen coordinate
      isTarget: FIELD_TYPES.INT32, // bool as int
    },
    itemSize: 35, // 32 chars + 3 ints
    headerSize: 3, // count + version + update_counter
    size: 3 + 50 * 35,
    description: 'Battle list entries (written by creatureMonitor)',
  },

  target: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'struct',
    fields: {
      instanceId: FIELD_TYPES.INT32,
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
      distance: FIELD_TYPES.INT32, // multiplied by 100
      isReachable: FIELD_TYPES.INT32, // bool as int
      name: { type: FIELD_TYPES.STRING, maxLength: 32 },
      version: FIELD_TYPES.INT32,
    },
    size: 7 + 32, // 7 ints + 32 chars
    description: 'Current target (written by creatureMonitor)',
  },

  pathData: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'path',
    maxWaypoints: 1000,
    waypointFields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
    },
    waypointSize: 3,
    headerFields: {
      length: FIELD_TYPES.INT32,
      status: FIELD_TYPES.INT32,
      chebyshevDistance: FIELD_TYPES.INT32,
      startX: FIELD_TYPES.INT32,
      startY: FIELD_TYPES.INT32,
      startZ: FIELD_TYPES.INT32,
      targetX: FIELD_TYPES.INT32,
      targetY: FIELD_TYPES.INT32,
      targetZ: FIELD_TYPES.INT32,
      blockingCreatureX: FIELD_TYPES.INT32,
      blockingCreatureY: FIELD_TYPES.INT32,
      blockingCreatureZ: FIELD_TYPES.INT32,
      wptId: FIELD_TYPES.INT32, // waypoint ID hash
      instanceId: FIELD_TYPES.INT32, // creature instance ID
      version: FIELD_TYPES.INT32,
    },
    headerSize: 15,
    size: 15 + 1000 * 3, // header + waypoints
    description: 'LEGACY: Combined pathfinding result - being phased out',
  },

  cavebotPathData: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'path',
    maxWaypoints: 1000,
    waypointFields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
    },
    waypointSize: 3,
    headerFields: {
      length: FIELD_TYPES.INT32,
      status: FIELD_TYPES.INT32,
      chebyshevDistance: FIELD_TYPES.INT32,
      startX: FIELD_TYPES.INT32,
      startY: FIELD_TYPES.INT32,
      startZ: FIELD_TYPES.INT32,
      targetX: FIELD_TYPES.INT32,
      targetY: FIELD_TYPES.INT32,
      targetZ: FIELD_TYPES.INT32,
      blockingCreatureX: FIELD_TYPES.INT32,
      blockingCreatureY: FIELD_TYPES.INT32,
      blockingCreatureZ: FIELD_TYPES.INT32,
      wptId: FIELD_TYPES.INT32, // waypoint ID hash (always used)
      instanceId: FIELD_TYPES.INT32, // always 0 for cavebot
      version: FIELD_TYPES.INT32,
    },
    headerSize: 15,
    size: 15 + 1000 * 3, // header + waypoints
    description: 'Cavebot pathfinding result (written by pathfinderWorker)',
  },

  targetingPathData: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'path',
    maxWaypoints: 1000,
    waypointFields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
    },
    waypointSize: 3,
    headerFields: {
      length: FIELD_TYPES.INT32,
      status: FIELD_TYPES.INT32,
      chebyshevDistance: FIELD_TYPES.INT32,
      startX: FIELD_TYPES.INT32,
      startY: FIELD_TYPES.INT32,
      startZ: FIELD_TYPES.INT32,
      targetX: FIELD_TYPES.INT32,
      targetY: FIELD_TYPES.INT32,
      targetZ: FIELD_TYPES.INT32,
      blockingCreatureX: FIELD_TYPES.INT32,
      blockingCreatureY: FIELD_TYPES.INT32,
      blockingCreatureZ: FIELD_TYPES.INT32,
      wptId: FIELD_TYPES.INT32, // always 0 for targeting
      instanceId: FIELD_TYPES.INT32, // creature instance ID (always used)
      version: FIELD_TYPES.INT32,
    },
    headerSize: 15,
    size: 15 + 1000 * 3, // header + waypoints
    description: 'Targeting pathfinding result (written by pathfinderWorker)',
  },

  looting: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'struct',
    fields: {
      required: FIELD_TYPES.INT32, // bool as int
      version: FIELD_TYPES.INT32,
    },
    size: 2,
    description: 'Looting state (written by creatureMonitor)',
  },

  targetingList: {
    category: PROPERTY_CATEGORIES.REALTIME,
    type: 'array',
    maxCount: 50,
    itemFields: {
      name: { type: FIELD_TYPES.STRING, maxLength: 32 },
      action: { type: FIELD_TYPES.STRING, maxLength: 4 },
      priority: FIELD_TYPES.INT32,
      stickiness: FIELD_TYPES.INT32,
      stance: FIELD_TYPES.INT32, // 0=Follow, 1=Stand, 2=Reach
      distance: FIELD_TYPES.INT32,
      onlyIfTrapped: FIELD_TYPES.INT32, // bool as int
    },
    itemSize: 41, // 32 + 4 + 5 ints = 41
    headerSize: 3, // count + version + update_counter
    size: 3 + 50 * 41,
    description:
      'Targeting rules list (written by targetingWorker/creatureMonitor)',
  },

  // ==================== UI CONFIG DATA ====================
  // Written by workerManager from Redux, read by workers

  cavebotConfig: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'config',
    fields: {
      enabled: FIELD_TYPES.INT32, // bool as int
      controlState: FIELD_TYPES.INT32, // enum encoded
      nodeRange: FIELD_TYPES.INT32,
      isPausedByScript: FIELD_TYPES.INT32, // bool as int
      currentSection: { type: FIELD_TYPES.STRING, maxLength: 64 },
      wptId: { type: FIELD_TYPES.STRING, maxLength: 64 },
      version: FIELD_TYPES.INT32,
    },
    size: 5 + 64 + 64, // 5 ints + 2 strings
    description: 'Cavebot configuration (written by workerManager from Redux)',
  },

  targetingConfig: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'config',
    fields: {
      enabled: FIELD_TYPES.INT32, // bool as int
      version: FIELD_TYPES.INT32,
    },
    size: 2,
    // Note: targetingList is complex (array of rules), kept in existing targetingListSAB
    description:
      'Targeting configuration (written by workerManager from Redux)',
  },

  globalConfig: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'config',
    fields: {
      windowId: FIELD_TYPES.INT32,
      display: FIELD_TYPES.INT32, // bool as int
      version: FIELD_TYPES.INT32,
    },
    size: 3,
    description: 'Global configuration (written by workerManager from Redux)',
  },

  // ==================== PATHFINDING DATA ====================
  // High-performance pathfinding data structures
  // Written by workerManager from Redux, read by pathfinder worker

  dynamicTarget: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'struct',
    fields: {
      targetCreaturePosX: FIELD_TYPES.INT32,
      targetCreaturePosY: FIELD_TYPES.INT32,
      targetCreaturePosZ: FIELD_TYPES.INT32,
      targetInstanceId: FIELD_TYPES.INT32,
      stance: FIELD_TYPES.INT32, // enum: 0=Follow, 1=Stand, 2=Reach
      distance: FIELD_TYPES.INT32,
      valid: FIELD_TYPES.INT32, // bool: 1=valid target, 0=null
      version: FIELD_TYPES.INT32,
    },
    size: 8,
    description:
      'Dynamic targeting creature (written by workerManager from Redux)',
  },

  targetWaypoint: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'struct',
    fields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
      valid: FIELD_TYPES.INT32, // bool: 1=valid waypoint, 0=no target
      version: FIELD_TYPES.INT32,
    },
    size: 5,
    description:
      'Current target waypoint coordinates (written by workerManager from Redux)',
  },

  specialAreas: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'array',
    maxCount: 100,
    itemFields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
      sizeX: FIELD_TYPES.INT32,
      sizeY: FIELD_TYPES.INT32,
      avoidance: FIELD_TYPES.INT32,
      enabled: FIELD_TYPES.INT32, // bool as int
      hollow: FIELD_TYPES.INT32, // bool as int
    },
    itemSize: 8,
    headerSize: 3, // count + version + update_counter
    size: 3 + 100 * 8, // 803 Int32 units
    description:
      'Permanent special avoid areas (written by workerManager from Redux)',
  },

  temporaryBlockedTiles: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'array',
    maxCount: 50,
    itemFields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
      expiresAt: FIELD_TYPES.INT32, // timestamp (ms / 100 to fit in int32)
    },
    itemSize: 4,
    headerSize: 3, // count + version + update_counter
    size: 3 + 50 * 4, // 203 Int32 units
    description:
      'Temporarily blocked tiles (written by workerManager from Redux)',
  },

  visitedTiles: {
    category: PROPERTY_CATEGORIES.CONFIG,
    type: 'array',
    maxCount: 100,
    itemFields: {
      x: FIELD_TYPES.INT32,
      y: FIELD_TYPES.INT32,
      z: FIELD_TYPES.INT32,
    },
    itemSize: 3,
    headerSize: 3, // count + version + update_counter
    size: 3 + 100 * 3, // 303 Int32 units
    description:
      'Visited tiles during targeting mode (written by workerManager from Redux)',
  },

  // ==================== CONTROL CHANNEL ====================
  // Worker-to-worker messaging

  controlChannel: {
    category: PROPERTY_CATEGORIES.CONTROL,
    type: 'ring_buffer',
    maxMessages: 32,
    messageFields: {
      sender: FIELD_TYPES.INT32, // enum: worker ID
      target: FIELD_TYPES.INT32, // enum: worker ID or BROADCAST
      command: FIELD_TYPES.INT32, // enum: message type
      priority: FIELD_TYPES.INT32, // enum: CRITICAL/NORMAL/LOW
      timestamp: FIELD_TYPES.INT32, // ms since epoch (mod 2^31)
      payloadType: FIELD_TYPES.INT32, // enum: NONE/POS/ID
      payloadA: FIELD_TYPES.INT32, // generic payload field 1
      payloadB: FIELD_TYPES.INT32, // generic payload field 2
      payloadC: FIELD_TYPES.INT32, // generic payload field 3
    },
    messageSize: 9,
    headerSize: 4, // writeIndex, readIndex, count, lock
    size: 4 + 32 * 9, // header + messages
    description: 'Lock-free control channel for worker-to-worker messaging',
  },
};

// Worker IDs for control channel
export const WORKER_IDS = {
  BROADCAST: 0,
  MINIMAP_MONITOR: 1,
  CREATURE_MONITOR: 2,
  PATHFINDER: 3,
  CAVEBOT: 4,
  TARGETING: 5,
  SCREEN_MONITOR: 6,
};

// Control channel commands
export const CONTROL_COMMANDS = {
  NONE: 0,
  POSITION_UPDATED: 1,
  TARGET_CHANGED: 2,
  PATH_READY: 3,
  HANDOVER_CONTROL: 4,
  CREATURES_UPDATED: 5,
};

// Control channel priorities
export const CONTROL_PRIORITIES = {
  CRITICAL: 0, // Movement, pathfinding
  NORMAL: 1, // Targeting, combat
  LOW: 2, // Stats updates
};

// Control state enum (for cavebotConfig.controlState)
export const CONTROL_STATES = {
  CAVEBOT: 0,
  HANDOVER_TO_TARGETING: 1,
  TARGETING: 2,
  HANDOVER_TO_CAVEBOT: 3,
};

// Calculate total SAB size and offsets
export const calculateLayout = () => {
  let currentOffset = 0;
  const layout = {};

  for (const [name, schema] of Object.entries(SCHEMA)) {
    layout[name] = {
      offset: currentOffset,
      size: schema.size,
      schema,
    };
    currentOffset += schema.size;
  }

  layout.totalSize = currentOffset;
  return layout;
};

// Pre-calculate layout
export const LAYOUT = calculateLayout();

// Export total size needed for unified SAB (in Int32 units)
export const TOTAL_SAB_SIZE = LAYOUT.totalSize;

// Utility: Get property info
export const getPropertyInfo = (propertyName) => {
  if (!LAYOUT[propertyName]) {
    throw new Error(`Unknown property: ${propertyName}`);
  }
  return LAYOUT[propertyName];
};

// Utility: Get all properties by category
export const getPropertiesByCategory = (category) => {
  return Object.entries(SCHEMA)
    .filter(([_, schema]) => schema.category === category)
    .map(([name, _]) => name);
};
