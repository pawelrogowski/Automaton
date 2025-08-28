// electron/utils/deepHash.js

/**
 * Computes a deep hash of an object or array.
 * This function is designed to be more efficient than JSON.stringify for hashing,
 * especially for nested structures, by avoiding string conversion overhead.
 * It handles primitives, objects, and arrays.
 *
 * @param {any} obj - The object or value to hash.
 * @returns {number} A 32-bit unsigned integer hash.
 */
export function deepHash(obj) {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis

  const processString = (str) => {
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0; // FNV-1a 32-bit prime
    }
  };

  const processValue = (value) => {
    const type = typeof value;

    if (value === null) {
      processString('null');
    } else if (type === 'object') {
      if (Array.isArray(value)) {
        processString('array');
        for (let i = 0; i < value.length; i++) {
          processValue(value[i]);
        }
      } else {
        processString('object');
        const keys = Object.keys(value).sort(); // Ensure consistent order
        for (let i = 0; i < keys.length; i++) {
          processString(keys[i]); // Hash the key
          processValue(value[keys[i]]); // Hash the value
        }
      }
    } else if (
      type === 'function' ||
      type === 'symbol' ||
      type === 'undefined'
    ) {
      // Ignore functions, symbols, and undefined values for hashing
      processString(type);
    } else {
      processString(String(value)); // Convert primitives to string and hash
    }
  };

  processValue(obj);
  return hash;
}
