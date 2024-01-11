async function calculatePercentages(start, position, width, lastPercentage, lastDispatchTime) {
  return new Promise((resolve) => {
    const percentage = Math.floor(((start - position.x) / width) * 100);

    if (lastPercentage !== percentage) {
      console.log(`${percentage}%`);

      lastPercentage = percentage;
      lastDispatchTime = Date.now();
    }

    const now = Date.now();
    if (now - lastDispatchTime >= 500) {
      lastDispatchTime = now;
    }

    resolve({ lastPercentage, lastDispatchTime });
  });
}
export default calculatePercentages;
