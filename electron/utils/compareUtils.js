// electron/utils/compareUtils.js

/**
 * Performs a shallow comparison of two arrays of special area objects.
 * It checks for changes in length and relevant properties of each object.
 *
 * @param {Array<object>} arr1 - The first array of special area objects.
 * @param {Array<object>} arr2 - The second array of special area objects.
 * @returns {boolean} True if the arrays are considered equal, false otherwise.
 */
export function areSpecialAreasEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) {
    return false;
  }

  for (let i = 0; i < arr1.length; i++) {
    const a1 = arr1[i];
    const a2 = arr2[i];

    // Compare relevant properties. 'id' is ignored as it's an internal identifier.
    if (
      a1.x !== a2.x ||
      a1.y !== a2.y ||
      a1.z !== a2.z ||
      a1.sizeX !== a2.sizeX ||
      a1.sizeY !== a2.sizeY ||
      a1.avoidance !== a2.avoidance ||
      a1.type !== a2.type ||
      a1.enabled !== a2.enabled
    ) {
      return false;
    }
  }
  return true;
}
