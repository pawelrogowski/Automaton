// electron/workers/sabState/SABState.js
// Core unified SharedArrayBuffer state manager

import {
  SCHEMA,
  LAYOUT,
  TOTAL_SAB_SIZE,
  PROPERTY_CATEGORIES,
  FIELD_TYPES,
  getPropertyInfo,
} from './schema.js';

/**
 * Unified SAB State Manager
 *
 * ARCHITECTURE:
 * - Polled reads: Workers explicitly read when needed in their main loops (~20 Hz)
 * - No callbacks/watchers: Keeps control flow explicit and debuggable
 * - Version checking: Prevents torn reads with optimistic concurrency control
 * - Manual caching: Workers cache reads in workerState for iteration consistency
 *
 * USAGE:
 *   // Read once at iteration start
 *   const creatures = sabInterface.get('creatures').data;
 *
 *   // Use throughout iteration
 *   if (creatures.length > 0) { ... }
 *
 * For urgent inter-worker communication, use Control Channel instead.
 */
export class SABState {
  constructor(existingSAB = null) {
    // Create or use existing SharedArrayBuffer
    this.sab = existingSAB || new SharedArrayBuffer(TOTAL_SAB_SIZE * 4); // *4 for bytes
    this.array = new Int32Array(this.sab);

    // Initialize all properties with version = 0
    if (!existingSAB) {
      this._initializeVersions();
    }
  }

  /**
   * Initialize version counters for all properties
   * @private
   */
  _initializeVersions() {
    for (const [name, info] of Object.entries(LAYOUT)) {
      if (name === 'totalSize') continue;

      const { schema, offset } = info;

      // Set version field to 0
      if (schema.type === 'struct' || schema.type === 'config') {
        // Version is last field
        const versionOffset = offset + schema.size - 1;
        Atomics.store(this.array, versionOffset, 0);
      } else if (schema.type === 'array') {
        // Version is at offset + 1 (after count)
        Atomics.store(this.array, offset + 1, 0);
      } else if (schema.type === 'path') {
        // Version is at offset + headerSize - 1
        const versionOffset = offset + schema.headerSize - 1;
        Atomics.store(this.array, versionOffset, 0);
      }
    }
  }

  /**
   * Get current version of a property
   * @param {string} propertyName
   * @returns {number} Current version
   */
  getVersion(propertyName) {
    const { schema, offset } = getPropertyInfo(propertyName);

    if (schema.type === 'struct' || schema.type === 'config') {
      const versionOffset = offset + schema.size - 1;
      return Atomics.load(this.array, versionOffset);
    } else if (schema.type === 'array') {
      return Atomics.load(this.array, offset + 1);
    } else if (schema.type === 'path') {
      const versionOffset = offset + schema.headerSize - 1;
      return Atomics.load(this.array, versionOffset);
    }

    return 0;
  }

  /**
   * Atomically read a property
   * @param {string} propertyName
   * @returns {any} Property value with version
   */
  get(propertyName) {
    const { schema, offset } = getPropertyInfo(propertyName);

    // Read version before data
    const versionBefore = this.getVersion(propertyName);

    let data;

    if (schema.type === 'struct' || schema.type === 'config') {
      data = this._readStruct(schema, offset);
    } else if (schema.type === 'array') {
      data = this._readArray(schema, offset);
    } else if (schema.type === 'path') {
      data = this._readPath(schema, offset);
    } else if (schema.type === 'ring_buffer') {
      // Control channel uses special read method
      return null; // Use controlChannel API instead
    }

    // Read version after data
    const versionAfter = this.getVersion(propertyName);

    // Check consistency
    if (versionBefore !== versionAfter) {
      // Data changed during read, retry
      return this.get(propertyName);
    }

    return { data, version: versionAfter };
  }

  /**
   * Atomically write a property
   * @param {string} propertyName
   * @param {any} value
   * @param {Object} options - Additional options (e.g., lastUpdateTimestamp for arrays)
   */
  set(propertyName, value, options = {}) {
    const { schema, offset } = getPropertyInfo(propertyName);

    if (schema.type === 'struct' || schema.type === 'config') {
      this._writeStruct(schema, offset, value);
    } else if (schema.type === 'array') {
      this._writeArray(schema, offset, value, options);
    } else if (schema.type === 'path') {
      this._writePath(schema, offset, value);
    }

    // Increment version atomically
    this._incrementVersion(propertyName);
  }

