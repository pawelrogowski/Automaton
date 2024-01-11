async function binarySearch(start, end, barPosition, combinedRegion, combinedPixels, colors) {
  let mid;
  while (start < end) {
    mid = Math.floor((start + end) / 2);
    const index =
      (barPosition.y - combinedRegion.y) * combinedRegion.width + (mid - combinedRegion.x);
    const hex = combinedPixels[index];
    if (colors.includes(hex)) {
      start = mid + 1;
    } else {
      end = mid;
    }
  }
  return start;
}

export default binarySearch;
