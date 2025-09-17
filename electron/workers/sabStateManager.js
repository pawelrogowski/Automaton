import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PLAYER_POS_UPDATE_COUNTER_INDEX,
  BATTLE_LIST_COUNT_INDEX,
  BATTLE_LIST_UPDATE_COUNTER_INDEX,
  BATTLE_LIST_ENTRIES_START_INDEX,
  BATTLE_LIST_ENTRY_SIZE,
  CREATURES_COUNT_INDEX,
  CREATURES_UPDATE_COUNTER_INDEX,
  CREATURES_DATA_START_INDEX,
  CREATURE_DATA_SIZE,
  CREATURE_INSTANCE_ID_OFFSET,
  WORLD_STATE_UPDATE_COUNTER_INDEX,
  CREATURE_X_OFFSET,
  CREATURE_Y_OFFSET,
  CREATURE_Z_OFFSET,
  CREATURE_IS_REACHABLE_OFFSET,
  CREATURE_IS_ADJACENT_OFFSET,
  CREATURE_DISTANCE_OFFSET,
  CREATURE_HP_OFFSET,
  CREATURE_NAME_START_OFFSET,
  CREATURE_NAME_LENGTH,
  LOOTING_REQUIRED_INDEX,
  LOOTING_UPDATE_COUNTER_INDEX,
  TARGETING_LIST_COUNT_INDEX,
  TARGETING_LIST_UPDATE_COUNTER_INDEX,
  TARGETING_LIST_DATA_START_INDEX,
  TARGETING_RULE_SIZE,
  TARGET_INSTANCE_ID_INDEX,
  TARGET_X_INDEX,
  TARGET_Y_INDEX,
  TARGET_Z_INDEX,
  TARGET_DISTANCE_INDEX,
  TARGET_IS_REACHABLE_INDEX,
  TARGET_NAME_START_INDEX,
  TARGET_UPDATE_COUNTER_INDEX,
  PATH_LENGTH_INDEX,
  PATH_CHEBYSHEV_DISTANCE_INDEX,
  PATHFINDING_STATUS_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_WAYPOINTS_START_INDEX,
  PATH_WAYPOINT_SIZE,
  MAX_PATH_WAYPOINTS,
  PATH_START_X_INDEX,
  PATH_START_Y_INDEX,
  PATH_START_Z_INDEX,
} from './sharedConstants.js';

const hpStringToCode = {
  Full: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Critical: 4,
  Obstructed: 5,
};

const hpCodeToString = [
  'Full',
  'High',
  'Medium',
  'Low',
  'Critical',
  'Obstructed',
];

export class SABStateManager {
  constructor(sabData) {
    this.playerPosArray = sabData.playerPosSAB
      ? new Int32Array(sabData.playerPosSAB)
      : null;
    this.battleListArray = sabData.battleListSAB
      ? new Int32Array(sabData.battleListSAB)
      : null;
    this.creaturesArray = sabData.creaturesSAB
      ? new Int32Array(sabData.creaturesSAB)
      : null;
    this.lootingArray = sabData.lootingSAB
      ? new Int32Array(sabData.lootingSAB)
      : null;
    this.targetingListArray = sabData.targetingListSAB
      ? new Int32Array(sabData.targetingListSAB)
      : null;
    this.targetArray = sabData.targetSAB
      ? new Int32Array(sabData.targetSAB)
      : null;
    this.pathDataArray = sabData.pathDataSAB
      ? new Int32Array(sabData.pathDataSAB)
      : null;

    this.lastCounters = {
      playerPos: -1,
      battleList: -1,
      creatures: -1,
      looting: -1,
      targetingList: -1,
      target: -1,
      pathData: -1,
    };
  }

  // --- Player Position ---
  getPlayerPosition() {
    if (!this.playerPosArray) return null;

    const counter = Atomics.load(
      this.playerPosArray,
      PLAYER_POS_UPDATE_COUNTER_INDEX,
    );
    if (counter === this.lastCounters.playerPos) return null;

    this.lastCounters.playerPos = counter;
    return {
      x: Atomics.load(this.playerPosArray, PLAYER_X_INDEX),
      y: Atomics.load(this.playerPosArray, PLAYER_Y_INDEX),
      z: Atomics.load(this.playerPosArray, PLAYER_Z_INDEX),
    };
  }

  // --- Battle List ---
  getBattleList() {
    if (!this.battleListArray) return [];

    const count = Atomics.load(this.battleListArray, BATTLE_LIST_COUNT_INDEX);
    const entries = [];

    for (let i = 0; i < count; i++) {
      const startIdx =
        BATTLE_LIST_ENTRIES_START_INDEX + i * BATTLE_LIST_ENTRY_SIZE;
      let name = '';

      for (let j = 0; j < BATTLE_LIST_ENTRY_SIZE; j++) {
        const charCode = Atomics.load(this.battleListArray, startIdx + j);
        if (charCode === 0) break;
        name += String.fromCharCode(charCode);
      }

      if (name) entries.push({ name });
    }

    return entries;
  }