  /**
   * Atomically write multiple properties in a batch
   * @param {Object} updates - { propertyName: value, ... }
   * @param {Object} options - { propertyName: { lastUpdateTimestamp, ... }, ... }
   * @returns {boolean} Success
   */
  setMany(updates, options = {}) {
    // Write all properties
    for (const [propertyName, value] of Object.entries(updates)) {
      const { schema, offset } = getPropertyInfo(propertyName);
      const propOptions = options[propertyName] || {};

      if (schema.type === 'struct' || schema.type === 'config') {
        this._writeStruct(schema, offset, value);
      } else if (schema.type === 'array') {
        this._writeArray(schema, offset, value, propOptions);
      } else if (schema.type === 'path') {
        this._writePath(schema, offset, value);
      }
    }

    // Increment all versions atomically
    for (const propertyName of Object.keys(updates)) {
      this._incrementVersion(propertyName);
    }

    return true;
  }

  /**
   * Read multiple properties atomically as a consistent snapshot
   * @param {string[]} propertyNames
   * @returns {Object} { propertyName: {data, version}, versionsMatch: boolean }
   */
  getMany(propertyNames) {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      const snapshot = {};
      const versionsBefore = {};
      const versionsAfter = {};

      // Read all versions before
      for (const name of propertyNames) {
        versionsBefore[name] = this.getVersion(name);
      }

      // Read all data
      for (const name of propertyNames) {
        const result = this.get(name);
        snapshot[name] = result;
      }

      // Read all versions after
      for (const name of propertyNames) {
        versionsAfter[name] = this.getVersion(name);
      }

      // Check if all versions are consistent
      const versionsMatch = propertyNames.every(
        (name) => versionsBefore[name] === versionsAfter[name],
      );

      if (versionsMatch) {
        return { ...snapshot, versionsMatch: true };
      }

      attempt++;
    }

    // Failed to get consistent snapshot after retries
    console.warn(
      `[SABState] Failed to get consistent snapshot after ${maxRetries} attempts`,
    );

