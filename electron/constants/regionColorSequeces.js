const regionColorSequences = {
  healthBar: {
    direction: 'horizontal',
    offset: { x: 1, y: 0 },
    sequence: [
      [241, 97, 97],
      [219, 91, 91],
      [103, 55, 55],
      [73, 74, 74],
      [77, 78, 78],
    ],
  },
  manaBar: {
    direction: 'horizontal',
    offset: { x: 5, y: 0 },
    sequence: [
      [99, 96, 248],
      [95, 92, 219],
      [80, 79, 140],
      [68, 68, 69],
      [69, 70, 70],
    ],
  },
  cooldownBar: {
    direction: 'horizontal',
    offset: { x: 0, y: 0 },
    sequence: [
      [109, 109, 110],
      [65, 18, 2],
      [49, 14, 4],
    ],
  },
  statusBar: {
    direction: 'horizontal',
    offset: { x: 2, y: 1 },
    sequence: [
      [116, 116, 117],
      [71, 72, 72],
      [74, 74, 75],
      [69, 70, 70],
      [74, 74, 75],
      [78, 78, 79],
      [70, 70, 71],
      [28, 28, 29],
    ],
  },
};

export default regionColorSequences;