  writeBattleList(entries) {
    if (!this.battleListArray) return;

    const count = Math.min(entries.length, 50); // MAX_BATTLE_LIST_ENTRIES
    Atomics.store(this.battleListArray, BATTLE_LIST_COUNT_INDEX, count);

    for (let i = 0; i < count; i++) {
      const name = entries[i].name;
      const startIdx =
        BATTLE_LIST_ENTRIES_START_INDEX + i * BATTLE_LIST_ENTRY_SIZE;

      for (let j = 0; j < BATTLE_LIST_ENTRY_SIZE; j++) {
        const charCode = j < name.length ? name.charCodeAt(j) : 0;
        Atomics.store(this.battleListArray, startIdx + j, charCode);
      }
    }

    Atomics.add(this.battleListArray, BATTLE_LIST_UPDATE_COUNTER_INDEX, 1);
  }

  // --- Creatures ---
  getCreatures() {
    if (!this.creaturesArray) return [];

    const count = Atomics.load(this.creaturesArray, CREATURES_COUNT_INDEX);
    const creatures = [];

    for (let i = 0; i < count; i++) {
      const startIdx = CREATURES_DATA_START_INDEX + i * CREATURE_DATA_SIZE;

      let name = '';
      for (let j = 0; j < CREATURE_NAME_LENGTH; j++) {
        const charCode = Atomics.load(
          this.creaturesArray,
          startIdx + CREATURE_NAME_START_OFFSET + j,
        );
        if (charCode === 0) break;
        name += String.fromCharCode(charCode);
      }

      const hpCode = Atomics.load(
        this.creaturesArray,
        startIdx + CREATURE_HP_OFFSET,
      );

      creatures.push({
        instanceId: Atomics.load(
          this.creaturesArray,
          startIdx + CREATURE_INSTANCE_ID_OFFSET,
        ),
        name,
        hp: hpCodeToString[hpCode] || 'Full',
        gameCoords: {
          x: Atomics.load(this.creaturesArray, startIdx + CREATURE_X_OFFSET),
          y: Atomics.load(this.creaturesArray, startIdx + CREATURE_Y_OFFSET),
          z: Atomics.load(this.creaturesArray, startIdx + CREATURE_Z_OFFSET),
        },
        isReachable:
          Atomics.load(
            this.creaturesArray,
            startIdx + CREATURE_IS_REACHABLE_OFFSET,
          ) === 1,
        isAdjacent:
          Atomics.load(
            this.creaturesArray,
            startIdx + CREATURE_IS_ADJACENT_OFFSET,
          ) === 1,
        distance:
          Atomics.load(
            this.creaturesArray,
            startIdx + CREATURE_DISTANCE_OFFSET,
          ) / 100,
      });
    }

    return creatures;
  }

