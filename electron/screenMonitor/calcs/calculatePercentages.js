async function calculatePercentages(barPosition, combinedRegion, combinedPixels, colors, barWidth) {
  let matchingPixelsCount = 0;

  for (let { x } = barPosition; x < barPosition.x + barWidth; x += 1) {
    const index =
      (barPosition.y - combinedRegion.y) * combinedRegion.width + (x - combinedRegion.x);
    if (colors.includes(combinedPixels[index])) {
      matchingPixelsCount += 1;
    }
  }
  const percentage = Math.floor((matchingPixelsCount / barWidth) * 100);

  return { percentage };
}

export default calculatePercentages;