    // Return latest read with versionsMatch = false
    const snapshot = {};
    for (const name of propertyNames) {
      snapshot[name] = this.get(name);
    }
    return { ...snapshot, versionsMatch: false };
  }

  /**
   * Get raw SharedArrayBuffer (for passing to workers)
   * @returns {SharedArrayBuffer}
   */
  getSharedArrayBuffer() {
    return this.sab;
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Read a struct from SAB
   * @private
   */
  _readStruct(schema, baseOffset) {
    const result = {};
    let currentOffset = baseOffset;

    for (const [fieldName, fieldType] of Object.entries(schema.fields)) {
      if (fieldName === 'version') {
        // Version read separately
        continue;
      }

      if (typeof fieldType === 'string') {
        // Simple type
        if (fieldType === FIELD_TYPES.INT32) {
          result[fieldName] = Atomics.load(this.array, currentOffset);
          currentOffset++;
        }
      } else if (fieldType.type === FIELD_TYPES.STRING) {
        // String field
        result[fieldName] = this._readString(
          currentOffset,
          fieldType.maxLength,
        );
        currentOffset += fieldType.maxLength;
      }
    }

    return result;
  }

  /**
   * Write a struct to SAB
   * @private
   */
  _writeStruct(schema, baseOffset, value) {
    let currentOffset = baseOffset;

    for (const [fieldName, fieldType] of Object.entries(schema.fields)) {
      if (fieldName === 'version') {
        // Version written separately
        continue;
      }

      if (typeof fieldType === 'string') {
        // Simple type
        if (fieldType === FIELD_TYPES.INT32) {
          const val = value[fieldName] ?? 0;
          Atomics.store(this.array, currentOffset, val);
          currentOffset++;
        }
      } else if (fieldType.type === FIELD_TYPES.STRING) {
        // String field
        this._writeString(
          currentOffset,
          value[fieldName] || '',
          fieldType.maxLength,
        );
        currentOffset += fieldType.maxLength;
      }
    }
  }

  /**
   * Read an array from SAB
   * @private
   */
  _readArray(schema, baseOffset) {
    const count = Atomics.load(this.array, baseOffset);
    const result = [];

    let itemOffset = baseOffset + schema.headerSize;

    for (let i = 0; i < count; i++) {
      const item = {};
      let currentOffset = itemOffset;

      for (const [fieldName, fieldType] of Object.entries(schema.itemFields)) {
        if (typeof fieldType === 'string') {
          if (fieldType === FIELD_TYPES.INT32) {
            item[fieldName] = Atomics.load(this.array, currentOffset);
            currentOffset++;
          }
        } else if (fieldType.type === FIELD_TYPES.STRING) {
          item[fieldName] = this._readString(
            currentOffset,
            fieldType.maxLength,
          );
          currentOffset += fieldType.maxLength;
        }
      }

      result.push(item);
      itemOffset += schema.itemSize;
    }

    return result;
  }

  /**
   * Write an array to SAB
   * @private
   */
  _writeArray(schema, baseOffset, items, options = {}) {
    const count = Math.min(items.length, schema.maxCount);
    Atomics.store(this.array, baseOffset, count);

    // For arrays with headerSize > 3, support writing lastUpdateTimestamp at offset 3
    // Header layout: [count(0), version(1), update_counter(2), lastUpdateTimestamp(3), ...]
    if (schema.headerSize >= 4 && options.lastUpdateTimestamp !== undefined) {
      Atomics.store(this.array, baseOffset + 3, options.lastUpdateTimestamp);
    }

    let itemOffset = baseOffset + schema.headerSize;

    for (let i = 0; i < count; i++) {
      const item = items[i];
      let currentOffset = itemOffset;

      for (const [fieldName, fieldType] of Object.entries(schema.itemFields)) {
        if (typeof fieldType === 'string') {
          if (fieldType === FIELD_TYPES.INT32) {
            Atomics.store(this.array, currentOffset, item[fieldName] ?? 0);
            currentOffset++;
          }
        } else if (fieldType.type === FIELD_TYPES.STRING) {
          this._writeString(
            currentOffset,
            item[fieldName] || '',
            fieldType.maxLength,
          );
          currentOffset += fieldType.maxLength;
        }
      }

      itemOffset += schema.itemSize;
    }
  }

  /**
   * Read path data from SAB
   * @private
   */
  _readPath(schema, baseOffset) {
    const header = {};
    let currentOffset = baseOffset;

    // Read header
    for (const [fieldName, fieldType] of Object.entries(schema.headerFields)) {
      if (fieldName === 'version') continue;

      header[fieldName] = Atomics.load(this.array, currentOffset);
      currentOffset++;
    }

    // Read waypoints
    const waypoints = [];
    const length = header.length || 0;
    const safeLength = Math.min(length, schema.maxWaypoints);

    let wpOffset = baseOffset + schema.headerSize;
    for (let i = 0; i < safeLength; i++) {
      waypoints.push({
        x: Atomics.load(this.array, wpOffset),
        y: Atomics.load(this.array, wpOffset + 1),
        z: Atomics.load(this.array, wpOffset + 2),
      });
      wpOffset += schema.waypointSize;
    }

    return { ...header, waypoints };
  }

  /**
   * Write path data to SAB
   * @private
   */
  _writePath(schema, baseOffset, value) {
    let currentOffset = baseOffset;

    // Write header
    for (const [fieldName, fieldType] of Object.entries(schema.headerFields)) {
      if (fieldName === 'version') continue;

      Atomics.store(this.array, currentOffset, value[fieldName] ?? 0);
      currentOffset++;
    }

    // Write waypoints
    const waypoints = value.waypoints || [];
    const length = Math.min(waypoints.length, schema.maxWaypoints);

    let wpOffset = baseOffset + schema.headerSize;
    for (let i = 0; i < length; i++) {
      const wp = waypoints[i];
      Atomics.store(this.array, wpOffset, wp.x ?? 0);
      Atomics.store(this.array, wpOffset + 1, wp.y ?? 0);
      Atomics.store(this.array, wpOffset + 2, wp.z ?? 0);
      wpOffset += schema.waypointSize;
    }
  }

  /**
   * Read a string from SAB
   * @private
   */
  _readString(offset, maxLength) {
    let str = '';
    for (let i = 0; i < maxLength; i++) {
      const charCode = Atomics.load(this.array, offset + i);
      if (charCode === 0) break;
      str += String.fromCharCode(charCode);
    }
    return str;
  }

  /**
   * Write a string to SAB
   * @private
   */
  _writeString(offset, str, maxLength) {
    for (let i = 0; i < maxLength; i++) {
      const charCode = i < str.length ? str.charCodeAt(i) : 0;
      Atomics.store(this.array, offset + i, charCode);
    }
  }

  /**
   * Increment version counter
   * @private
   */
  _incrementVersion(propertyName) {
    const { schema, offset } = getPropertyInfo(propertyName);

    if (schema.type === 'struct' || schema.type === 'config') {
      const versionOffset = offset + schema.size - 1;
      Atomics.add(this.array, versionOffset, 1);
    } else if (schema.type === 'array') {
      Atomics.add(this.array, offset + 1, 1);
    } else if (schema.type === 'path') {
      const versionOffset = offset + schema.headerSize - 1;
      Atomics.add(this.array, versionOffset, 1);
    }
  }
}
