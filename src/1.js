// function healingCooldownProcessor(pixels, region) {
//   const sequence = ['#737373', '#28323b', '#142632', '#26353d', '#333b42'];
//   const result = findColorSequence(pixels, region, sequence);

//   if (!result.found) {
//     // console.log('Cooldown OFF');
//     return new Promise((resolve) => setTimeout(() => resolve(region), 100));
//   }

//   if (result.found) {
//     const barWidth = 5;
//     const newRegion = {
//       x: result.position.x,
//       y: result.position.y,
//       width: barWidth,
//       height: 1,
//     };

//     region = JSON.parse(JSON.stringify({ ...region, ...newRegion }));

//     const colorSequence = findColorSequence(pixels, region, sequence);
//     if (!colorSequence.found) {
//       // console.log('Cooldown ON');
//     }

//     return region;
//   }
// }
