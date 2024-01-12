async function binarySearch(start, end, barPosition, combinedRegion, combinedPixels, colors) {
  let mid;
  while (start < end) {
    mid = Math.floor((start + end) / 2);
    const index =
      (barPosition.y - combinedRegion.y) * combinedRegion.width + (mid - combinedRegion.x);
    const hex = combinedPixels[index];

    if (colors.includes(hex)) {
      start = mid + 1; // Move right if the color matches
    } else {
      end = mid; // Move left if the color does not match
    }
  }
  // The start variable is now at the first non-matching pixel, so subtract 1 to get the last matching pixel
  const result = start - 1;
  return result >= 0 ? result : 0; // Ensure the result is not negative
}

export default binarySearch;