  writeCreatures(creatures) {
    if (!this.creaturesArray) return;

    const count = Math.min(creatures.length, 100); // MAX_CREATURES
    Atomics.store(this.creaturesArray, CREATURES_COUNT_INDEX, count);

    for (let i = 0; i < count; i++) {
      const creature = creatures[i];
      const startIdx = CREATURES_DATA_START_INDEX + i * CREATURE_DATA_SIZE;

      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_INSTANCE_ID_OFFSET,
        creature.instanceId || 0,
      );
      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_X_OFFSET,
        creature.gameCoords?.x || 0,
      );
      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_Y_OFFSET,
        creature.gameCoords?.y || 0,
      );
      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_Z_OFFSET,
        creature.gameCoords?.z || 0,
      );
      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_IS_REACHABLE_OFFSET,
        creature.isReachable ? 1 : 0,
      );
      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_IS_ADJACENT_OFFSET,
        creature.isAdjacent ? 1 : 0,
      );
      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_DISTANCE_OFFSET,
        Math.floor((creature.distance || 0) * 100),
      );
      Atomics.store(
        this.creaturesArray,
        startIdx + CREATURE_HP_OFFSET,
        hpStringToCode[creature.hp] ?? 0,
      );

      const name = creature.name || '';
      for (let j = 0; j < CREATURE_NAME_LENGTH; j++) {
        const charCode = j < name.length ? name.charCodeAt(j) : 0;
        Atomics.store(
          this.creaturesArray,
          startIdx + CREATURE_NAME_START_OFFSET + j,
          charCode,
        );
      }
    }

    Atomics.add(this.creaturesArray, CREATURES_UPDATE_COUNTER_INDEX, 1);
  }

  // --- Looting State ---
  isLootingRequired() {
    if (!this.lootingArray) return false;
    return Atomics.load(this.lootingArray, LOOTING_REQUIRED_INDEX) === 1;
  }

  setLootingRequired(required) {
    if (!this.lootingArray) return;

    Atomics.store(this.lootingArray, LOOTING_REQUIRED_INDEX, required ? 1 : 0);
    Atomics.add(this.lootingArray, LOOTING_UPDATE_COUNTER_INDEX, 1);
  }

  // --- Targeting List ---
  getTargetingList() {
    if (!this.targetingListArray) return [];

    const count = Atomics.load(
      this.targetingListArray,
      TARGETING_LIST_COUNT_INDEX,
    );
    const rules = [];

    for (let i = 0; i < count; i++) {
      const startIdx =
        TARGETING_LIST_DATA_START_INDEX + i * TARGETING_RULE_SIZE;

      // Read name (first 32 chars)
      let name = '';
      for (let j = 0; j < 32; j++) {
        const charCode = Atomics.load(this.targetingListArray, startIdx + j);
        if (charCode === 0) break;
        name += String.fromCharCode(charCode);
      }

      // Read action (next 4 chars)
      let action = '';
      for (let j = 32; j < 36; j++) {
        const charCode = Atomics.load(this.targetingListArray, startIdx + j);
        if (charCode === 0) break;
        action += String.fromCharCode(charCode);
      }

      const priority = Atomics.load(this.targetingListArray, startIdx + 36);
      const stickiness = Atomics.load(this.targetingListArray, startIdx + 37);
      const stance = Atomics.load(this.targetingListArray, startIdx + 38);
      const distance = Atomics.load(this.targetingListArray, startIdx + 39);

      rules.push({
        name,
        action,
        priority,
        stickiness,
        stance:
          stance === 0
            ? 'Follow'
            : stance === 1
              ? 'Stand'
              : stance === 2
                ? 'Reach'
                : 'Follow',
        distance,
      });
    }

    return rules;
  }

  writeTargetingList(rules) {
    if (!this.targetingListArray) return;

    const count = Math.min(rules.length, 50); // MAX_TARGETING_RULES
    Atomics.store(this.targetingListArray, TARGETING_LIST_COUNT_INDEX, count);

    for (let i = 0; i < count; i++) {
      const rule = rules[i];
      const startIdx =
        TARGETING_LIST_DATA_START_INDEX + i * TARGETING_RULE_SIZE;

      // Write name (32 chars)
      const name = rule.name || '';
      for (let j = 0; j < 32; j++) {
        const charCode = j < name.length ? name.charCodeAt(j) : 0;
        Atomics.store(this.targetingListArray, startIdx + j, charCode);
      }

      // Write action (4 chars)
      const action = rule.action || '';
      for (let j = 0; j < 4; j++) {
        const charCode = j < action.length ? action.charCodeAt(j) : 0;
        Atomics.store(this.targetingListArray, startIdx + 32 + j, charCode);
      }

      // Write numeric fields
      Atomics.store(this.targetingListArray, startIdx + 36, rule.priority || 0);
      Atomics.store(
        this.targetingListArray,
        startIdx + 37,
        rule.stickiness || 0,
      );
      Atomics.store(
        this.targetingListArray,
        startIdx + 38,
        rule.stance === 'Stand'
          ? 1
          : rule.stance === 'Reach'
            ? 2
            : 0,
      );
      Atomics.store(this.targetingListArray, startIdx + 39, rule.distance || 0);
    }

    Atomics.add(
      this.targetingListArray,
      TARGETING_LIST_UPDATE_COUNTER_INDEX,
      1,
    );
  }

  // --- Current Target ---
  getCurrentTarget() {
    if (!this.targetArray) return null;

    const instanceId = Atomics.load(this.targetArray, TARGET_INSTANCE_ID_INDEX);
    if (instanceId === 0) return null;

    let name = '';
    for (let i = 0; i < 32; i++) {
      const charCode = Atomics.load(
        this.targetArray,
        TARGET_NAME_START_INDEX + i,
      );
      if (charCode === 0) break;
      name += String.fromCharCode(charCode);
    }

    return {
      instanceId,
      name,
      gameCoordinates: {
        x: Atomics.load(this.targetArray, TARGET_X_INDEX),
        y: Atomics.load(this.targetArray, TARGET_Y_INDEX),
        z: Atomics.load(this.targetArray, TARGET_Z_INDEX),
      },
      distance: Atomics.load(this.targetArray, TARGET_DISTANCE_INDEX) / 100,
      isReachable:
        Atomics.load(this.targetArray, TARGET_IS_REACHABLE_INDEX) === 1,
    };
  }

  writeCurrentTarget(target) {
    if (!this.targetArray) return;

    if (!target) {
      Atomics.store(this.targetArray, TARGET_INSTANCE_ID_INDEX, 0);
      Atomics.add(this.targetArray, TARGET_UPDATE_COUNTER_INDEX, 1);
      return;
    }

    Atomics.store(
      this.targetArray,
      TARGET_INSTANCE_ID_INDEX,
      target.instanceId || 0,
    );
    Atomics.store(
      this.targetArray,
      TARGET_X_INDEX,
      target.gameCoordinates?.x || 0,
    );
    Atomics.store(
      this.targetArray,
      TARGET_Y_INDEX,
      target.gameCoordinates?.y || 0,
    );
    Atomics.store(
      this.targetArray,
      TARGET_Z_INDEX,
      target.gameCoordinates?.z || 0,
    );
    Atomics.store(
      this.targetArray,
      TARGET_DISTANCE_INDEX,
      Math.floor((target.distance || 0) * 100),
    );
    Atomics.store(
      this.targetArray,
      TARGET_IS_REACHABLE_INDEX,
      target.isReachable ? 1 : 0,
    );

    // Write name
    const name = target.name || '';
    for (let i = 0; i < 32; i++) {
      const charCode = i < name.length ? name.charCodeAt(i) : 0;
      Atomics.store(this.targetArray, TARGET_NAME_START_INDEX + i, charCode);
    }

    Atomics.add(this.targetArray, TARGET_UPDATE_COUNTER_INDEX, 1);
  }

  // --- Path Data ---
  getPath() {
    if (!this.pathDataArray)
      return { path: [], status: 0, chebyshevDistance: 0, pathStart: null };

    const pathLength = Atomics.load(this.pathDataArray, PATH_LENGTH_INDEX);
    const status = Atomics.load(this.pathDataArray, PATHFINDING_STATUS_INDEX);
    const chebyshevDistance = Atomics.load(
      this.pathDataArray,
      PATH_CHEBYSHEV_DISTANCE_INDEX,
    );
    const pathStart = {
      x: Atomics.load(this.pathDataArray, PATH_START_X_INDEX),
      y: Atomics.load(this.pathDataArray, PATH_START_Y_INDEX),
      z: Atomics.load(this.pathDataArray, PATH_START_Z_INDEX),
    };

    const path = [];
    const safePathLength = Math.min(pathLength, MAX_PATH_WAYPOINTS);

    for (let i = 0; i < safePathLength; i++) {
      const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
      path.push({
        x: Atomics.load(this.pathDataArray, offset + 0),
        y: Atomics.load(this.pathDataArray, offset + 1),
        z: Atomics.load(this.pathDataArray, offset + 2),
      });
    }

    return { path, status, chebyshevDistance, pathStart };
  }

  // --- Utility Methods ---
  hasDataChanged(type) {
    if (!this[`${type}Array`]) return false;

    const counterMap = {
      playerPos: PLAYER_POS_UPDATE_COUNTER_INDEX,
      battleList: BATTLE_LIST_UPDATE_COUNTER_INDEX,
      creatures: CREATURES_UPDATE_COUNTER_INDEX,
      looting: LOOTING_UPDATE_COUNTER_INDEX,
      targetingList: TARGETING_LIST_UPDATE_COUNTER_INDEX,
      target: TARGET_UPDATE_COUNTER_INDEX,
      pathData: PATH_UPDATE_COUNTER_INDEX,
    };

    const counterIndex = counterMap[type];
    if (counterIndex === undefined) return false;

    const currentCounter = Atomics.load(this[`${type}Array`], counterIndex);
    const hasChanged = currentCounter !== this.lastCounters[type];

    if (hasChanged) {
      this.lastCounters[type] = currentCounter;
    }

    return hasChanged;
  }

  // --- Batch Operations ---
  getGameState() {
    return {
      playerPosition: this.getPlayerPosition(),
      battleList: this.getBattleList(),
      creatures: this.getCreatures(),
      isLootingRequired: this.isLootingRequired(),
      targetingList: this.getTargetingList(),
      currentTarget: this.getCurrentTarget(),
      pathData: this.getPath(),
    };
  }

  writeWorldState(state) {
    if (!this.creaturesArray || !this.battleListArray || !this.targetArray) {
      return;
    }

    // Write all the individual components of the state.
    // Note: These methods already increment their own legacy counters, which is fine.
    this.writeBattleList(state.battleList || []);
    this.writeCreatures(state.creatures || []);
    this.writeCurrentTarget(state.target || null);

    // Atomically increment the main world state counter to signal a consistent write.
    Atomics.add(this.creaturesArray, WORLD_STATE_UPDATE_COUNTER_INDEX, 1);
  }
}
